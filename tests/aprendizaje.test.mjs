import test from "node:test";
import assert from "node:assert/strict";
import { learnFromFeedback } from "../lib/dictation/learning.ts";
import { buildFeedback } from "../lib/dictation/feedback.ts";
import { proposeFromTranscript, structureTranscript } from "../lib/dictation/proposal.ts";

const row = (entries) => ({ entries: JSON.stringify(entries) });
const sugerido = (outcome, code = "DA0A.1") => ({ category: "diagnostico", outcome, proposed: { code, title: "x", suggested: { from: "nota" } } });
const citaSinHora = (outcome) => ({ category: "cita", outcome, proposed: { day: "2026-11-14", time: null, reason: "Control" } });

test("una sugerencia que se mostró 5 veces y nunca se aceptó se deja de sugerir para ese profesional", () => {
  const learned = learnFromFeedback([row([sugerido("rechazado"), sugerido("ignorado"), sugerido("rechazado")]), row([sugerido("ignorado"), sugerido("rechazado")])]);
  assert.deepEqual(learned.dxCodes, ["DA0A.1"]);
  assert.match(learned.reasons[0], /Pérdida de dientes/);
});

test("si alguna vez la aceptó, o se mostró menos de 5 veces, se sigue sugiriendo", () => {
  assert.deepEqual(learnFromFeedback([row([sugerido("rechazado"), sugerido("rechazado"), sugerido("rechazado"), sugerido("rechazado"), sugerido("aceptado")])]).dxCodes, []);
  assert.deepEqual(learnFromFeedback([row([sugerido("rechazado"), sugerido("rechazado")])]).dxCodes, []);
  // Un diagnóstico dictado (no sugerido) nunca cuenta para apagar sugerencias.
  assert.deepEqual(learnFromFeedback([row(Array.from({ length: 6 }, () => ({ category: "diagnostico", outcome: "rechazado", proposed: { code: "DA0A.1" } })))]).dxCodes, []);
});

test("citas sin hora nunca agendadas: dejan de proponerse y quedan como recordatorio", async () => {
  const learned = learnFromFeedback([row(Array.from({ length: 5 }, () => citaSinHora("ignorado")))]);
  assert.equal(learned.hideUntimedAppointments, true);
  const { proposal } = await proposeFromTranscript({ transcript: "Se realiza profilaxis. Control en una semana.", chart: [] }, null, () => {}, { today: "2026-11-07", learned });
  assert.equal((proposal.appointments ?? []).length, 0);
  assert.ok(proposal.clarifications.some((item) => /Control indicado en una semana \(≈ 14-11-2026\): agéndalo/.test(item)));
  // Sin aprendizaje, se sigue proponiendo.
  const plain = await proposeFromTranscript({ transcript: "Se realiza profilaxis. Control en una semana.", chart: [] }, null, () => {}, { today: "2026-11-07" });
  assert.equal(plain.proposal.appointments.length, 1);
});

test("una sugerencia que venía desmarcada y no se tomó queda como «ignorado», no como rechazo", () => {
  const entries = buildFeedback([{ category: "diagnostico", proposed: [{ id: "dx-1", code: "DA0A.1", suggested: { from: "nota" } }], final: [{ id: "dx-1", code: "DA0A.1", suggested: { from: "nota" }, decision: "rejected" }], uncheckedByDefault: (item) => Boolean(item.suggested) }]);
  assert.equal(entries[0].outcome, "ignorado");
});

test("«en una semana» y «en un mes» se entienden como fecha", () => {
  assert.equal(structureTranscript("Control en una semana.", { today: "2026-11-07" }).appointments[0].day, "2026-11-14");
  assert.equal(structureTranscript("Control en un mes.", { today: "2026-11-07" }).appointments[0].day, "2026-12-07");
});

test("el aprendizaje nunca oculta un diagnóstico dictado con otro nombre (AAE o aproximado)", () => {
  const ignored = (from) => ({ category: "diagnostico", outcome: "ignorado", proposed: { code: "DA09.0", suggested: { from } } });
  assert.deepEqual(learnFromFeedback([row(Array.from({ length: 6 }, () => ignored("AAE")))]).dxCodes, []);
  assert.deepEqual(learnFromFeedback([row(Array.from({ length: 6 }, () => ignored("aproximado")))]).dxCodes, []);
  assert.deepEqual(learnFromFeedback([row(Array.from({ length: 6 }, () => ignored("nota")))]).dxCodes, ["DA09.0"]);
});

test("con citas sin hora aprendidas, no queda la pregunta por la hora junto al recordatorio", async () => {
  const learned = learnFromFeedback([row(Array.from({ length: 5 }, () => citaSinHora("ignorado")))]);
  const { proposal } = await proposeFromTranscript({ transcript: "Se realiza profilaxis. Control el martes 17.", chart: [] }, null, () => {}, { today: "2026-11-10", learned });
  assert.ok(!proposal.clarifications.some((item) => /^¿A qué hora es la cita/.test(item)));
});

test("fechas: el plural gana al singular; mes corto; «y media»", () => {
  assert.equal(structureTranscript("El dolor aumentó en una semana. Control en tres semanas.", { today: "2026-11-07" }).appointments[0].day, "2026-11-28");
  assert.equal(structureTranscript("Control en un mes.", { today: "2027-01-31" }).appointments[0].day, "2027-02-28");
  assert.equal(structureTranscript("Control en una semana y media.", { today: "2026-11-07" }).appointments[0].day, "2026-11-17");
});
