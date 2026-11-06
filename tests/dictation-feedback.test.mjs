import test from "node:test";
import assert from "node:assert/strict";
import { buildFeedback, feedbackSummary } from "../lib/dictation/feedback.ts";

test("registro de correcciones: aceptado, editado, rechazado y agregado", () => {
  const entries = buildFeedback([
    {
      category: "periodontal",
      proposed: [
        { id: "a", site: "mesial", depth: 4, bleeding: false, origin: "reglas" },
        { id: "b", site: "distal", depth: 5, bleeding: true, origin: "ia" },
        { id: "c", site: "vestibular", depth: 3, bleeding: false, origin: "ia" },
      ],
      final: [
        { id: "a", decision: "accepted", site: "mesial", depth: 4, bleeding: false, origin: "reglas" },
        { id: "b", decision: "accepted", site: "distal", depth: 6, bleeding: true, origin: "ia" },
        { id: "c", decision: "rejected", site: "vestibular", depth: 3, bleeding: false, origin: "ia" },
        { id: "z", decision: "accepted", site: "palatino", depth: 2, bleeding: false },
      ],
    },
  ]);
  assert.deepEqual(entries.map((entry) => entry.outcome), ["aceptado", "editado", "rechazado", "agregado"]);
  assert.equal(entries[1].proposed.depth, 5);
  assert.equal(entries[1].final.depth, 6);
  assert.equal(entries[2].final, undefined);
  assert.deepEqual(feedbackSummary(entries), { accepted: 1, edited: 1, rejected: 1, added: 1 });
});

test("registro de correcciones: los campos de pantalla no cuentan como edición", () => {
  const [entry] = buildFeedback([{ category: "odontograma", proposed: [{ id: "t", tooth: 16, status: "caries" }], final: [{ id: "t", decision: "accepted", toothText: "1.6", tooth: 16, status: "caries" }] }]);
  assert.equal(entry.outcome, "aceptado");
});
