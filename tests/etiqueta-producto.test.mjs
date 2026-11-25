/** Todos los datos de la etiqueta y del código de un producto biomédico: medidas, registro, fechas y el resto. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUCT_EXTRA_FIELDS, LABEL_SCHEMA, cleanMeasure, cleanProductFields, labelExtras, measureText, parseDetails, parseLabelReading, productFigureLines } from "../lib/biomedical-products.ts";
import { parseProductCode, parseProductCodes } from "../lib/product-code.ts";
import { applyCode, applyLabel, clearSuggested } from "../lib/product-draft.ts";
import { implantSuggestions, labelMeasures } from "../lib/implants.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** UDI ficticio con la forma del de una caja de implante. */
const UDI = "(01)07612345678901(11)240110(17)280109(10)9900001";
const empty = () => ({ category: "implante", brand: "", model: "", diameter: "", length: "", reference: "", lot: "", serial: "", manufactured: "", expiry: "", manufacturer: "", registration: "", gtin: "", details: [], code: "", suggested: new Set(), fromCode: new Set() });
const reading = parseLabelReading({
  legible: true, category: "implante", brand: "Demo", model: "Implante Friccional Demo 3,3X9mm + Tapa", diameter: "3.3", length: "9 mm", reference: "REF-01", lot: "9900001", serial: "",
  manufactured: "2024-01-10", expiry: "2028-01-09", manufacturer: "FGM", registration: "ANVISA 00000000000", gtin: "7612345678901",
  other: [{ label: "Esterilización", value: "Radiación (STERILE R)" }, { label: "Vacío", value: "" }],
});

test("código UDI: producto, fabricación, vencimiento y lote; sin inventar medidas", () => {
  const code = parseProductCode(UDI);
  assert.deepEqual([code.gtin, code.manufactured, code.expiry, code.lot, code.serial, code.reference], ["7612345678901", "2024-01-10", "2028-01-09", "9900001", "", ""]);
  const both = parseProductCodes(["7612345678901", UDI, UDI]);
  assert.deepEqual([both.gtin, both.lot, both.manufactured], ["7612345678901", "9900001", "2024-01-10"]);
  assert.ok(both.raw.includes("(10)9900001"));
  assert.equal(parseProductCodes(["01076123456789011728050010AB123\x1d21SN99"]).raw.includes("\x1d"), false);
  assert.equal(parseProductCode("7612345678901").gtin, "7612345678901");
  assert.equal(parseProductCode("9900001").gtin, "");
});

test("etiqueta: medidas, registro, fechas y el resto quedan limpios; nada si no es legible", () => {
  assert.deepEqual([reading.diameter, reading.length, reading.registration, reading.manufactured], ["3,3", "9", "ANVISA 00000000000", "2024-01-10"]);
  assert.deepEqual(reading.other, [{ label: "Esterilización", value: "Radiación (STERILE R)" }]);
  assert.equal(cleanMeasure("Ø 4.1 mm"), "4,1");
  assert.equal(cleanMeasure("15 x 20 mm"), "15 x 20 mm");
  assert.deepEqual(parseLabelReading({ legible: false, diameter: "3.3" }), { legible: false });
  assert.deepEqual(Object.keys(LABEL_SCHEMA.properties).sort(), [...LABEL_SCHEMA.required].sort(), "el modo estricto exige todas las propiedades");
});

test("registro: los datos nuevos se guardan y se imprimen; un producto anterior queda igual en el respaldo", () => {
  const fields = cleanProductFields({ category: "implante", placedOn: "2026-11-24", ...reading, details: reading.other, code: UDI }, "2026-11-24");
  assert.equal(fields.diameter, "3,3");
  assert.deepEqual(parseDetails(fields.details), reading.other);
  const lines = productFigureLines({ ...fields, placedOnLabel: "24 nov 2026" });
  for (const text of ["Medidas: Ø 3,3 mm · largo 9 mm", "Registro sanitario: ANVISA 00000000000", "Fabricación: 10/01/2024", "GTIN: 7612345678901", "Otros datos: Esterilización: Radiación (STERILE R)"]) assert.ok(lines.includes(text), text);
  const long = productFigureLines({ ...fields, details: Array.from({ length: 30 }, (_, i) => ({ label: `Dato ${i}`, value: "x".repeat(240) })), placedOnLabel: "24 nov 2026" });
  assert.ok(long.every(line => line.length <= 720), "el documento no crece sin límite");
  assert.equal(measureText({ diameter: "", length: "" }), "");
  assert.deepEqual(labelExtras({ model: "", diameter: "", details: "[]", code: "" }), {});
  assert.deepEqual(Object.keys(labelExtras(fields)).sort(), [...PRODUCT_EXTRA_FIELDS].sort());
});

test("borrador: el código manda, la IA completa las medidas y no pisa lo escrito a mano", () => {
  let draft = applyCode(empty(), parseProductCodes([UDI])).draft;
  assert.deepEqual([draft.lot, draft.expiry, draft.diameter, draft.code], ["9900001", "2028-01-09", "", UDI]);
  draft = { ...draft, brand: "Escrito a mano" };
  const applied = applyLabel(draft, { ...reading, lot: "9900002", expiry: "2028-01" });
  assert.equal(applied.mismatch, true, "un lote distinto al del código se avisa");
  assert.equal(applied.draft.lot, "9900001");
  assert.equal(applied.draft.brand, "Escrito a mano");
  assert.deepEqual([applied.draft.diameter, applied.draft.length, applied.draft.registration], ["3,3", "9", "ANVISA 00000000000"]);
  assert.ok(applied.draft.suggested.has("diameter") && applied.draft.fromCode.has("lot") && !applied.draft.suggested.has("lot"));
  assert.equal(applyLabel(applyCode(empty(), parseProductCodes([UDI])).draft, { legible: true, expiry: "2028-01" }).mismatch, false, "solo el mes no contradice la fecha completa");
  const retake = clearSuggested(applied.draft);
  assert.deepEqual([retake.diameter, retake.details, retake.brand, retake.lot], ["", [], "Escrito a mano", "9900001"]);
});

test("implantes: las medidas de la etiqueta llegan a la ficha del implante solo si son medidas posibles", () => {
  assert.deepEqual(labelMeasures({ diameter: "3,3", length: "9" }), { diameter: 3.3, length: 9 });
  assert.deepEqual(labelMeasures({ diameter: "15 x 20 mm", length: "900" }), { diameter: null, length: null });
  const [suggestion] = implantSuggestions({ implants: [], teeth: {}, labels: [{ id: 1, tooth: "3.6", brand: "Demo", reference: "REF-01", lot: "9900001", serial: "", placedOn: "2026-11-24", diameter: "3,3", length: "9" }] });
  assert.deepEqual([suggestion.draft.diameter, suggestion.draft.length], [3.3, 9]);
});

test("cableado: lector propio sin CDN, cámara que se cierra y migración que solo agrega columnas", () => {
  const reader = read("lib/code-reader.ts");
  assert.match(reader, /zxing_reader\.wasm\?url/);
  assert.match(reader, /locateFile/);
  assert.match(reader, /DataMatrix/);
  assert.match(read("components/code-scanner.tsx"), /getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(read("components/implantology.tsx"), /implant-scan/);
  const sql = read("drizzle/0028_product_label_fields.sql");
  assert.equal(sql.match(/ADD COLUMN/g).length, PRODUCT_EXTRA_FIELDS.length);
  assert.doesNotMatch(sql, /DROP|UPDATE|DELETE/);
  assert.ok(JSON.parse(read("drizzle/meta/_journal.json")).entries.some(entry => entry.tag === "0028_product_label_fields"));
  for (const key of PRODUCT_EXTRA_FIELDS) assert.match(read("app/api/productos/route.ts"), new RegExp(`${key}: (row\\.${key}|parseDetails\\(row\\.${key}\\))`));
});
