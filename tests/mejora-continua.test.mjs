import test from "node:test";
import assert from "node:assert/strict";
import { itemKind, summarizeImprovement } from "../lib/improvement.ts";
import { buildFeedback } from "../lib/dictation/feedback.ts";

const row = (owner, entries, at = "2026-11-10T10:00:00.000Z") => ({ owner_id: owner, entries: JSON.stringify(entries), created_at: at });

test("resume uso y correcciones por profesional, sin datos del paciente", () => {
  const entries = [
    { category: "prestacion", outcome: "rechazado", proposed: { code: "5005002", name: "OBTURACION DE AMALGAMA COMPUESTA", tooth: 16 } },
    { category: "prestacion", outcome: "aceptado", proposed: { code: "5010029", name: "INACTIVACION DE CARIES", tooth: 16 } },
    { category: "odontograma", outcome: "rechazado", proposed: { kind: "surface", tooth: 16, surface: "M", finding: { condition: "restored" }, sourceText: "texto dictado con nombre" } },
  ];
  const summary = summarizeImprovement([row("a", entries), row("b", [])], [{ owner_id: "a", fichas: 3, evoluciones: 5, evoluciones_30d: 2, ultima: "2026-11-09T10:00:00.000Z" }], [{ owner_id: "a", label: "Tú" }]);
  const me = summary.clinicians.find((item) => item.owner_id === "a");
  assert.equal(me.dictados, 1);
  assert.equal(me.fichas, 3);
  assert.equal(me.aceptacion, 1 / 3);
  const prest = summary.overall.find((group) => group.category === "prestacion");
  assert.equal(prest.corrected, 1);
  assert.match(prest.top[0].kind, /^5005002 · OBTURACION DE AMALGAMA COMPUESTA/);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /texto dictado con nombre/);
  assert.doesNotMatch(serialized, /"tooth"/);
  assert.equal(summary.clinicians.find((item) => item.owner_id === "b").label, "Colega sin perfil");
});

test("el tipo de un hallazgo de odontograma no incluye la pieza", () => {
  assert.equal(itemKind({ category: "odontograma", proposed: { kind: "surface", tooth: 36, finding: { condition: "caries" } } }), "Cara con caries");
  assert.equal(itemKind({ category: "prestacion", proposed: { code: "5009013", name: "DESTARTRAJE", objetada: true } }), "5009013 · DESTARTRAJE (objetada por el revisor)");
});

test("las prestaciones quitadas o agregadas quedan registradas como correcciones", () => {
  const entries = buildFeedback([{ category: "prestacion", proposed: [{ id: "pr-1", code: "5005002", name: "X", tooth: 16, objetada: false }], final: [{ id: "pr-1", code: "5005002", name: "X", tooth: 16, objetada: false, decision: "rejected" }, { id: "nuevo", code: "5010029", name: "Y", tooth: null, objetada: false, decision: "accepted" }] }]);
  assert.deepEqual(entries.map((entry) => [entry.category, entry.outcome]), [["prestacion", "rechazado"], ["prestacion", "agregado"]]);
});
