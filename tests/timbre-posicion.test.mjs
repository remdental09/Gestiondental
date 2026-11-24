import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_STAMP_LAYOUT, STAMP_LIMITS, isDefaultStampLayout, isStampMoved, normalizeStampLayout, parseStampLayout, placeStamp, serializeStampLayout, stampCssBox, stampOpacity } from "../lib/stamp-layout.ts";
import { knockoutBackground } from "../lib/stamp-knockout.ts";
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
  const moved = placeStamp({ width: 400, height: 200 }, slot, { dx: 2, dy: -4, scale: 1, opacity: 1, knockout: false }, page, cmToPt);
  assert.ok(Math.abs(moved.x - (base.x + cmToPt(2))) < 1e-6);
  assert.ok(Math.abs(moved.y - (base.y + cmToPt(4))) < 1e-6, "dy negativo sube");
  const big = placeStamp({ width: 400, height: 200 }, slot, { dx: 0, dy: 0, scale: 2, opacity: 1, knockout: false }, page, cmToPt);
  assert.ok(Math.abs(big.width - base.width * 2) < 1e-6);
  assert.ok(Math.abs((big.x + big.width / 2) - (base.x + base.width / 2)) < 1e-6, "sigue centrado");
  assert.ok(Math.abs((big.y + big.height) - (base.y + base.height)) < 1e-6, "mantiene el borde superior");
});

test("el timbre nunca sale de la hoja y las medidas se acotan", () => {
  const out = placeStamp({ width: 400, height: 200 }, slot, { dx: 12, dy: -24, scale: 2, opacity: 1, knockout: false }, { width: 300, height: 400 }, cmToPt);
  assert.ok(out.x >= 0 && out.x + out.width <= 300 && out.y >= 0 && out.y + out.height <= 400);
  assert.deepEqual(normalizeStampLayout({ dx: 99, dy: -99, scale: 9, opacity: 0, knockout: "sí" }), { dx: STAMP_LIMITS.dx[1], dy: STAMP_LIMITS.dy[0], scale: STAMP_LIMITS.scale[1], opacity: STAMP_LIMITS.opacity[0], knockout: false });
  assert.deepEqual(normalizeStampLayout({ dx: "x", scale: NaN }), DEFAULT_STAMP_LAYOUT);
  assert.deepEqual(normalizeStampLayout(null), DEFAULT_STAMP_LAYOUT);
});

test("se guarda como texto: vacío = lugar de siempre; ida y vuelta sin perder nada", () => {
  assert.equal(serializeStampLayout(DEFAULT_STAMP_LAYOUT), "");
  assert.equal(parseStampLayout(""), null);
  assert.equal(parseStampLayout("{roto"), null);
  const layout = { dx: -3.5, dy: -12, scale: 0.8, opacity: 0.6, knockout: true };
  assert.deepEqual(parseStampLayout(serializeStampLayout(layout)), layout);
  assert.equal(isDefaultStampLayout(layout), false);
  assert.equal(isStampMoved({ dx: 0, dy: 0, scale: 1.5, opacity: 1, knockout: false }), false, "solo cambiar el tamaño no lo saca de su lugar");
  assert.equal(isStampMoved({ dx: 0, dy: -1, scale: 1, opacity: 1, knockout: false }), true);
  assert.equal(isDefaultStampLayout({ ...DEFAULT_STAMP_LAYOUT, opacity: 0.5 }), false, "solo cambiar la intensidad ya es un diseño propio");
  assert.equal(isDefaultStampLayout({ ...DEFAULT_STAMP_LAYOUT, knockout: true }), false);
  assert.equal(parseStampLayout('{"dx":1,"dy":-2,"scale":1}').opacity, 1, "diseños guardados en la primera entrega siguen valiendo");
});

test("la vista en pantalla usa las mismas medidas en cm que el PDF", () => {
  const css = stampCssBox({ dx: 2, dy: -6, scale: 1.5, opacity: 0.7, knockout: false }, { width: 5, height: 2.5 });
  assert.equal(css.flow.opacity, 0.7);
  assert.equal(css.flow.width, "7.5cm");
  assert.equal(css.float.height, "3.75cm");
  assert.equal(css.float.left, "calc(50% + -1.75cm)");
  assert.equal(css.float.top, "calc(0.375rem + -6cm)");
});

test("el PDF del documento se genera con y sin diseño de timbre, y movido no ocupa espacio bajo la firma", async () => {
  const input = { title: "Certificado", number: "00009", clinicName: "Clínica de prueba", clinicLines: ["Calle 1, Santiago"], doctorName: "Dr. Prueba Ejemplo", doctorLines: ["RUT 1-9"], patientLines: ["Paciente: PACIENTE DE PRUEBA"], issuedDate: "22 de noviembre de 2026", sections: [{ heading: "CERTIFICO", lines: ["Que el paciente asistió a atención odontológica."] }], doctorStamp: stampPng };
  const count = async layout => (await PDFDocument.load(await buildDocumentPdf({ ...input, stampLayout: layout }))).getPageCount();
  assert.equal(await count(undefined), 1);
  assert.equal(await count({ dx: 0, dy: -12, scale: 1.5, opacity: 0.5, knockout: false }), 1);
  assert.equal(await count({ dx: 20, dy: 50, scale: 3, opacity: 0, knockout: true }), 1, "valores absurdos se acotan en vez de romper el PDF");
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
  assert.match(layoutBranch, /saveStampLayout\(professionalId, layout\)/);
  // Solo el timbre sin fondo nuevo (que cambia lo que se imprime) gasta el permiso; mover o cambiar la intensidad no.
  assert.equal((layoutBranch.match(/consumeUnlock/g) ?? []).length, 1);
  assert.ok(layoutBranch.indexOf("consumeUnlock") > layoutBranch.indexOf("if (layout.knockout)"));
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
  for (const stampLayout of [undefined, null, { dx: 0, dy: 0, scale: 1.4, opacity: 0.4, knockout: false }, { dx: -6, dy: -10, scale: 1, opacity: 1, knockout: false }, { dx: 99, dy: -99, scale: 9, opacity: 9, knockout: true }]) {
    const pdf = await PDFDocument.load(await buildBudgetPdf({ ...budget, stampLayout }));
    assert.ok(pdf.getPageCount() >= 1);
  }
});

test("opacidad: el PDF dibuja el timbre con su intensidad y la vista en pantalla también", () => {
  assert.match(read("lib/document-pdf.ts"), /opacity: stampOpacity\(input\.stampLayout\)/);
  assert.match(read("lib/budget-pdf.ts"), /opacity: stampOpacity\(input\.stampLayout\)/);
  assert.equal(stampOpacity(null), 1);
  assert.equal(stampOpacity({ ...DEFAULT_STAMP_LAYOUT, opacity: 0.55 }), 0.55);
  assert.equal(stampOpacity({ ...DEFAULT_STAMP_LAYOUT, opacity: 0.01 }), STAMP_LIMITS.opacity[0]);
});

test("quitar fondo: el fondo gris pasa a transparente y la tinta azul se conserva", () => {
  const width = 40, height = 20, data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) { const x = p % width, y = Math.floor(p / width), ink = x >= 10 && x < 30 && y >= 6 && y < 14; data.set(ink ? [20, 40, 160, 255] : [150, 150, 150, 255], p * 4); }
  const result = knockoutBackground(data, width, height);
  assert.deepEqual(result.background, [150, 150, 150]);
  const at = (x, y) => (y * width + x) * 4;
  assert.equal(result.data[at(2, 2) + 3], 0, "el fondo queda transparente");
  assert.equal(result.data[at(20, 10) + 3], 255, "la tinta queda opaca");
  assert.deepEqual([...result.data.slice(at(20, 10), at(20, 10) + 3)], [20, 40, 160], "y conserva su color");
  assert.ok(result.removed > 0.5 && result.removed < 0.9);
});

test("quitar fondo: funciona con fondo blanco, y una imagen lisa se marca como «casi todo quitado»", () => {
  const width = 30, height = 30, white = new Uint8ClampedArray(width * height * 4).fill(255);
  assert.ok(knockoutBackground(white, width, height).removed > 0.97, "una foto sin tinta no sirve");
  const stamp = new Uint8ClampedArray(white); for (let y = 10; y < 20; y++) for (let x = 5; x < 25; x++) stamp.set([0, 0, 120, 255], (y * width + x) * 4);
  const out = knockoutBackground(stamp, width, height);
  assert.equal(out.data[(15 * width + 15) * 4 + 3], 255);
  assert.equal(out.data[3], 0);
});

test("la versión sin fondo se usa al imprimir solo si se pidió, y cambiar la imagen la invalida", () => {
  const db = read("app/document-mark-db.ts");
  assert.match(db, /parseStampLayout\(row\.layout\)\?\.knockout && row\.clean \? row\.clean : row\.mark/);
  assert.match(db, /set: \{ stampMark, stampClean: "", updatedAt/);
  for (const file of ["app/document-pdf.ts", "app/products-pdf.ts", "app/budget-mail.ts", "app/api/presupuesto/formato/route.ts"]) assert.match(read(file), /loadPrintableStamp/, file);
  assert.match(read("app/api/documentos/route.ts"), /loadPrintableStamp\(personalId\)/);
  assert.match(read("app/api/documentos/imagen/route.ts"), /knockout: false/);
  assert.match(read("drizzle/0025_stamp_clean.sql"), /ADD `stamp_clean` text DEFAULT '' NOT NULL/);
  assert.match(read("drizzle/meta/_journal.json"), /0025_stamp_clean/);
  const ui = read("components/stamp-placement.tsx");
  for (const id of ["stamp-opacity", "stamp-knockout"]) assert.match(ui, new RegExp(`data-testid="${id}"`));
});
