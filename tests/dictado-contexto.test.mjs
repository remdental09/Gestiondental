import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const run = async (transcript) =>
  (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;

test("«Hasta la próxima sesión» no crea cita ni pregunta por el día", async () => {
  const p = await run("Hasta la próxima sesión.");
  assert.equal(p.appointments.length, 0);
  assert.ok(!p.clarifications.some((c) => /pr[oó]xima cita/i.test(c)));
});

test("una cita con fecha sigue creándose", async () => {
  const p = await run("Paciente se cita el jueves a las 10.");
  assert.equal(p.appointments.length, 1);
  assert.equal(p.appointments[0].day, "2026-11-12");
});

test("una frase sin pieza hereda la de la frase vecina si es única", async () => {
  const p = await run("Preparación de la pieza ocho. Se deja sellado con vidrio ionómero.");
  assert.ok(!p.clarifications.some((c) => /Falta una pieza identificable/.test(c)));
});

test("si las frases vecinas apuntan a piezas distintas, se sigue preguntando", async () => {
  const p = await run("Pieza ocho. Se deja sellado con vidrio ionómero. Pieza nueve.");
  assert.ok(p.clarifications.some((c) => /Falta una pieza identificable/.test(c)));
});

test("la pieza dictada unas frases antes se hereda si es la única del dictado", async () => {
  const p = await run("Preparación de la pieza ocho. Se trepana. Así que el diagnóstico está claro. Se deja sellado con vidrio ionómero.");
  assert.ok(!p.clarifications.some((c) => /Falta una pieza identificable/.test(c)));
});

test("«el diagnóstico está claro» no genera aviso si otra frase sí dicta un diagnóstico", async () => {
  const p = await run("Diagnóstico de periodontitis apical crónica en la pieza ocho. Así que el diagnóstico está claro.");
  assert.ok(!p.clarifications.some((c) => /No se creó un diagnóstico confirmado/.test(c)));
});

test("sin diagnóstico reconocido en ninguna frase sigue avisando", async () => {
  const p = await run("El diagnóstico está pendiente en la pieza ocho.");
  assert.ok(p.clarifications.some((c) => /No se creó un diagnóstico confirmado/.test(c)));
});
