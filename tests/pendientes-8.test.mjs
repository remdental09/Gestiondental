import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { endodonticQuestions, suggestPrestaciones } from "../lib/dictation/prestaciones.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-07" })).proposal;
const odo = (p) => p.odontogram.map((o) => `${o.tooth}:${o.kind === "surface" ? `${o.surface}/${o.finding?.condition}` : o.status}`);

test("«la doce» y «la 12» sin la palabra pieza se leen como pieza (numeración chilena)", async () => {
  for (const text of ["Obturación de la doce en oclusal con resina.", "Obturación de la 12 en oclusal con resina."]) {
    const p = await run(text);
    assert.deepEqual(odo(p), ["24:O/restored"], text);
    assert.ok(!p.clarifications.some((q) => /Falta una pieza identificable/.test(q)), text);
  }
});

test("«la veintiseis» se lee como pieza", async () => {
  const p = await run("Endodoncia de la veintiseis, necrosis.");
  assert.ok((p.diagnosisPrompts ?? []).some((x) => x.tooth === 32) || p.diagnoses.some((d) => d.tooth === 32));
});

test("fechas, horas y cantidades con número en palabras no se leen como pieza", async () => {
  for (const text of ["Control el doce de marzo, paciente asintomático.", "A las once horas se inicia la atención, anestesia en la pieza 2.4.", "Paciente espera hace la once horas."]) {
    const p = await run(text);
    assert.ok(!p.clarifications.some((q) => /exodoncia ya se realiz/.test(q)), text);
    assert.deepEqual(odo(p), [], text);
  }
});

test("«extracción de la once» pregunta si ya se realizó", async () => {
  const p = await run("Extracción de la once por fractura.");
  assert.ok(p.clarifications.some((q) => /exodoncia ya se realiz/.test(q)));
});

test("«se extrae la once» marca la pieza ausente", async () => {
  const p = await run("Se extrae la once.");
  assert.ok(odo(p).includes("23:Ausente"));
});

test("endodoncia sin vitalidad dictada pregunta en vez de adivinar el código", () => {
  const lines = ["Se realiza tratamiento de conductos en la pieza 3.6 y obturación con gutapercha."];
  assert.equal(suggestPrestaciones([], lines).length, 0);
  const questions = endodonticQuestions(lines, []);
  assert.equal(questions.length, 1);
  assert.match(questions[0], /3\.6 estaba vital o con lesión apical/);
});

test("endodoncia con código ya asignado, retratamiento o varias piezas no preguntan", () => {
  assert.deepEqual(endodonticQuestions(["Tratamiento de conductos en la pieza 4.6."], [{ code: "5006009", tooth: 46 }]), []);
  assert.deepEqual(endodonticQuestions(["Retratamiento de conductos en la pieza 1.1."], []), []);
  assert.deepEqual(endodonticQuestions(["Tratamiento de conductos en las piezas 1.1 y 2.1."], []), []);
});

test("gingivectomía: una pieza → unitaria de periodoncia; sector o varias piezas → por sextante; con láser no usa las de bisturí", () => {
  const code = (line) => suggestPrestaciones([], [line]).map((item) => item.code);
  assert.deepEqual(code("Gingivectomía en la pieza 2.1."), ["5009008"]);
  assert.deepEqual(code("Gingivectomía del sextante superior anterior."), ["5009023"]);
  assert.deepEqual(code("Gingivectomía en las piezas 1.1, 2.1 y 2.2."), ["5009023"]);
  assert.ok(!code("Gingivectomía con láser en la pieza 2.1.").some((c) => c === "5009008" || c === "5009023"));
});

test("ajuste oclusal tras cementar una corona no sugiere ajuste de plano oclusal", () => {
  const out = suggestPrestaciones([], ["Ajuste oclusal."], [], "Se cementa corona de zirconio en la pieza 1.6 y se hace ajuste oclusal.");
  assert.ok(!out.some((item) => item.code === "5013035"));
  const alone = suggestPrestaciones([], ["Ajuste oclusal."], [], "Ajuste oclusal por contacto prematuro.");
  assert.ok(alone.some((item) => item.code === "5013035"));
});
