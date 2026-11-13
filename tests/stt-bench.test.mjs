import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, wer, termRecall, extractTeeth, toothAccuracy, scoreOne, buildReport } from "../scripts/stt-bench-lib.mjs";

const guion = JSON.parse(readFileSync(new URL("./stt-bench/guion.json", import.meta.url), "utf8"));

test("guion: 40 dictados con id único, texto y términos", () => {
  assert.equal(guion.dictados.length, 40);
  assert.equal(new Set(guion.dictados.map((d) => d.id)).size, 40);
  for (const d of guion.dictados) {
    assert.ok(d.texto.length > 80, d.id);
    assert.ok(d.terminos.length >= 4, d.id);
  }
});

test("guion: cada término exigido aparece en el texto del dictado", () => {
  for (const d of guion.dictados) {
    const { missed } = termRecall(d.terminos, d.texto);
    assert.deepEqual(missed, [], `${d.id}: ${missed.join(", ")}`);
  }
});

test("guion: 10 dictados para grabar de verdad y cobertura de especialidades", () => {
  assert.equal(guion.dictados.filter((d) => d.real).length, 10);
  const specs = new Set(guion.dictados.map((d) => d.especialidad));
  for (const s of ["operatoria", "endodoncia", "implantología", "periodoncia", "cirugía", "rehabilitación", "ortodoncia", "administrativo"]) assert.ok(specs.has(s), s);
});

test("guion: sin datos de pacientes (RUT, correos, teléfonos)", () => {
  for (const d of guion.dictados) {
    assert.doesNotMatch(d.texto, /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b|@|\+56|\b9\d{8}\b/, d.id);
  }
});

test("normalize: tildes, mayúsculas, decimales y números hablados", () => {
  assert.equal(normalize("Pieza TREINTA y seis, 3,5 mm."), "pieza 36 3.5 mm");
  assert.equal(normalize("Articaína al cuatro por ciento"), "articaina al 4 por ciento");
  assert.equal(normalize("veinticuatro horas"), "24 horas");
});

test("wer: idéntico = 0; una sustitución en cuatro palabras = 0,25", () => {
  assert.equal(wer("pieza doce con caries", "Pieza 12 con caries."), 0);
  assert.equal(wer("pieza 12 con caries", "pieza 12 con carie"), 0.25);
  assert.equal(wer("", ""), 0);
});

test("términos: ignora tildes y mayúsculas, no acepta fragmentos de palabra", () => {
  const r = termRecall(["articaína", "Straumann", "ProTaper"], "se usa articaina y straumann");
  assert.deepEqual(r.found, ["articaína", "Straumann"]);
  assert.deepEqual(r.missed, ["ProTaper"]);
  assert.equal(termRecall(["pulpa"], "pulpar").rate, 0);
});

test("piezas: listas con «y», palabras numerales y multiplicidad", () => {
  assert.deepEqual(extractTeeth("Pieza 14 con caries y piezas 3 y catorce con movilidad"), ["14", "3", "14"]);
  assert.deepEqual(extractTeeth("sin piezas nombradas"), []);
  const a = toothAccuracy("piezas 3 y 14", "pieza tres y pieza 41");
  assert.equal(a.rate, 0.5);
  assert.deepEqual(a.missed, ["14"]);
});

test("scoreOne y buildReport comparan dos motores", () => {
  const d = guion.dictados.find((x) => x.id === "op01");
  const good = d.texto;
  const bad = d.texto.replace("articaína", "arti caina").replace("pieza 14", "pieza 41");
  const s = scoreOne(d, bad);
  assert.ok(s.wer > 0 && s.terms.missed.includes("articaína") && s.teeth.rate < 1);
  const report = buildReport([d], { a: { op01: good }, b: { op01: bad } });
  assert.equal(report.rows[0].terms, 1);
  assert.ok(report.rows[1].terms < 1);
  assert.match(report.markdown, /articaína/);
});
