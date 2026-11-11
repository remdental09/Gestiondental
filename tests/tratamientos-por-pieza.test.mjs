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
