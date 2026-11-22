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
  assert.match(read("app/page.tsx"), /item\.kind!=="Producto biomédico"/);
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
