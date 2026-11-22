import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCatalog, searchCatalog, prettyName, prettyIngredient, formFromName, controlNotice, normalizeKey } from "../lib/medication-catalog.ts";
import { DOSE_UNIT_KEYS, VIAS } from "../lib/clinical-documents.ts";

const file = JSON.parse(readFileSync(new URL("../public/datos/medicamentos-isp.json", import.meta.url), "utf8"));
const catalog = loadCatalog(file);

test("el catálogo ISP se carga completo y sin registros duplicados", () => {
  assert.equal(catalog.length, 9314);
  assert.equal(new Set(catalog.map(p => p.registro)).size, catalog.length);
  assert.equal(file.exportado, "2026-11-22");
  assert.ok(catalog.some(p => p.control === "Psicotrópico") && catalog.some(p => p.control === "Estupefaciente"));
});

test("la búsqueda ignora tildes y mayúsculas, y ofrece primero el principio activo", () => {
  for (const q of ["amoxicilina", "AMOXICILINA", "amoxicilína"]) {
    const [first, ...rest] = searchCatalog(catalog, q);
    assert.equal(first.kind, "generico");
    assert.equal(first.nombre, "Amoxicilina");
    assert.ok(rest.every(s => s.kind === "producto" || s.kind === "generico"));
  }
  const ibu = searchCatalog(catalog, "ibuprofeno 400");
  assert.ok(ibu.some(s => s.kind === "producto" && /ibuprofeno|actron/i.test(`${s.label} ${s.detalle}`)));
  assert.ok(searchCatalog(catalog, "articaina").length > 0, "anestésico dental");
  assert.deepEqual(searchCatalog(catalog, "a"), [], "una letra no busca");
  assert.deepEqual(searchCatalog(catalog, "zzzxqq"), []);
});

test("busca por marca y por varias palabras", () => {
  const r = searchCatalog(catalog, "actron 600");
  assert.ok(r.length && r[0].kind === "producto");
  assert.match(r[0].nombre, /Actron 600/);
  assert.equal(searchCatalog(catalog, "ibuprofeno", 8).length <= 8, true);
});

test("formatos legibles sin cambiar el contenido", () => {
  assert.equal(prettyName("AMBILAN BID 875/125 COMPRIMIDOS RECUBIERTOS"), "Ambilan BID 875/125 comprimidos recubiertos");
  assert.equal(prettyName("ACTRON 400 CÁPSULAS BLANDAS 400 mg"), "Actron 400 cápsulas blandas 400 mg");
  assert.equal(prettyIngredient("ACIDO CLAVULANICO//AMOXICILINA"), "Acido clavulanico + amoxicilina");
  assert.equal(normalizeKey("Ácido  Clavulánico"), "acido clavulanico");
});

test("la forma farmacéutica sugerida existe en las listas de la receta y no inventa dosis", () => {
  const cases = [["AMBILAN BID 875/125 COMPRIMIDOS RECUBIERTOS", "comprimido", "oral"], ["ACTRON 400 CÁPSULAS BLANDAS", "cápsula", "oral"], ["ALGIASOL FORTE SUSPENSIÓN ORAL 200 mg/5 mL", "ml", "oral"], ["POLYPTIN LIOFILIZADO PARA SOLUCIÓN INYECTABLE", "ampolla", ""], ["XYLOCAINE GEL TÓPICO", "aplicación", "tópica"], ["COLUTORIO CLORHEXIDINA 0,12%", "enjuague", "enjuague bucal"], ["PRODUCTO RARO", "", ""]];
  for (const [name, unidad, via] of cases) assert.deepEqual(formFromName(name), { unidad, via }, name);
  for (const p of catalog) { const f = formFromName(p.nombre); assert.ok(!f.unidad || DOSE_UNIT_KEYS.includes(f.unidad), `${p.nombre}: ${f.unidad}`); assert.ok(!f.via || VIAS.includes(f.via), `${p.nombre}: ${f.via}`); }
});

test("los fármacos de control muestran un aviso y los demás no", () => {
  assert.match(controlNotice("Psicotrópico"), /retenida/);
  assert.match(controlNotice("Estupefaciente"), /cheque/);
  assert.equal(controlNotice(""), "");
  const psico = catalog.find(p => p.control === "Psicotrópico");
  assert.equal(searchCatalog(catalog, psico.nombre.split(" ")[0]).some(s => s.control === "Psicotrópico"), true);
});

test("el editor de recetas usa el buscador y el archivo del catálogo existe donde lo pide el navegador", () => {
  const panel = readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<MedicationNameInput/);
  assert.match(panel, /data-testid="medication-control"/);
  const search = readFileSync(new URL("../components/medication-search.tsx", import.meta.url), "utf8");
  assert.match(search, /\/datos\/medicamentos-isp\.json/);
  assert.match(search, /data-testid="medication-nombre"/);
});
