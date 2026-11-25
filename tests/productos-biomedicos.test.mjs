import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildDocumentPdf } from "../lib/document-pdf.ts";
import { cleanProductFields, cleanExpiry, cleanTooth, parseLabelReading, missingTrace, categoryLabel, PRODUCT_IMAGE_KIND, productFigureLines } from "../lib/biomedical-products.ts";
import { tabAllowed } from "../lib/role-policy.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("productos: fechas de vencimiento y piezas FDI se normalizan", () => {
  assert.equal(cleanExpiry("2028-05"), "2028-05");
  assert.equal(cleanExpiry("05/2028"), "2028-05");
  assert.equal(cleanExpiry("basura"), "");
  assert.equal(cleanTooth("36"), "3.6");
  assert.equal(cleanTooth("3.6"), "3.6");
  assert.equal(cleanTooth("99"), "");
});

test("productos: no se acepta categoría inválida ni fecha de colocación futura", () => {
  const ok = { category: "implante", brand: "Straumann", lot: "L123", placedOn: "2026-11-20" };
  assert.ok(cleanProductFields(ok, "2026-11-22"));
  assert.equal(cleanProductFields({ ...ok, category: "otra-cosa" }, "2026-11-22"), null);
  assert.equal(cleanProductFields({ ...ok, placedOn: "2027-01-01" }, "2026-11-22"), null);
});

test("productos: si la etiqueta no es legible, la IA no propone nada (nada de lotes inventados)", () => {
  assert.deepEqual(parseLabelReading({ legible: false, lot: "ABC" }), { legible: false });
  const read = parseLabelReading({ legible: true, brand: "Geistlich", lot: "L9", category: "injerto" });
  assert.equal(read.lot, "L9"); assert.equal(read.category, "injerto");
  assert.ok(missingTrace({ lot: "", serial: "" }) && !missingTrace({ lot: "L9", serial: "" }));
});

test("productos: el PDF de trazabilidad incluye la figura y funciona sin N° de documento", async () => {
  const bytes = await buildDocumentPdf({
    title: "Registro de trazabilidad", clinicName: "Clínica", clinicLines: [], doctorName: "Dr. Prueba", doctorLines: [],
    patientLines: ["Paciente: X"], issuedDate: "22 de noviembre de 2026", sections: [],
    figures: [{ title: `1. ${categoryLabel("implante")} · Straumann`, lines: productFigureLines({ reference: "R1", lot: "L1", serial: "S1", expiry: "2028-05", manufacturer: "", note: "", placedOnLabel: "20 nov 2026" }) }],
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
});

test("productos: cableado de rutas, rol, kind y respaldo", () => {
  assert.equal(PRODUCT_IMAGE_KIND, "Producto biomédico");
  assert.match(read("app/api/images/route.ts"), /Producto biomédico/);
  assert.match(read("components/evolution-rail.tsx"), /rail-producto/);
  assert.match(read("app/page.tsx"), /value:"productos"/);
  assert.doesNotMatch(read("app/page.tsx"), /item\.kind!=="Producto biomédico"/, "la foto del producto también se ve en Imágenes de la ficha");
  assert.match(read("app/api/images/[id]/route.ts"), /biomedicalProducts\.imageId/);
  assert.match(read("app/drive-backup.ts"), /biomedicalProducts/);
  assert.equal(tabAllowed("recepcion", "productos"), false);
  assert.equal(tabAllowed("asistente", "productos"), false);
  assert.equal(tabAllowed("odontologo", "productos"), true);
});

test("productos: migración 0021 registrada en el journal", () => {
  assert.match(read("drizzle/0021_biomedical_products.sql"), /biomedical_products/);
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some(entry => entry.tag === "0021_biomedical_products"));
});

import { parseProductCode, codeHasFields, gs1Date } from "../lib/product-code.ts";

test("QR: GS1 con paréntesis, sin paréntesis (FNC1) y Digital Link entregan lote, serie y vencimiento", () => {
  for (const payload of ["(01)07612345678900(17)280500(10)AB123(21)SN99", "01076123456789001728050010AB123\x1d21SN99", "https://id.gs1.org/01/07612345678900/10/AB123/21/SN99?17=280500"]) {
    const code = parseProductCode(payload);
    assert.deepEqual([code.lot, code.serial, code.expiry, code.gtin], ["AB123", "SN99", "2028-05", "7612345678900"], payload);
  }
  assert.equal(gs1Date("281231"), "2028-12-31");
  assert.equal(gs1Date("281340"), "");
});

test("QR: texto con LOT/SN/REF/EXP se lee; un QR sin datos solo conserva el texto bruto", () => {
  const code = parseProductCode("LOT: A55 SN: 123 REF: X-1 EXP: 2028-05");
  assert.deepEqual([code.lot, code.serial, code.reference, code.expiry], ["A55", "123", "X-1", "2028-05"]);
  const plain = parseProductCode("https://ejemplo.cl/p/1");
  assert.equal(codeHasFields(plain), false);
  assert.equal(plain.raw, "https://ejemplo.cl/p/1");
  assert.equal(parseProductCode(null).raw, "");
});

test("códigos: el formulario los lee en el equipo, el código manda sobre la IA y la IA recibe su texto", () => {
  const form = read("components/biomedical-products.tsx");
  assert.match(form, /readCodes\(file\)/);
  assert.match(form, /applyPhoto\(base, code, !read\.fields \|\| slot \? read\.fields : /);
  assert.match(form, /code: code\?\.raw/);
  assert.match(form, /products-scan/);
  assert.match(read("app/api/productos/leer/route.ts"), /body\?\.code/);
});
