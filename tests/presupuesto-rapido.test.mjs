import test from "node:test";
import assert from "node:assert/strict";
import { parseQuickBudget, quickRowToItem } from "../lib/quick-budget.ts";

const codes = (rows) => rows.map((r) => `${r.code ?? "?"}:${r.zone || r.teeth.join("+")}`);

test("dictado por tramos en FDI: pieza → tratamiento", () => {
  const { rows, numbering } = parseQuickBudget("36 exodoncia. 14 15 resina dos caras. Boca completa destartraje");
  assert.equal(numbering, "fdi");
  assert.equal(rows[0].teeth[0], 36);
  assert.match(rows[0].label, /xodoncia/i);
  assert.deepEqual(rows.filter((r) => r.code && /Obturaci|resina|composite/i.test(r.label)).map((r) => r.teeth[0]), [14, 15]);
  assert.ok(rows.some((r) => r.zone === "perm:boca"));
});

test("sin puntos entre tramos: una pieza nueva abre otro tramo", () => {
  const { rows } = parseQuickBudget("36 exodoncia 46 exodoncia");
  assert.deepEqual(rows.map((r) => r.teeth), [[36], [46]]);
});

test("números dichos con palabras y puntos FDI", () => {
  const { rows } = parseQuickBudget("tres seis exodoncia, dos punto seis exodoncia");
  assert.deepEqual(rows.map((r) => r.teeth[0]), [36, 26]);
});

test("numeración chilena: 30 es la 3.6; los puntos siguen siendo FDI", () => {
  const { rows, numbering } = parseQuickBudget("numeración chilena 30 exodoncia. 1.4 exodoncia");
  assert.equal(numbering, "chile");
  assert.deepEqual(rows.map((r) => r.teeth[0]), [36, 14]);
});

test("rango y cuadrante", () => {
  const a = parseQuickBudget("del 14 al 17 exodoncia");
  assert.deepEqual(a.rows.map((r) => r.teeth[0]), [14, 15, 16, 17]);
  const b = parseQuickBudget("cuadrante 2 pulido radicular");
  assert.equal(b.rows[0].zone, "perm:cuad-2");
});

test("sin prestación clara queda para elegir; tramo sin tratamiento va a pendientes", () => {
  const { rows, leftovers } = parseQuickBudget("36 algo raro inexistente. 14");
  assert.equal(rows[0].needsChoice, true);
  assert.equal(rows[0].code, null);
  assert.equal(leftovers.length, 1);
});

test("fila a prestación: valor por definir = 0 y zona fija las piezas", () => {
  const { rows } = parseQuickBudget("cuadrante 2 pulido radicular");
  const item = quickRowToItem(rows[0], 0);
  assert.equal(item.amount, 0);
  assert.equal(item.zone, "perm:cuad-2");
  assert.ok(codes(rows).length);
});

import { normalizeBudgetItems } from "../lib/budget-plans.ts";
test("valor por definir (0) es válido; negativo no", () => {
  assert.equal(normalizeBudgetItems([{ label: "Exodoncia", amount: 0 }])?.[0].amount, 0);
  assert.equal(normalizeBudgetItems([{ label: "Exodoncia", amount: -1 }]), null);
});
