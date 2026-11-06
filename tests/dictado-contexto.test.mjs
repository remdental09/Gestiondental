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

test("si la frase anterior nombra dos piezas, no se adivina y se pregunta", async () => {
  const p = await run("Piezas ocho y nueve. Se deja sellado con vidrio ionómero.");
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

test("«pieza cuatro una caries» es la pieza 4 con una caries, no la 4.1", async () => {
  const p = await run("En la pieza cuatro una caries de esmalte en oclusal, se restaura con resina compuesta.");
  assert.ok(p.odontogram.length > 0);
  assert.ok(p.odontogram.every((item) => item.numberingLabel.includes("FDI 1.5")), JSON.stringify(p.odontogram.map((o) => o.numberingLabel)));
});

test("«pieza cuatro uno» sigue siendo FDI 4.1", async () => {
  const p = await run("Pieza cuatro uno caries de esmalte en oclusal.");
  assert.ok(p.odontogram.some((item) => item.numberingLabel.includes("FDI 4.1")));
});

test("lo que se hace sigue a la última pieza nombrada, aunque después se nombre otra", async () => {
  const p = await run("En la pieza quince hay una caries de dentina superficial mesial. Se elimina la caries y se hace una restauración de resina compuesta mesial. En la pieza cuatro una caries de esmalte oclusal.");
  assert.ok(!p.clarifications.some((c) => /Falta una pieza identificable/.test(c)));
  assert.ok(p.odontogram.some((o) => o.numberingLabel.includes("FDI 2.7") && o.finding?.condition === "restored" || o.numberingLabel.includes("FDI 2.7") && o.surface === "M"));
});
