import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { resolveSpokenDate, isAppointmentText } from "../lib/dictation/spoken.ts";

// Textos sintéticos escritos como una ficha (con encabezados de sección). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;

test("un encabezado de sección solo en su línea no es algo dictado: no crea «Otros dichos» ni avisos", async () => {
  const p = await run("Procedimientos realizados\nSe realiza tomografía computarizada de haz cónico. Se efectúa ajuste oclusal y se deja la pieza 2.7 sin oclusión.");
  assert.ok(!/Otros dichos/.test(p.evolution.body), p.evolution.body);
  assert.ok(!p.clarifications.some((c) => /Revisa que la evolución incluya/.test(c)), JSON.stringify(p.clarifications));
});

test("«se controla el plano superior» no es una cita; «control en un año» sí, con fecha", async () => {
  assert.equal(isAppointmentText("Se controla el plano superior y se realiza alivio."), false);
  assert.equal(isAppointmentText("Se controla el lunes 30 en la mañana."), true);
  const date = resolveSpokenDate("Se indica control en un año.", "2026-11-24");
  assert.equal(date?.date, "2027-11-24");
  const p = await run("Se cementa la corona en la pieza 2.5. Se controla el plano superior y se realiza alivio.");
  assert.ok(!p.clarifications.some((c) => /próxima cita/.test(c)), JSON.stringify(p.clarifications));
});

test("prótesis removible, brackets y prueba de maqueta sin pieza no llevan diagnóstico de caries ni de pérdida de dientes", async () => {
  for (const text of [
    "Se realiza entrega de prótesis tipo Valplast. Se indica no comer con la prótesis.",
    "Se realiza prueba de maqueta de prótesis fija plural y se efectúan ajustes de anatomía.",
  ]) {
    const p = await run(text);
    assert.deepEqual(p.diagnoses ?? [], [], `${text} -> ${JSON.stringify(p.diagnoses)}`);
  }
});

test("endodoncia con trepanación o medicación intraconducto: diagnóstico pulpar, no «trastornos de los dientes»", async () => {
  const p = await run("Se realiza trepanación endodóntica en la pieza 3.1. Se deja medicación intraconducto con hidróxido de calcio y se coloca algodón con vidrio ionómero.");
  const dx = (p.diagnoses ?? []).filter((d) => d.tooth === 31);
  assert.ok(dx.length >= 1 && dx.every((d) => d.code.startsWith("DA09")), JSON.stringify(dx));
  assert.ok(!p.clarifications.some((c) => /Falta la superficie/.test(c)), JSON.stringify(p.clarifications));
});

test("blanqueamiento intracoronario con tope cervical de vidrio ionómero no es una restauración ni una caries", async () => {
  const p = await run("Se realiza segunda sesión de blanqueamiento intracoronario en la pieza 4.3, con perborato de sodio, algodón y tope cervical de vidrio ionómero.");
  assert.deepEqual(p.diagnoses ?? [], [], JSON.stringify(p.diagnoses));
  assert.ok(!p.clarifications.some((c) => /Falta la superficie|\(restauración\)/.test(c)), JSON.stringify(p.clarifications));
});
