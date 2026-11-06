import test from "node:test";
import assert from "node:assert/strict";
import { PRESTACIONES, PRESTACION_GROUPS, searchPrestaciones, prestacionLabel } from "../lib/prestaciones-catalog.ts";

test("el catálogo trae las 830 prestaciones en 18 grupos, con códigos únicos y sin precios", () => {
  assert.equal(PRESTACIONES.length, 830);
  assert.equal(PRESTACION_GROUPS.length, 18);
  assert.equal(new Set(PRESTACIONES.map((item) => item.code)).size, 830);
  assert.ok(PRESTACIONES.every((item) => /^\d{7}$/.test(item.code) && item.name && item.group));
  assert.ok(!PRESTACIONES.some((item) => /\$/.test(item.name)));
});

test("la búsqueda ignora tildes y mayúsculas y acepta palabras en cualquier orden", () => {
  assert.ok(searchPrestaciones("EXTRACCION incluida").some((item) => item.code === "5003042"));
  assert.ok(searchPrestaciones("pieza sellante").some((item) => item.code === "5001005"));
  assert.equal(searchPrestaciones("s").length, 0);
  assert.equal(searchPrestaciones("zzzzqq").length, 0);
});

test("la búsqueda por código y la etiqueta legible", () => {
  assert.equal(searchPrestaciones("5001001")[0]?.code, "5001001");
  assert.equal(prestacionLabel("APLICACION DE SELLANTE POR PIEZA"), "Aplicación de sellante por pieza");
  assert.equal(prestacionLabel("FERULA PARA TTM"), "Férula para TTM");
});
