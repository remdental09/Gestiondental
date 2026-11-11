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

import { endoMilestones } from "../lib/tooth-evolution-milestones.ts";
test("lo registrado en Endodoncia aparece fechado en la pieza, sin repetir lo ya enviado a la historia", () => {
  const cases = [{ id: "c1", tooth: 45, type: "Pulpectomía", openedOn: "2026-11-09", pulpal: "Pulpitis irreversible sintomática", periapical: "Periodontitis apical sintomática", closedReason: "",
    sessions: [{ id: "s1", date: "2026-11-09", steps: ["Acceso cameral"], medication: "Hidróxido de calcio" }, { id: "s2", date: "2026-11-16", steps: ["Obturación"], medication: "" }],
    obturation: { date: "2026-11-16", technique: "Condensación lateral" }, followUps: [] }];
  const notes = [{ id: 195, title: "Endodoncia · FDI 4.5", body: "", clinicalDate: "2026-11-09" }];
  const events = endoMilestones(cases, notes);
  assert.deepEqual(events.map((e) => [e.clinicalDate, e.title]), [
    ["2026-11-09", "Endodoncia iniciada · Pulpectomía"],
    ["2026-11-16", "Sesión de endodoncia · Pulpectomía"],
    ["2026-11-16", "Endodoncia obturada"],
  ]);
  assert.ok(events.every((e) => e.tooth === 45));
});

test("cada procedimiento que nombra una pieza queda en el historial de esa pieza (no solo el título de la evolución)", () => {
  const notes = [{ id: 210, title: "Operatoria", body: "Motivo de consulta\nDolor.\n\nProcedimientos realizados\n- FDI 1.6 (Chile 3): caries inactivada con vidrio ionómero provisorio en M y O.\n- FDI 3.5 (Chile 21): recubrimiento pulpar indirecto con hidróxido de calcio.\n- Instrucción de higiene oral.\n\nPlan\nControl.", clinicalDate: "2026-11-10" }];
  const events = evolutionMilestones(notes);
  assert.deepEqual(events.map((e) => [e.tooth, e.title]), [
    [16, "caries inactivada con vidrio ionómero provisorio en M y O."],
    [35, "recubrimiento pulpar indirecto con hidróxido de calcio."],
  ]);
  assert.match(events[0].detail, /ionómero provisorio/);
  assert.equal(new Set(events.map((e) => e.id)).size, 2);
  assert.ok(events.every((e) => e.clinicalDate === "2026-11-10" && e.sourceEvolutionId === 210));
});
