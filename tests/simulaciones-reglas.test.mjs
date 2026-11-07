import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-07" })).proposal;
const odo = (p) => p.odontogram.map((o) => `${o.tooth}:${o.kind === "surface" ? `${o.surface}/${o.finding?.condition}` : o.status}`);

test("extracción de una pieza más obturación en otra: la segunda no queda ausente", async () => {
  const p = await run("Se realiza extracción de la 2.4 mas implante inmediato, mas injerto, mas obturacion en la 1.6 oclusal por caries.");
  assert.ok(odo(p).includes("16:O/restored"));
  assert.ok(!odo(p).includes("16:Ausente"));
});

test("implante que finalmente no se instaló no queda como Implante", async () => {
  const p = await run("Extracción de la 2.4 con implante inmediato, pero finalmente no se instaló por falta de estabilidad primaria.");
  assert.ok(!odo(p).includes("24:Implante"));
});

test("obturación nominal «por caries» queda registrada como obturada", async () => {
  const p = await run("Obturación con resina compuesta en la pieza 1.6 oclusal por caries.");
  assert.deepEqual(odo(p), ["16:O/restored"]);
});

test("cambio de amalgama por resina con caries secundaria queda obturada", async () => {
  const p = await run("Cambio de amalgama por resina en la 1.5 oclusal, caries secundaria.");
  assert.deepEqual(odo(p), ["15:O/restored"]);
});

test("obturación de conductos, retrógrada o ferulización no son restauraciones", async () => {
  for (const text of ["Apicectomía en la 2.1 con obturación retrógrada con MTA.", "Luxación de la 1.1 por trauma, reposición y ferulización con alambre y resina por dos semanas.", "Pulpitis irreversible en la 2.6, se realiza endodoncia completa y obturación con gutapercha."]) {
    const p = await run(text);
    assert.ok(!(p.diagnosisPrompts ?? []).some((prompt) => prompt.procedure === "restauración"), text);
    assert.ok(!p.clarifications.some((q) => /Falta la superficie/.test(q)), text);
  }
});

test("alargamiento de corona clínica no deja la pieza como Corona; retracción con hilo no es recesión", async () => {
  assert.ok(!odo(await run("Alargamiento de corona clínica en la 2.1 por gingivectomía y osteoplastia.")).includes("21:Corona"));
  const p = await run("Preparación para corona de zirconio en la 2.6, retracción gingival con hilo, toma de impresión digital.");
  assert.ok(!p.diagnoses.some((dx) => dx.code === "DA0D.0"));
});

test("prestaciones de implante por reglas: instalación, extracción para implante inmediato; no en un plan", async () => {
  const done = await run("Se realiza exodoncia de la 4.7 y se instala implante en 4.7 de 4,3 por 11,5 con sutura nylon 4-0.");
  assert.deepEqual(done.prestaciones.map((x) => x.code).sort(), ["5011001", "5011018"]);
  const plan = await run("Plan: instalar implante en la 3.5 en tres meses, por ahora se extrae y se deja injerto.");
  assert.ok(!plan.prestaciones.some((x) => x.code === "5011001"));
});
