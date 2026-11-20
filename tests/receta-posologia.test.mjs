import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMedications, medicationLine, medicationDosis, autoQuantityText, computeQuantity, VIAS, VIAS_FRECUENTES, DOSE_UNIT_KEYS, TIME_UNIT_KEYS } from "../lib/clinical-documents.ts";

const base = { nombre: "Amoxicilina 500 mg", dosis: "", via: "oral", cantidad: "", posologia: "1", unidad: "comprimido", cada: "8", cadaUnidad: "hora", duracion: "7", duracionUnidad: "día", indicaciones: "" };

test("posología estructurada: 1 comprimido cada 8 horas por 7 días = 21 comprimidos", () => {
  assert.equal(computeQuantity(base), 21);
  assert.equal(autoQuantityText(base), "21 comprimidos");
  assert.equal(medicationLine(base), "1 comprimido cada 8 horas por 7 días (21 comp.). Vía: oral");
});

test("plurales y singulares en español", () => {
  assert.equal(medicationDosis({ ...base, posologia: "2", unidad: "cápsula", cada: "12", duracion: "5" }), "2 cápsulas cada 12 horas por 5 días (20 cáps.)");
  assert.equal(medicationDosis({ ...base, cada: "1", cadaUnidad: "día", duracion: "1", duracionUnidad: "semana" }), "1 comprimido cada día por 1 semana (7 comp.)");
  assert.equal(medicationDosis({ ...base, unidad: "ml", posologia: "10" }), "10 ml cada 8 horas por 7 días");
  assert.equal(medicationDosis({ ...base, posologia: "0,5", duracion: "" }), "0,5 comprimido cada 8 horas");
  assert.equal(autoQuantityText({ ...base, posologia: "1", cada: "24", duracion: "1" }), "1 comprimido");
  assert.equal(autoQuantityText({ ...base, unidad: "gota" }), "", "gotas no se cuentan por unidad");
  assert.equal(autoQuantityText({ ...base, duracion: "2", duracionUnidad: "hora" }), "", "duración menor que la frecuencia");
});

test("el servidor limpia, regenera la pauta y completa la cantidad si viene vacía", () => {
  const [m] = parseMedications(JSON.stringify([{ ...base, dosis: "texto viejo", unidad: "comprimido", cadaUnidad: "xx", extra: 1 }]));
  assert.equal(m.cadaUnidad, "");
  assert.equal(m.dosis, "1 comprimido por 7 días");
  const [n] = parseMedications(JSON.stringify([base]));
  assert.equal(n.dosis, "1 comprimido cada 8 horas por 7 días (21 comp.)");
  assert.equal(n.cantidad, "21 comprimidos");
  const [manual] = parseMedications(JSON.stringify([{ ...base, cantidad: "2 cajas" }]));
  assert.equal(manual.cantidad, "2 cajas");
});

test("recetas antiguas (pauta en texto libre) se imprimen igual que antes", () => {
  const old = { nombre: "Ibuprofeno 400 mg", dosis: "1 comprimido cada 8 horas por 3 días", via: "oral", cantidad: "9 comprimidos" };
  const [m] = parseMedications(JSON.stringify([old]));
  assert.deepEqual(m, old);
  assert.equal(medicationLine(m), "1 comprimido cada 8 horas por 3 días. Vía: oral");
});

test("listas de MekiDoc: unidades, tiempos y vías ordenadas", () => {
  for (const unit of ["ampolla", "aplicación", "cápsula", "comprimido", "gota", "gr", "ml", "mg", "u.i.", "parche", "pomo", "puff", "sobre", "supositorio", "tableta"]) assert.ok(DOSE_UNIT_KEYS.includes(unit), unit);
  assert.deepEqual(TIME_UNIT_KEYS, ["hora", "día", "semana", "mes", "año"]);
  assert.deepEqual(VIAS, [...VIAS].sort((a, b) => a.localeCompare(b, "es")));
  for (const via of ["bucal", "oral", "ótica", "intramuscular", "nebulización", "enjuague bucal", "transdérmica"]) assert.ok(VIAS.includes(via), via);
  assert.equal(VIAS_FRECUENTES[0], "oral");
  const panel = readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8");
  for (const id of ["medication-posologia", "medication-unidad", "medication-cada-unidad", "medication-duracion-unidad", "medication-indicaciones", "medication-cantidad"]) assert.ok(panel.includes(`"${id}"`), id);
  assert.match(panel, /<option value="">Seleccionar<\/option>/);
});
