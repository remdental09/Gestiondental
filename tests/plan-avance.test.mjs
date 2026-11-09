import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBudgetItems, itemTeeth, parseTeethText, budgetProgress, plannedByTooth, encodeBudgetData, decodeBudgetData } from "../lib/budget-plans.ts";

test("normaliza piezas y fecha realizada; descarta piezas y fechas inválidas", () => {
  const items = normalizeBudgetItems([{ label: "Corona", amount: 100, teeth: [46, 36, 36, 99, 19, 55], doneOn: "2026-11-09" }, { label: "Limpieza", amount: 50, doneOn: "2026-02-30" }]);
  assert.deepEqual(items[0].teeth, [36, 46, 55]);
  assert.equal(items[0].doneOn, "2026-11-09");
  assert.equal(items[1].doneOn, undefined);
  assert.equal(items[1].teeth, undefined);
});

test("las piezas y la fecha sobreviven al guardado", () => {
  const items = normalizeBudgetItems([{ label: "Implante", amount: 900000, teeth: [36], doneOn: "2026-10-01" }]);
  const back = decodeBudgetData(encodeBudgetData(items, { isAlternative: false, parentBudgetId: null }));
  assert.deepEqual(back.items[0].teeth, [36]);
  assert.equal(back.items[0].doneOn, "2026-10-01");
});

test("lee piezas escritas de varias formas", () => {
  assert.deepEqual(parseTeethText("3.6, 4.6"), [36, 46]);
  assert.deepEqual(parseTeethText("36 46 11"), [11, 36, 46]);
  assert.deepEqual(parseTeethText("pieza 1,1"), [11]);
  assert.deepEqual(parseTeethText("19 90 120"), []);
});

test("toma las piezas del nombre cuando no se asignaron", () => {
  assert.deepEqual(itemTeeth({ label: "Corona zirconio 3.6 y 4.6", amount: 1 }), [36, 46]);
  assert.deepEqual(itemTeeth({ label: "Corona 3.6", amount: 1, teeth: [11] }), [11]);
  assert.deepEqual(itemTeeth({ label: "Destartraje 2 sesiones", amount: 1 }), []);
  assert.deepEqual(itemTeeth({ label: "Valor 1.500.000", amount: 1 }), []);
});

test("avance: realizado, abonado, por cobrar y anticipo", () => {
  const items = [
    { label: "Exodoncia", amount: 100000, doneOn: "2026-10-01" },
    { label: "Implante", amount: 800000, discountPercent: 10, doneOn: "2026-10-15" },
    { label: "Corona", amount: 500000 },
  ];
  const p = budgetProgress(items, 300000);
  assert.equal(p.doneCount, 2);
  assert.equal(p.doneValue, 820000);
  assert.equal(p.pendingValue, 500000);
  assert.equal(p.owedForDone, 520000);
  assert.equal(p.advance, 0);
  assert.equal(p.percent, 67);
  assert.equal(budgetProgress(items, 1000000).advance, 180000);
});

test("odontograma: agrupa prestaciones por pieza, sin alternativas", () => {
  const map = plannedByTooth([
    { id: 1, title: "Plan A", isAlternative: false, items: [{ label: "Implante", amount: 1, teeth: [36] }, { label: "Corona 3.6", amount: 1, doneOn: "2026-11-01" }] },
    { id: 2, title: "Alt", isAlternative: true, items: [{ label: "Puente", amount: 1, teeth: [36] }] },
  ]);
  assert.equal(map[36].length, 2);
  assert.equal(map[36][1].doneOn, "2026-11-01");
  assert.equal(map[36][1].index, 1);
});
