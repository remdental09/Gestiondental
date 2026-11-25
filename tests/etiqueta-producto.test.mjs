/** Todos los datos de la etiqueta y del código de un producto biomédico: medidas, registro, fechas y el resto. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUCT_EXTRA_FIELDS, LABEL_SCHEMA, cleanMeasure, cleanProductFields, labelExtras, measureText, parseDetails, parseLabelReading, productFigureLines } from "../lib/biomedical-products.ts";
import { parseProductCode, parseProductCodes, otherProduct, validGtin } from "../lib/product-code.ts";
import { applyLabel, applyPhoto, applyScan } from "../lib/product-draft.ts";
import { fichaMarkdown } from "../lib/backup-markdown.ts";
import { implantSuggestions, labelMeasures } from "../lib/implants.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** UDI ficticio con la forma del de una caja de implante. */
const UDI = "(01)07612345678900(11)240110(17)280109(10)9900001";
const empty = () => ({ category: "implante", brand: "", model: "", diameter: "", length: "", reference: "", lot: "", serial: "", manufactured: "", expiry: "", manufacturer: "", registration: "", gtin: "", details: [], code: "", categoryBy: "", scan: null, suggested: new Set(), fromCode: new Set() });
const reading = parseLabelReading({
  legible: true, category: "implante", brand: "Demo", model: "Implante Friccional Demo 3,3X9mm + Tapa", diameter: "3.3", length: "9 mm", reference: "REF-01", lot: "9900001", serial: "",
  manufactured: "2024-01-10", expiry: "2028-01-09", manufacturer: "FGM", registration: "ANVISA 00000000000", gtin: "7612345678900",
  other: [{ label: "Esterilización", value: "Radiación (STERILE R)" }, { label: "Vacío", value: "" }],
});

test("código UDI: producto, fabricación, vencimiento y lote; sin inventar medidas", () => {
  const code = parseProductCode(UDI);
  assert.deepEqual([code.gtin, code.manufactured, code.expiry, code.lot, code.serial, code.reference], ["7612345678900", "2024-01-10", "2028-01-09", "9900001", "", ""]);
  const both = parseProductCodes(["7612345678900", UDI, UDI]);
  assert.deepEqual([both.gtin, both.lot, both.manufactured], ["7612345678900", "9900001", "2024-01-10"]);
  assert.ok(both.raw.includes("(10)9900001"));
  assert.equal(parseProductCodes(["01076123456789001728050010AB123\x1d21SN99"]).raw.includes("\x1d"), false);
  assert.equal(parseProductCode("7612345678900").gtin, "7612345678900");
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
  const fields = cleanProductFields({ category: "implante", kind: "Implante", placedOn: "2026-11-24", ...reading, details: reading.other, code: UDI }, "2026-11-24");
  assert.equal(fields.diameter, "3,3");
  assert.deepEqual(parseDetails(fields.details), reading.other);
  const lines = productFigureLines({ ...fields, placedOnLabel: "24 nov 2026" });
  for (const text of ["Medidas: Ø 3,3 mm · largo 9 mm", "Registro sanitario: ANVISA 00000000000", "Fabricación: 10/01/2024", "GTIN: 7612345678900", "Otros datos: Esterilización: Radiación (STERILE R)"]) assert.ok(lines.includes(text), text);
  const long = productFigureLines({ ...fields, details: Array.from({ length: 30 }, (_, i) => ({ label: `Dato ${i}`, value: "x".repeat(240) })), placedOnLabel: "24 nov 2026" });
  assert.ok(long.every(line => line.length <= 720), "el documento no crece sin límite");
  assert.equal(measureText({ diameter: "", length: "" }), "");
  assert.deepEqual(labelExtras({ model: "", diameter: "", details: "[]", code: "" }), {});
  assert.deepEqual(Object.keys(labelExtras(fields)).sort(), [...PRODUCT_EXTRA_FIELDS].sort());
});

const OTHER = "(01)07890000000017(11)250301(17)290228(10)B-55(21)S-9";
const scanned = (draft, text, photo = false) => applyScan(draft, parseProductCodes([text]), photo);

test("borrador: el código manda, la IA completa las medidas y no pisa lo escrito a mano", () => {
  let draft = scanned(empty(), UDI).draft;
  assert.deepEqual([draft.lot, draft.expiry, draft.diameter, draft.code], ["9900001", "2028-01-09", "", UDI]);
  draft = { ...draft, brand: "Escrito a mano" };
  // un solo lote distinto en el texto leído se toma como error de lectura: manda el código y se avisa
  const photo = applyPhoto(draft, null, { ...reading, lot: "9900002", expiry: "2028-01" });
  assert.deepEqual([photo.droppedScan, photo.mismatch, photo.draft.lot, photo.draft.brand], [false, true, "9900001", "Escrito a mano"]);
  assert.deepEqual([photo.draft.diameter, photo.draft.length, photo.draft.registration], ["3,3", "9", "ANVISA 00000000000"]);
  assert.ok(photo.draft.suggested.has("diameter") && photo.draft.fromCode.has("lot") && !photo.draft.suggested.has("lot"));
  assert.equal(applyPhoto(scanned(empty(), UDI).draft, null, { legible: true, expiry: "2028-01" }).mismatch, false, "solo el mes no contradice la fecha completa");
  const typed = applyPhoto({ ...empty(), lot: "MANUAL" }, parseProductCodes([UDI]), null);
  assert.deepEqual([typed.draft.lot, typed.kept], ["MANUAL", ["lote"]]);
  const chosen = applyLabel({ ...empty(), category: "membrana", categoryBy: "user" }, reading).draft;
  assert.equal(chosen.category, "membrana", "el tipo elegido a mano no se cambia");
});

test("borrador: nunca se mezclan dos productos", () => {
  const first = applyPhoto(empty(), parseProductCodes([UDI]), reading).draft;
  // repetir la foto con otro producto, sin código legible: no queda nada del primero
  const second = applyPhoto(first, null, { legible: true, brand: "Otra", lot: "B-55" }).draft;
  assert.deepEqual([second.lot, second.brand, second.expiry, second.gtin, second.diameter, second.code, second.details], ["B-55", "Otra", "", "", "", "", []]);
  // escaneo del primero y foto de otro: el escaneo se descarta
  const dropped = applyPhoto(scanned(empty(), UDI).draft, parseProductCodes([OTHER]), null);
  assert.deepEqual([dropped.droppedScan, dropped.draft.lot, dropped.draft.serial, dropped.draft.code, dropped.draft.scan], [true, "B-55", "S-9", OTHER, null]);
  assert.equal(applyPhoto(scanned(empty(), UDI).draft, parseProductCodes([UDI]), { legible: true, lot: "9900007", expiry: "2027-01" }).droppedScan, false, "el código de la foto confirma el escaneo");
  // escanear otro sin foto reemplaza todo lo del anterior
  const replaced = scanned(scanned(empty(), OTHER).draft, "7612345678900").draft;
  assert.deepEqual([replaced.lot, replaced.serial, replaced.expiry, replaced.gtin], ["", "", "", "7612345678900"]);
  // escanear otro producto con la foto del primero se rechaza
  const refused = scanned(first, OTHER, true);
  assert.deepEqual([refused.rejected, refused.draft], [true, first]);
  assert.equal(scanned(first, UDI, true).rejected, false);
  // dos etiquetas distintas en una foto: no se usa ninguna
  const mixed = parseProductCodes([UDI, OTHER]);
  assert.deepEqual([mixed.mixed, mixed.lot, mixed.raw], [true, "", ""]);
  assert.equal(otherProduct({ lot: "A", expiry: "2028-01" }, { lot: "B", expiry: "2028-01" }, false), false);
  assert.equal(otherProduct({ lot: "A" }, { lot: "B" }, true), true);
});

test("códigos: un número o código interno no se toma como lote, serie ni producto", () => {
  for (const text of ["1045678", "2133090", "104567", "17281125", "https://ejemplo.cl/10/abc"]) {
    const code = parseProductCode({ text, format: "Code128" });
    assert.deepEqual([code.lot, code.serial, code.gtin, code.expiry], ["", "", "", ""], text);
  }
  assert.equal(parseProductCode({ text: "7612345678900", format: "Code128" }).gtin, "");
  assert.equal(parseProductCode({ text: "7612345678900", format: "EAN13" }).gtin, "7612345678900");
  assert.equal(parseProductCode({ text: "10AB12\x1d21S9", gs1: true, format: "DataMatrix" }).serial, "S9");
  assert.ok(validGtin("07612345678900") && !validGtin("07612345678901"));
});

test("descarga en Markdown: lista todos los datos de cada producto", () => {
  const markdown = fichaMarkdown({ patient: { id: 1, name: "Paciente Ficticio" }, evolutions: [], budgets: [], appointments: [], periodontalExams: [], odontogram: null, imageMetadata: [],
    biomedicalProducts: [{ id: 1, category: "implante", tooth: "3.6", placedOn: "2026-11-24", ...cleanProductFields({ category: "implante", placedOn: "2026-11-24", ...reading, details: reading.other, code: UDI }, "2026-11-24"), tooth: "3.6" }] }, "2026-11-24T00:00:00Z");
  for (const text of ["## Productos biomédicos", "pieza 3.6", "Medidas: Ø 3,3 mm", "Registro sanitario: ANVISA 00000000000", "Esterilización", "Contenido del código"]) assert.ok(markdown.includes(text), text);
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
  assert.match(read("components/implantology.tsx"), /<BiomedicalProducts key=\{visit\} embedded compact/);
  assert.match(read("components/biomedical-products.tsx"), /"Escanear etiqueta"/);
  const sql = read("drizzle/0028_product_label_fields.sql");
  // El tipo de pieza (`kind`) llegó después, con la 0030.
  assert.equal(sql.match(/ADD COLUMN/g).length, PRODUCT_EXTRA_FIELDS.filter(key => key !== "kind").length);
  assert.doesNotMatch(sql, /DROP|UPDATE|DELETE/);
  assert.ok(JSON.parse(read("drizzle/meta/_journal.json")).entries.some(entry => entry.tag === "0028_product_label_fields"));
  for (const key of PRODUCT_EXTRA_FIELDS) assert.match(read("app/api/productos/route.ts"), new RegExp(`${key}: (row\\.${key}|parseDetails\\(row\\.${key}\\))`));
});
