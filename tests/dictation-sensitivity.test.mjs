import test from "node:test";
import assert from "node:assert/strict";
import { calmClarifications, isChatter, parseSensitivity, DEFAULT_SENSITIVITY } from "../lib/dictation/sensitivity.ts";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

// Textos de avisos y dictado ficticios, sin datos de pacientes.
const RUIDO = [
  "IA: La frase «sesenta por ciento sin problema fue un toogood» no es clínicamente interpretable. ¿Qué término quiso dictar con «toogood» y corresponde registrar algún dato clínico?",
  "Comprensión clínica: FDI 2.1 P: se agregó la cara dictada que faltaba (obturada).",
  "Revisión clínica (IA): FDI 2.1: la cara mesial no debe quedar registrada como caries.",
  "Revisión clínica (IA) · prestación 5005005: Prestación duplicada. Quedó sin marcar.",
  "Revisión clínica (IA) · nota: La nota registra caries superficial, pero el dictado indica media.",
  "Hallazgo negado, sin cambio de odontograma: «sin caries».",
];
const NECESARIOS = [
  "Falta una pieza identificable en: «hice una resina».",
  "Falta la superficie del hallazgo: «caries en la 1.6».",
  "¿La exodoncia ya se realizó o solo está indicada? No se cambió el estado de la pieza.",
];

test("por defecto la revisión es básica y solo «full» activa la completa", () => {
  assert.equal(DEFAULT_SENSITIVITY, "basic");
  assert.equal(parseSensitivity(undefined), "basic");
  assert.equal(parseSensitivity("cualquier cosa"), "basic");
  assert.equal(parseSensitivity("full"), "full");
});

test("el nivel básico quita los avisos de conversación y deja las preguntas necesarias", () => {
  const all = [...RUIDO, ...NECESARIOS];
  assert.deepEqual(calmClarifications(all, "basic"), NECESARIOS);
  assert.deepEqual(calmClarifications(all, "full"), all);
  for (const note of RUIDO) assert.equal(isChatter(note), true, note);
  for (const note of NECESARIOS) assert.equal(isChatter(note), false, note);
});

const TRANSCRIPCION = "Caries de dentina media en mesial de la pieza 2.1. Se realiza obturación de composite palatino mesial.";
function modelo() {
  const llamadas = { review: 0 };
  return {
    llamadas,
    model: {
      id: "falso", model: "falso",
      complete: async () => ({ usedModel: "falso", output: { nota: { motivo: "Control.", examen: "Caries de dentina media en la pieza 2.1." }, texto_corregido: TRANSCRIPCION } }),
      review: async () => { llamadas.review += 1; return { observaciones: [{ pieza: "2.1", motivo: "La cara mesial no debe quedar como caries." }] }; },
    },
  };
}

test("en nivel básico no se llama a la segunda opinión de la IA ni aparecen sus avisos", async () => {
  const { model, llamadas } = modelo();
  const { proposal } = await proposeFromTranscript({ transcript: TRANSCRIPCION, chart: [] }, model, () => {}, { today: "2026-11-20", sensitivity: "basic" });
  assert.equal(llamadas.review, 0);
  assert.equal(proposal.clarifications.some((note) => /^Revisión clínica \(IA\)/.test(note)), false);
  assert.equal(proposal.clarifications.some(isChatter), false);
});

test("en nivel completo sí se consulta la segunda opinión", async () => {
  const { model, llamadas } = modelo();
  const { proposal } = await proposeFromTranscript({ transcript: TRANSCRIPCION, chart: [] }, model, () => {}, { today: "2026-11-20", sensitivity: "full" });
  assert.equal(llamadas.review, 1);
  assert.ok(proposal.clarifications.some((note) => /^Revisión clínica \(IA\)/.test(note)), "en completo los avisos de la IA se conservan");
});
