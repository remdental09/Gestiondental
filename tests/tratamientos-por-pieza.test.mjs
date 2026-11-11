import test from "node:test";
import assert from "node:assert/strict";
import { toothTreatments, openTreatments } from "../lib/tooth-treatments.ts";

const plan = (tooth, label, extra = {}) => ({ tooth, budgetId: 1, index: 0, label, ...extra });
const of = (all, tooth) => (all[tooth] ?? []).map((t) => [t.family, t.status]);

test("una prestación del plan sin sesiones queda planificada, aunque no tenga código ni nombre reconocible", () => {
  const all = toothTreatments([], [plan(36, "Endodoncia molar"), plan(11, "Tratamiento especial del doctor")]);
  assert.deepEqual(of(all, 36), [["endodoncia", "planificado"]]);
  assert.deepEqual(of(all, 11), [["otro", "planificado"]]);
  assert.equal(all[11][0].name, "Tratamiento especial del doctor");
});

test("la endodoncia avanza con las evoluciones: en curso hasta que se obturan los conductos", () => {
  const first = [{ tooth: 36, date: "2026-11-01", text: "apertura cameral y pulpectomía, medicación con hidróxido de calcio", noteId: 1 }];
  const mid = toothTreatments(first, [plan(36, "Endodoncia molar")]);
  assert.deepEqual(of(mid, 36), [["endodoncia", "en curso"]]);
  assert.match(mid[36][0].next, /obturar/);
  assert.equal(openTreatments(mid).length, 1);
  const end = toothTreatments([...first, { tooth: 36, date: "2026-11-08", text: "obturación de conductos con gutapercha", noteId: 2 }], [plan(36, "Endodoncia molar")]);
  assert.deepEqual(of(end, 36), [["endodoncia", "realizado"]]);
  assert.equal(end[36][0].sessions.length, 2);
  // La evolución la da por terminada y el presupuesto sigue pendiente: se ofrece cerrarla.
  assert.equal(end[36][0].closable?.label, "Endodoncia molar");
});

test("la corona queda en curso con tallado y provisorio, y se cierra al cementar la definitiva", () => {
  const prep = [{ tooth: 26, date: "2026-11-01", text: "preparación para corona de zirconio, impresión y corona provisoria" }];
  assert.deepEqual(of(toothTreatments(prep, []), 26), [["corona", "en curso"]]);
  const done = toothTreatments([...prep, { tooth: 26, date: "2026-11-15", text: "se cementa corona de zirconio" }], []);
  assert.deepEqual(of(done, 26), [["corona", "realizado"]]);
});

test("la obturación provisoria espera la definitiva; una obturación común queda realizada en una sesión", () => {
  const prov = [{ tooth: 16, date: "2026-11-10", text: "caries inactivada con vidrio ionómero provisorio en M y O" }];
  const open = toothTreatments(prov, []);
  assert.deepEqual(of(open, 16), [["provisorio", "en curso"]]);
  assert.match(open[16][0].next, /definitiva/);
  const closed = toothTreatments([...prov, { tooth: 16, date: "2026-12-01", text: "obturación con resina compuesta en M y O" }], []);
  assert.deepEqual(of(closed, 16).sort(), [["obturacion", "realizado"], ["provisorio", "realizado"]]);
  assert.deepEqual(of(toothTreatments([{ tooth: 46, date: "2026-11-10", text: "obturación con resina en oclusal" }], []), 46), [["obturacion", "realizado"]]);
});

test("un procedimiento no clasificado igual queda en la pieza como realizado, y lo marcado realizado en el plan manda", () => {
  const all = toothTreatments([{ tooth: 13, date: "2026-11-10", text: "desensibilizante en cuello dentario" }], [plan(45, "Corona metal cerámica", { doneOn: "2026-10-01" })]);
  assert.deepEqual(of(all, 13), [["otro", "realizado"]]);
  assert.deepEqual(of(all, 45), [["corona", "realizado"]]);
  assert.equal(all[45][0].closable, undefined);
});

import { treatmentAdvances } from "../lib/tooth-treatments.ts";
import { procedureSessions } from "../lib/tooth-evolution-milestones.ts";

test("una evolución nueva dice qué tratamiento avanza y ofrece cerrar el del presupuesto", () => {
  const prior = procedureSessions("Procedimientos realizados\n- FDI 3.6 (Chile 30): apertura cameral y pulpectomía.\n", "2026-11-01", 1);
  const planned = [plan(36, "Endodoncia molar"), plan(11, "Corona zirconio")];
  const mid = treatmentAdvances(prior, planned, procedureSessions("Procedimientos realizados\n- FDI 3.6: instrumentación y conometría.\n- Instrucción de higiene.\n", "2026-11-05"));
  assert.deepEqual(mid.map((a) => [a.tooth, a.name, a.from, a.to, Boolean(a.closable)]), [[36, "Endodoncia", "en curso", "en curso", false]]);
  const end = treatmentAdvances(prior, planned, procedureSessions("Procedimientos realizados\n- FDI 3.6: obturación de conductos con gutapercha.\n- FDI 4.6: obturación con resina oclusal.\n", "2026-11-08"));
  assert.deepEqual(end.map((a) => [a.tooth, a.name, a.from, a.to, a.closable?.label ?? null]), [[36, "Endodoncia", "en curso", "realizado", "Endodoncia molar"], [46, "Obturación", "nuevo", "realizado", null]]);
  assert.deepEqual(treatmentAdvances(prior, planned, procedureSessions("Motivo de consulta\nControl.", "2026-11-09")), []);
});

import { treatmentAlerts } from "../lib/tooth-treatments.ts";

test("etapa alcanzada y avisos por tiempo: provisorio sin definitiva, endodoncia a medias y sin rehabilitar", () => {
  const all = toothTreatments([
    { tooth: 16, date: "2026-09-01", text: "caries inactivada con vidrio ionómero provisorio" },
    { tooth: 36, date: "2026-10-01", text: "apertura cameral y pulpectomía" },
    { tooth: 36, date: "2026-10-10", text: "instrumentación de conductos" },
    { tooth: 45, date: "2026-09-15", text: "obturación de conductos con gutapercha" },
    { tooth: 26, date: "2026-11-05", text: "tallado para corona e impresión" },
  ], []);
  assert.equal(all[36][0].stage, "instrumentación");
  const alerts = treatmentAlerts(all, "2026-11-11");
  assert.deepEqual(alerts.map((a) => [a.tooth, a.name, a.days]), [[16, "Obturación provisoria", 71], [45, "Endodoncia sin rehabilitar", 57], [36, "Endodoncia", 32]]);
  assert.match(alerts[2].message, /quedó en instrumentación/);
  // Con rehabilitación posterior o dentro de plazo no avisa.
  const fine = toothTreatments([{ tooth: 45, date: "2026-09-15", text: "obturación de conductos con gutapercha" }, { tooth: 45, date: "2026-09-30", text: "se cementa corona de zirconio" }], []);
  assert.deepEqual(treatmentAlerts(fine, "2026-11-11"), []);
});

import { toothMarks } from "../lib/tooth-treatments.ts";

test("marcas por pieza: endodoncia, perno, carilla, incrustación, prótesis y ortodoncia con su estado", () => {
  const all = toothTreatments([
    { tooth: 15, date: "2026-10-01", text: "obturación de conductos con gutapercha" },
    { tooth: 15, date: "2026-10-20", text: "poste de fibra y muñón, tallado para corona" },
    { tooth: 13, date: "2026-10-05", text: "colocación de botón para tracción ortodóncica" },
    { tooth: 46, date: "2026-10-06", text: "se cementa incrustación de cerámica onlay" },
  ], [plan(21, "Carilla de porcelana"), plan(35, "Puente de tres unidades 3.5 a 3.7")]);
  const marks = toothMarks(all);
  const of2 = (tooth) => (marks[tooth] ?? []).map((m) => [m.kind, m.status]).sort();
  assert.deepEqual(of2(15), [["endodoncia", "realizado"], ["perno", "realizado"]]);
  assert.deepEqual(of2(13), [["ortodoncia", "en curso"]]);
  assert.deepEqual(of2(46), [["onlay", "realizado"]]);
  assert.deepEqual(of2(21), [["carilla", "planificado"]]);
  assert.deepEqual(of2(35), [["protesis", "planificado"]]);
  assert.equal(marks[11], undefined);
});
