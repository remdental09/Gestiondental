import test from "node:test";
import assert from "node:assert/strict";
import { PRESTACION_SPECIALTIES, checkNewItems, normalizeName, variantName, SPECIALTY_KEYS, MAX_CREATE_AT_ONCE } from "../lib/custom-prestaciones.ts";

test("cada especialidad tiene variantes sin repetidos y ids únicos", () => {
  assert.equal(new Set(SPECIALTY_KEYS).size, SPECIALTY_KEYS.length);
  for (const spec of PRESTACION_SPECIALTIES) {
    assert.ok(spec.dimensions.length >= 1, spec.key);
    assert.equal(new Set(spec.dimensions.map(d => d.id)).size, spec.dimensions.length, spec.key);
    for (const d of spec.dimensions) { assert.ok(d.options.length >= 2, `${spec.key}/${d.id}`); assert.equal(new Set(d.options).size, d.options.length, `${spec.key}/${d.id}`); assert.ok(d.options.length <= MAX_CREATE_AT_ONCE); }
  }
});

test("operatoria ofrece 1 a 5 caras y endodoncia 1 a 5 conductos", () => {
  const caras = PRESTACION_SPECIALTIES.find(s => s.key === "operatoria").dimensions.find(d => d.id === "caras").options;
  assert.deepEqual(caras.map(o => o[0]), ["1", "2", "3", "4", "5"]);
  const conductos = PRESTACION_SPECIALTIES.find(s => s.key === "endodoncia").dimensions.find(d => d.id === "conductos").options;
  assert.deepEqual(conductos.map(o => o[0]), ["1", "2", "3", "4", "5"]);
});

test("variantName y normalizeName", () => {
  assert.equal(variantName(" Obturación de resina ", "2 caras"), "Obturación de resina — 2 caras");
  assert.equal(variantName("Control", ""), "Control");
  assert.equal(normalizeName("  Mi   prestación "), "Mi prestación");
  assert.equal(normalizeName("ab"), null);
  assert.equal(normalizeName("x".repeat(121)), null);
  assert.equal(normalizeName(5), null);
});

test("checkNewItems valida especialidad, nombres y precios", () => {
  const ok = checkNewItems({ specialty: "endodoncia", items: [{ name: "Endodoncia — 1 conducto", price: "120.000" }, { name: "endodoncia — 1 conducto", price: 5 }, { name: "Endodoncia — 2 conductos", price: "" }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.items, [{ name: "Endodoncia — 1 conducto", price: 120000 }, { name: "Endodoncia — 2 conductos", price: null }]);
  assert.equal(checkNewItems({ specialty: "otra", items: [{ name: "Algo", price: 1 }] }).ok, false);
  assert.equal(checkNewItems({ specialty: "general", items: [] }).ok, false);
  assert.equal(checkNewItems({ specialty: "general", items: [{ name: "Algo", price: "abc" }] }).ok, false);
  assert.equal(checkNewItems({ specialty: "general", items: [{ name: "Algo", price: -3 }] }).ok, false);
  assert.equal(checkNewItems({ specialty: "general", items: [{ name: "a", price: 1000 }] }).ok, false);
  assert.equal(checkNewItems({ specialty: "general", items: Array.from({ length: 31 }, (_, i) => ({ name: `Prestación ${i}`, price: 1000 })) }).ok, false);
  assert.equal(checkNewItems(null).ok, false);
});

import { SPECIALTY_CATALOG_GROUP } from "../lib/custom-prestaciones.ts";
import { PRESTACION_GROUPS } from "../lib/prestaciones-catalog.ts";

test("cada especialidad se asocia a un grupo real del catálogo (o a ninguno)", () => {
  const groups = new Set(PRESTACION_GROUPS.map(group => group.name));
  assert.deepEqual(Object.keys(SPECIALTY_CATALOG_GROUP).sort(), [...SPECIALTY_KEYS].sort());
  for (const [key, group] of Object.entries(SPECIALTY_CATALOG_GROUP)) assert.ok(group === null || groups.has(group), `${key} → ${group}`);
});
