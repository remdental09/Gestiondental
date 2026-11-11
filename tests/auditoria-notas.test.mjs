import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartLacks, findNoteMismatches, parseClaims } from "../lib/audit/note-claims.ts";

const bank = JSON.parse(readFileSync(new URL("./fixtures/auditoria-notas.json", import.meta.url), "utf8")).casos;
const caso = (id) => bank.find((item) => item.id === id);
const chartOf = (raw) => ({ teeth: raw.teeth ?? {}, surfaces: raw.surfaces ?? {}, missingReason: {}, crowns: raw.crowns ?? {}, history: [] });
const raw = (...claims) => JSON.stringify({ afirmaciones: claims });
const body = caso("n01-coronas-plural").body;
const quote = "Se constatan cuatro coronas clínicas correspondientes a las piezas 7, 8, 9 y 10, confeccionadas en circonio y cementadas sobre dientes.";
const four = ["7", "8", "9", "10"].map((pieza) => ({ pieza, sistema: "chilena", estado: "corona", momento: "constatado", cita: quote }));

test("lo que la IA extrae de la nota se convierte a FDI y se compara con el odontograma", () => {
  const claims = parseClaims(raw(...four), body);
  assert.deepEqual(claims.map((item) => item.tooth), [12, 11, 21, 22]);
  const findings = findNoteMismatches({ patientId: 5, noteId: 9, clinicalDate: "2026-11-10", claims, chart: chartOf(caso("n01-coronas-plural").chart) });
  assert.equal(findings.length, 4);
  assert.match(findings[0].message, /el odontograma no registra una corona en FDI 1\.2/);
  assert.match(findings[0].key, /^nota-vs-odontograma\|5\|9\|12\|corona$/);
});

test("al registrar las coronas en el odontograma, las observaciones desaparecen solas", () => {
  const claims = parseClaims(raw(...four), body);
  const fixed = chartOf(caso("n02-coronas-ya-registradas").chart);
  assert.equal(findNoteMismatches({ patientId: 5, noteId: 9, clinicalDate: "2026-11-10", claims, chart: fixed }).length, 0);
});

test("se descarta lo que la nota no respalda: cita inventada, pieza que la cita no nombra, referido, planificado, provisorio, pieza inválida", () => {
  const base = four[0];
  assert.equal(parseClaims(raw({ ...base, cita: "Se constata una corona de oro en la pieza 7 desde hace años" }), body).length, 0, "cita que no está en la nota");
  assert.equal(parseClaims(raw({ ...base, pieza: "12" }), body).length, 0, "la cita no nombra la pieza 12");
  assert.equal(parseClaims(raw({ ...base, momento: "referido" }), body).length, 0);
  assert.equal(parseClaims(raw({ ...base, momento: "planificado" }), body).length, 0);
  assert.equal(parseClaims(raw({ ...base, estado: "implante" }), body).length, 0, "la cita no habla de implantes");
  assert.equal(parseClaims(raw({ ...base, pieza: "40" }), body).length, 0, "pieza chilena inexistente");
  const provisional = "Se instala corona provisoria en la pieza 2.1 mientras se confecciona la definitiva.";
  assert.equal(parseClaims(raw({ pieza: "2.1", sistema: "fdi", estado: "corona", momento: "hoy", cita: provisional }), `Procedimiento\n${provisional}`).length, 0);
  assert.equal(parseClaims("no es json", body).length, 0);
  assert.equal(parseClaims(raw(base, base), body).length, 1, "sin duplicados");
});

test("sistemas de numeración: FDI con punto, chilena, universal y número suelto (chilena)", () => {
  const one = (pieza, sistema, cita) => parseClaims(raw({ pieza, sistema, estado: "implante", momento: "hoy", cita }), cita).map((item) => item.tooth);
  assert.deepEqual(one("3.6", "fdi", "Se instala implante en la pieza 3.6"), [36]);
  assert.deepEqual(one("30", "chilena", "Implante en pieza 30 chilena"), [36]);
  assert.deepEqual(one("19", "universal", "Implante en pieza 19 universal"), [36]);
  assert.deepEqual(one("12", "no_dicho", "Implante en pieza 12"), [24], "número suelto = numeración chilena");
  assert.deepEqual(one("7,8", "fdi", "Implante en pieza 7,8"), [], "no es una pieza");
});

test("la comparación avisa solo cuando de verdad falta y calla ante la duda", () => {
  const claim = (estado, tooth) => ({ tooth, estado, cita: "x" });
  assert.equal(chartLacks(chartOf({}), claim("implante", 36)), true);
  assert.equal(chartLacks(chartOf({ teeth: { 36: "Implante con pilar" } }), claim("implante", 36)), false);
  assert.equal(chartLacks(chartOf({ teeth: { 38: "Ausente" } }), claim("ausente", 38)), false);
  assert.equal(chartLacks(chartOf({}), claim("obturacion", 16)), true);
  assert.equal(chartLacks(chartOf({ surfaces: { 16: { O: { condition: "restored" } } } }), claim("obturacion", 16)), false);
  assert.equal(chartLacks(chartOf({ teeth: { 16: "Corona" } }), claim("obturacion", 16)), false, "bajo una corona no se exige la obturación");
  assert.equal(chartLacks(chartOf({ surfaces: { 16: { M: { condition: "caries" }, O: { condition: "caries" } } } }), claim("obturacion", 16)), false, "con caries registrada puede ser una inactivación con ionómero");
  assert.equal(chartLacks(chartOf({ teeth: { 16: "Ausente" } }), claim("caries", 16)), false, "una pieza ausente no se marca por caries");
  assert.equal(chartLacks(chartOf({ surfaces: { 26: { O: { condition: "caries" } } } }), claim("caries", 26)), false);
});

test("el banco de evoluciones está completo y no contiene datos de pacientes", () => {
  assert.ok(bank.length >= 12);
  assert.ok(bank.some((item) => item.esperadas.length === 0), "hay casos donde no debe avisar");
  assert.doesNotMatch(JSON.stringify(bank), /\d{1,2}\.\d{3}\.\d{3}-[\dkK]|@/);
});

test("el endpoint y el cron no escriben en la ficha: solo en tablas de la auditoría", () => {
  const route = readFileSync(new URL("../app/api/auditoria/route.ts", import.meta.url), "utf8");
  const notes = readFileSync(new URL("../app/audit-notes.ts", import.meta.url), "utf8");
  for (const text of [route, notes]) {
    assert.doesNotMatch(text, /(UPDATE|INSERT INTO|DELETE FROM) (patients|budgets|evolutions|tooth_statuses)/);
  }
  assert.match(notes, /INSERT INTO audit_note_claims/);
  assert.match(readFileSync(new URL("../app/scheduled.ts", import.meta.url), "utf8"), /runNoteAudits/);
});
