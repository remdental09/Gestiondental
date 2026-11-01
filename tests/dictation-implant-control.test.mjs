import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript, aiFailureReason } from "../lib/dictation/proposal.ts";
import { applyLexicon } from "../lib/dictation/spoken.ts";

const TEXT = "Paciente el motivo de consulta la paciente viene a control por un implante integral la pieza 2,6 marca Arcis dos la pieza de 33 × 8 está todo bien cerró bien fue una técnica Flappers se encuentra todo bien sin hemorragia sin sangrado está en buen estado y está conectado con un pilar de 2 mm todo indicado si está bien se le indica a la paciente y nos que nos vemos en tres semanas más";

test("diccionario: flapless, pieza 2.6 y medida del implante 3,3 × 8 mm", () => {
  const { text, corrections } = applyLexicon(TEXT);
  assert.match(text, /técnica Flapless/);
  assert.match(text, /pieza 2\.6 /);
  assert.match(text, /3,3 × 8 mm/);
  assert.ok(corrections.length >= 3);
  // Sin «implante» en el texto, «33 x 8» no se toca.
  assert.equal(applyLexicon("pagó 33 x 8 cuotas").text, "pagó 33 x 8 cuotas");
});

test("control de implante sin puntuación: nota por secciones, cita y aclaraciones (reglas)", async () => {
  const outcome = await proposeFromTranscript({ transcript: TEXT, chart: [] }, null, () => {}, { today: "2026-11-01" });
  const body = outcome.proposal.evolution?.body ?? "";
  assert.match(body, /^Motivo y relato\n/);
  assert.match(body, /Otros hallazgos del examen\n/);
  assert.match(body, /Próxima cita\n/);
  assert.doesNotMatch(body, /Pendiente de preguntar/);
  assert.ok(!outcome.proposal.odontogram.some((item) => item.tooth === 33), "la medida 3,3 × 8 no es la pieza 3.3");
  assert.deepEqual(outcome.proposal.appointments.map((item) => item.day), ["2026-11-22"]);
  assert.ok(outcome.proposal.clarifications.some((q) => /Arcsys/.test(q)));
  assert.ok(outcome.proposal.clarifications.some((q) => /oseointegrado/.test(q)));
});

test("si la IA falla se informa el motivo para reintentar", async () => {
  const failing = { id: "x", model: "m", complete: async () => { throw new Error("@cf/meta/llama: 4006: you have used up your daily free allocation of 10,000 neurons"); } };
  const outcome = await proposeFromTranscript({ transcript: TEXT, chart: [] }, failing, () => {}, { today: "2026-11-01" });
  assert.equal(outcome.engine, "reglas-locales");
  assert.match(outcome.aiError ?? "", /cupo diario gratuito/);
  assert.match(aiFailureReason("Timed out"), /tardó/);
});
