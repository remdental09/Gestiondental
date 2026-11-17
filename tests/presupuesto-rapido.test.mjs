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
  assert.equal(normalizeBudgetItems([{ label: "Exodoncia", amount: 0 }]), null);
  assert.equal(normalizeBudgetItems([{ label: "Exodoncia", amount: 0 }], true)?.[0].amount, 0);
  assert.equal(normalizeBudgetItems([{ label: "Exodoncia", amount: -1 }], true), null);
});

const teethOfRows = (text, numbering) => parseQuickBudget(text, numbering).rows.map((r) => [r.zone || r.teeth.join("+"), r.code]);
test("pieza o zona después del tratamiento, o separada por punto", () => {
  assert.deepEqual(parseQuickBudget("exodoncia 36").rows.map((r) => r.teeth), [[36]]);
  assert.deepEqual(parseQuickBudget("exodoncia pieza 36 y 38").rows.map((r) => r.teeth[0]), [36, 38]);
  assert.deepEqual(parseQuickBudget("36. Exodoncia. 14. Exodoncia.").rows.map((r) => r.teeth[0]), [36, 14]);
  assert.equal(parseQuickBudget("destartraje boca completa").rows[0].zone, "perm:boca");
  assert.equal(parseQuickBudget("exodoncia 36 resina 14").rows.length, 2);
  assert.equal(parseQuickBudget("36 exodoncia").leftovers.length, 0);
});

test("chilena: cantidades no son piezas y un número que no es pieza avisa", () => {
  const a = parseQuickBudget("chilena 30 endodoncia 3 conductos");
  assert.deepEqual(a.rows.map((r) => r.teeth[0]), [36]);
  assert.equal(a.leftovers.length, 0);
  const b = parseQuickBudget("chilena 30 exodoncia, una limpieza");
  assert.deepEqual(b.rows.filter((r) => r.teeth.length).map((r) => r.teeth[0]), [36]);
  const c = parseQuickBudget("chilena 36 exodoncia");
  assert.equal(c.leftovers.length, 1);
  assert.equal(parseQuickBudget("36 exodoncia 45 mil").leftovers.length, 0);
});

test("caras compuestas se cuentan", () => {
  const faces = (text) => parseQuickBudget(text).rows[0].code;
  const one = faces("36 resina oclusal");
  assert.notEqual(faces("36 resina ocluso distal"), one);
  assert.equal(faces("36 resina mod"), faces("36 resina tres superficies"));
  assert.equal(faces("36 resina dos superficies"), faces("36 resina ocluso distal"));
});

test("zona con tratamiento por pieza = una fila por pieza; zonas múltiples; rangos cruzan la línea media", () => {
  assert.equal(parseQuickBudget("cuadrante 2 exodoncia").rows.length, 8);
  assert.equal(parseQuickBudget("boca completa exodoncia").rows.every((r) => r.needsChoice), true);
  assert.deepEqual(parseQuickBudget("cuadrantes 1 y 2 pulido radicular").rows.map((r) => r.zone), ["perm:cuad-1", "perm:cuad-2"]);
  assert.deepEqual(parseQuickBudget("del 13 al 23 exodoncia").rows.map((r) => r.teeth[0]), [13, 12, 11, 21, 22, 23]);
  assert.deepEqual(parseQuickBudget("pieza 36 a la 38 exodoncia").rows.map((r) => r.teeth[0]), [36, 37, 38]);
});

test("exodoncia quirúrgica no se cobra como simple; duplicados se unen", () => {
  assert.equal(parseQuickBudget("36 exodoncia quirúrgica").rows[0].needsChoice, true);
  assert.equal(parseQuickBudget("36 exodoncia. 36 exodoncia").rows.length, 1);
});
