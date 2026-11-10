import test from "node:test";
import assert from "node:assert/strict";
import { evolutionMilestones, teethOfNote } from "../lib/tooth-evolution-milestones.ts";

test("una evolución de cualquier especialidad aparece en la línea de tiempo de su pieza", () => {
  const notes = [
    { id: 195, title: "Endodoncia · FDI 4.5", body: "Pulpectomía pieza 4.5. Diagnóstico: pulpitis irreversible sintomática.", clinicalDate: "2026-11-09", recordedAt: "2026-11-09T23:43:53.554Z" },
    { id: 194, title: "Atención · nacional chilena 20 · FDI 4.5", body: "Motivo de consulta\nEvaluación de la pieza 20.\nLa pieza 20 está adyacente al implante de la pieza 19.", clinicalDate: "2026-11-09" },
    { id: 90, title: "Control", body: "Sondaje de 4.5 mm en la pieza 3.6.", clinicalDate: "2026-10-01" },
    { id: 91, title: "Endodoncia · FDI 1.6", body: "x", status: "anulada" },
  ];
  const events = evolutionMilestones(notes);
  assert.deepEqual(events.map((e) => [e.sourceEvolutionId, e.tooth]), [[195, 45], [194, 45], [90, 36]]);
  assert.equal(events[0].title, "Endodoncia · FDI 4.5");
  assert.match(events[0].detail, /Pulpectomía pieza 4\.5/);
  assert.equal(events[0].clinicalDate, "2026-11-09");
});

test("el cuerpo solo cuenta si nombra una única pieza (no se atribuye a la vecina)", () => {
  assert.deepEqual(teethOfNote({ title: "Atención", body: "Pieza 2.5 adyacente a la 2.6." }), []);
  assert.deepEqual(teethOfNote({ title: "Implantes · FDI 3.6 y 4.6", body: "" }), [36, 46]);
});
