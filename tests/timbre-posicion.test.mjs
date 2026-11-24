import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_STAMP_LAYOUT, STAMP_LIMITS, isDefaultStampLayout, isStampMoved, normalizeStampLayout, parseStampLayout, placeStamp, serializeStampLayout, stampCssBox } from "../lib/stamp-layout.ts";
import { buildDocumentPdf } from "../lib/document-pdf.ts";
import { buildBudgetPdf } from "../lib/budget-pdf.ts";
import { STAMP_BOX_CM, cmToPt } from "../lib/signature-image.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stampPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const page = { width: 612, height: 792 };
const slot = { x: 250, y: 300, width: cmToPt(STAMP_BOX_CM.width), height: cmToPt(STAMP_BOX_CM.height) };

test("sin diseño propio el timbre queda exactamente en su lugar de siempre (centrado, colgando bajo la firma)", () => {
  const at = placeStamp({ width: 400, height: 200 }, slot, null, page, cmToPt);
  assert.ok(Math.abs(at.width - slot.width) < 1e-6 && Math.abs(at.height - slot.height) < 1e-6);
  assert.ok(Math.abs(at.x - slot.x) < 1e-6 && Math.abs(at.y - slot.y) < 1e-6);
  assert.deepEqual(placeStamp({ width: 400, height: 200 }, slot, DEFAULT_STAMP_LAYOUT, page, cmToPt), at);
});

test("dx mueve a la derecha, dy hacia abajo, y la escala crece desde arriba-centro", () => {
  const base = placeStamp({ width: 400, height: 200 }, slot, null, page, cmToPt);
  const moved = placeStamp({ width: 400, height: 200 }, slot, { dx: 2, dy: -4, scale: 1 }, page, cmToPt);
  assert.ok(Math.abs(moved.x - (base.x + cmToPt(2))) < 1e-6);
  assert.ok(Math.abs(moved.y - (base.y + cmToPt(4))) < 1e-6, "dy negativo sube");
  const big = placeStamp({ width: 400, height: 200 }, slot, { dx: 0, dy: 0, scale: 2 }, page, cmToPt);
  assert.ok(Math.abs(big.width - base.width * 2) < 1e-6);
  assert.ok(Math.abs((big.x + big.width / 2) - (base.x + base.width / 2)) < 1e-6, "sigue centrado");
  assert.ok(Math.abs((big.y + big.height) - (base.y + base.height)) < 1e-6, "mantiene el borde superior");
});

test("el timbre nunca sale de la hoja y las medidas se acotan", () => {
  const out = placeStamp({ width: 400, height: 200 }, slot, { dx: 12, dy: -24, scale: 2 }, { width: 300, height: 400 }, cmToPt);
  assert.ok(out.x >= 0 && out.x + out.width <= 300 && out.y >= 0 && out.y + out.height <= 400);
  assert.deepEqual(normalizeStampLayout({ dx: 99, dy: -99, scale: 9 }), { dx: STAMP_LIMITS.dx[1], dy: STAMP_LIMITS.dy[0], scale: STAMP_LIMITS.scale[1] });
  assert.deepEqual(normalizeStampLayout({ dx: "x", scale: NaN }), DEFAULT_STAMP_LAYOUT);
  assert.deepEqual(normalizeStampLayout(null), DEFAULT_STAMP_LAYOUT);
});

test("se guarda como texto: vacío = lugar de siempre; ida y vuelta sin perder nada", () => {
  assert.equal(serializeStampLayout(DEFAULT_STAMP_LAYOUT), "");
  assert.equal(parseStampLayout(""), null);
  assert.equal(parseStampLayout("{roto"), null);
  const layout = { dx: -3.5, dy: -12, scale: 0.8 };
  assert.deepEqual(parseStampLayout(serializeStampLayout(layout)), layout);
  assert.equal(isDefaultStampLayout(layout), false);
  assert.equal(isStampMoved({ dx: 0, dy: 0, scale: 1.5 }), false, "solo cambiar el tamaño no lo saca de su lugar");
  assert.equal(isStampMoved({ dx: 0, dy: -1, scale: 1 }), true);
});

test("la vista en pantalla usa las mismas medidas en cm que el PDF", () => {
  const css = stampCssBox({ dx: 2, dy: -6, scale: 1.5 }, { width: 5, height: 2.5 });
  assert.equal(css.flow.width, "7.5cm");
  assert.equal(css.float.height, "3.75cm");
  assert.equal(css.float.left, "calc(50% + -1.75cm)");
  assert.equal(css.float.top, "calc(0.375rem + -6cm)");
});

test("el PDF del documento se genera con y sin diseño de timbre, y movido no ocupa espacio bajo la firma", async () => {
  const input = { title: "Certificado", number: "00009", clinicName: "Clínica de prueba", clinicLines: ["Calle 1, Santiago"], doctorName: "Dr. Prueba Ejemplo", doctorLines: ["RUT 1-9"], patientLines: ["Paciente: PACIENTE DE PRUEBA"], issuedDate: "22 de noviembre de 2026", sections: [{ heading: "CERTIFICO", lines: ["Que el paciente asistió a atención odontológica."] }], doctorStamp: stampPng };
  const count = async layout => (await PDFDocument.load(await buildDocumentPdf({ ...input, stampLayout: layout }))).getPageCount();
  assert.equal(await count(undefined), 1);
  assert.equal(await count({ dx: 0, dy: -12, scale: 1.5 }), 1);
  assert.equal(await count({ dx: 20, dy: 50, scale: 3 }), 1, "valores absurdos se acotan en vez de romper el PDF");
  const bytes = async layout => (await buildDocumentPdf({ ...input, stampLayout: layout })).length;
  assert.ok(await bytes({ dx: 0, dy: 0, scale: 1 }) > 0);
});

test("todos los documentos reciben el diseño del timbre de su autor", () => {
  for (const file of ["app/document-pdf.ts", "app/products-pdf.ts", "app/budget-mail.ts", "app/api/presupuesto/formato/route.ts"]) assert.match(read(file), /stampLayout/, file);
  assert.match(read("app/api/documentos/route.ts"), /stampLayout: layouts\.get\(row\.document\.createdBy\)/);
  assert.match(read("lib/budget-pdf.ts"), /placeStamp\(stampImage/);
  assert.match(read("lib/document-pdf.ts"), /placeStamp\(stamp,/);
});

test("mover el timbre no exige el código al correo (no cambia la imagen) y se puede volver al lugar de siempre", () => {
  const route = read("app/api/documentos/imagen/route.ts");
  const layoutBranch = route.slice(route.indexOf('"stampLayout" in body'), route.indexOf("// Un guardado cambia una sola imagen"));
  assert.match(layoutBranch, /saveStampLayout\(personalIdOf\(user\), layout\)/);
  assert.doesNotMatch(layoutBranch, /consumeUnlock/);
  assert.match(layoutBranch, /body\.stampLayout === null \? DEFAULT_STAMP_LAYOUT/);
  assert.match(read("drizzle/0024_stamp_layout.sql"), /ADD `stamp_layout` text DEFAULT '' NOT NULL/);
  assert.match(read("drizzle/meta/_journal.json"), /0024_stamp_layout/);
  assert.match(read("db/schema.ts"), /stampLayout: text\("stamp_layout"\)/);
});

test("el editor del timbre ofrece arrastrar, flechas, tamaño y volver al lugar de siempre", () => {
  const ui = read("components/stamp-placement.tsx");
  for (const id of ["stamp-placement", "stamp-draggable", "stamp-scale", "stamp-reset", "stamp-layout-save"]) assert.match(ui, new RegExp(`data-testid="${id}"`));
  assert.match(read("components/signature-editor.tsx"), /isStamp && mark && !dirty && <StampPlacement image=\{mark\}\/>/);
});

test("el presupuesto también respeta el diseño del timbre y no se rompe con valores extremos", async () => {
  const budget = { budget: { id: 7, title: "Plan", date: "22 nov 2026", items: [{ label: "Destartraje", amount: 45000, zone: "perm:boca" }] }, patientName: "Paciente Ejemplo", professionalName: "Dr(a). Ana Pérez", professionalSpecialty: "Periodoncia", professionalDocument: "12.345.678-5", stampMark: stampPng };
  for (const stampLayout of [undefined, null, { dx: 0, dy: 0, scale: 1.4 }, { dx: -6, dy: -10, scale: 1 }, { dx: 99, dy: -99, scale: 9 }]) {
    const pdf = await PDFDocument.load(await buildBudgetPdf({ ...budget, stampLayout }));
    assert.ok(pdf.getPageCount() >= 1);
  }
});
