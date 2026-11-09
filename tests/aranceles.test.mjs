import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrice, normalizePriceMap, MAX_PRICE } from "../lib/aranceles.ts";
import { PRESTACIONES, PRESTACION_GROUPS } from "../lib/prestaciones-catalog.ts";

test("normalizePrice acepta enteros en pesos y formatos con puntos o $", () => {
  assert.equal(normalizePrice(45000), 45000);
  assert.equal(normalizePrice("45.000"), 45000);
  assert.equal(normalizePrice("$ 1.250.000"), 1250000);
});

test("normalizePrice rechaza vacío, cero, negativos, decimales y exceso", () => {
  for (const bad of ["", "abc", 0, -5, 1.5, "12,5", MAX_PRICE + 1, null, undefined, NaN]) assert.equal(normalizePrice(bad), null, String(bad));
});

test("normalizePriceMap conserva solo códigos de 7 dígitos con precio válido", () => {
  assert.deepEqual(normalizePriceMap({ "5001001": 20000, "123": 5, "5001002": "x", "5001003": "30.000" }), { "5001001": 20000, "5001003": 30000 });
  assert.deepEqual(normalizePriceMap(null), {});
});

test("el catálogo agrupa las 830 prestaciones en 18 grupos, todas con grupo conocido", () => {
  assert.equal(PRESTACIONES.length, 830);
  const names = new Set(PRESTACION_GROUPS.map(group => group.name));
  assert.equal(names.size, 18);
  assert.ok(PRESTACIONES.every(item => names.has(item.group)));
});
