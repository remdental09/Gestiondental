import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { spokenAlerts } from "../lib/dictation/spoken-alerts.ts";
import { ICD11 } from "../lib/icd11.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-07" })).proposal;

// Dictado real (paciente ficticio): extracción e implante inmediato sin decir la causa.
const SIN_CAUSA = "Extracción de la pieza 2.1 e instalación inmediata de un implante. Se realiza extracción de la pieza 2.1 sin complicaciones, conservando las paredes vestibulares. Se instala un implante FGM Arcsys de 3,3 por 8 mm.";

test("extracción sin causa: pregunta el motivo con opciones verificadas del CIE-11, sin inventar diagnóstico", async () => {
  const p = await run(SIN_CAUSA);
  assert.equal(p.diagnosisPrompts?.length, 1);
  const [prompt] = p.diagnosisPrompts;
  assert.equal(prompt.tooth, 21);
  assert.match(prompt.question, /motivo de la extracción/);
  assert.ok(prompt.options.length >= 5);
  for (const option of prompt.options) assert.equal(ICD11[option.code]?.title, option.title, `${option.code} existe en el catálogo`);
  assert.deepEqual(p.diagnoses, []);
});

test("la pregunta también se dice en voz alta", async () => {
  const p = await run(SIN_CAUSA);
  assert.ok(spokenAlerts(p.clarifications, []).some((phrase) => /motivo de la extracción/.test(phrase)));
});

test("ya no pregunta «¿la exodoncia ya se realizó?» si luego se dicta que se realizó", async () => {
  const p = await run(SIN_CAUSA);
  assert.ok(!p.clarifications.some((q) => /ya se realizó o solo está indicada/.test(q)));
});

test("extracción de una raíz: sugiere «Raíz dental retenida» (por confirmar) en vez de preguntar", async () => {
  const p = await run("Cirugía de implante en la pieza 8. Se realiza la extracción de una raíz dental en la pieza 8. Se instala en el alvéolo fresco un implante de 3,3 por 8.");
  assert.equal(p.diagnosisPrompts?.length ?? 0, 0);
  const dx = p.diagnoses.find((item) => item.code === "DA0A.3");
  assert.ok(dx);
  assert.equal(dx.suggested?.from, "nota");
});

test("implante en pieza ya ausente: sugiere «Pérdida de dientes…» (DA0A.1) por confirmar", async () => {
  const p = await run("Cirugía de implante en la pieza 36 con el reborde cicatrizado. Se instala un implante de 4,1 por 10 milímetros marca Straumann.");
  const dx = p.diagnoses.find((item) => item.code === "DA0A.1");
  assert.ok(dx);
  assert.equal(dx.tooth, 36);
  assert.equal(dx.suggested?.from, "nota");
  assert.equal(p.diagnosisPrompts?.length ?? 0, 0);
});

test("si la causa se dictó («por caries»), no se pregunta", async () => {
  const p = await run("Se realiza la extracción de la pieza 14 por caries extensa.");
  assert.equal(p.diagnosisPrompts?.length ?? 0, 0);
});

test("una extracción solo indicada no genera pregunta ni sugerencia", async () => {
  const p = await run("Se indica exodoncia de la pieza 36.");
  assert.equal(p.diagnosisPrompts?.length ?? 0, 0);
  assert.ok(!p.diagnoses.some((item) => item.suggested?.from === "nota"));
});

test("segunda fase de un implante que ya existe: no se sugiere diagnóstico", async () => {
  const p = await run("Segunda fase del implante de la pieza 36. Se realiza el descubrimiento del implante con bisturí y se instala un pilar de cicatrización de 4 milímetros de altura.");
  assert.ok(!p.diagnoses.some((item) => item.suggested?.from === "nota"));
  assert.equal(p.diagnosisPrompts?.length ?? 0, 0);
});
