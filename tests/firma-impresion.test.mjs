import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIGNATURE_BOX_CM, SIGNATURE_MAX_CHARS, cmToPt, fitInBox, inkBounds, outputScale, validSignature, worthTrimming } from "../lib/signature-image.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function canvas(width, height, ink) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (ink(x, y)) { data[i + 3] = 255; } else { data.fill(255, i, i + 3); data[i + 3] = 255; }
  }
  return data;
}

test("firma: recorta el espacio en blanco alrededor del trazo", () => {
  const data = canvas(600, 180, (x, y) => x >= 250 && x < 350 && y >= 80 && y < 100);
  const b = inkBounds(data, 600, 180, 6);
  assert.deepEqual(b, { x: 244, y: 74, width: 112, height: 32 });
  assert.equal(worthTrimming(b, 600, 180), true);
  assert.equal(inkBounds(canvas(50, 50, () => false), 50, 50), null, "sin trazo no hay firma");
  const transparent = new Uint8ClampedArray(40 * 40 * 4);
  assert.equal(inkBounds(transparent, 40, 40), null, "fondo transparente no es tinta");
  assert.equal(worthTrimming({ x: 0, y: 0, width: 590, height: 175 }, 600, 180), false);
});

test("firma: nunca se agranda al exportar y no supera 900×400", () => {
  assert.equal(outputScale({ x: 0, y: 0, width: 300, height: 100 }), 1);
  assert.ok(outputScale({ x: 0, y: 0, width: 1800, height: 200 }) * 1800 <= 900);
  assert.ok(outputScale({ x: 0, y: 0, width: 400, height: 1200 }) * 1200 <= 400);
});

test("firma: llena el recuadro de ≈6,5 × 2,7 cm sin deformarse (también la agranda)", () => {
  assert.deepEqual(SIGNATURE_BOX_CM, { width: 6.5, height: 2.7 });
  const w = cmToPt(6.5), h = cmToPt(2.7);
  assert.ok(Math.abs(w - 184.25) < 0.1 && Math.abs(h - 76.54) < 0.1);
  const wide = fitInBox(112, 32, w, h);
  assert.ok(Math.abs(wide.width - w) < 0.01 && wide.height < h + 0.01, "firma ancha usa todo el ancho");
  assert.ok(Math.abs(wide.width / wide.height - 112 / 32) < 0.001, "mantiene proporción");
  const tall = fitInBox(100, 100, w, h);
  assert.ok(Math.abs(tall.height - h) < 0.01 && tall.width <= w);
});

test("firma: valida PNG/JPG/WebP hasta 400 KB", () => {
  assert.equal(validSignature("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(validSignature("data:image/jpeg;base64,/9j/4AAQ"), true);
  assert.equal(validSignature("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(validSignature("javascript:alert(1)"), false);
  assert.equal(validSignature("data:image/png;base64," + "A".repeat(SIGNATURE_MAX_CHARS)), false);
  const route = read("app/api/documentos/imagen/route.ts");
  assert.match(route, /validSignature\(mark\)/);
  assert.match(route, /personalIdOf\(user\)/, "cada profesional guarda solo su propia firma");
});

test("firma: se edita en la identificación profesional y en Configuración → Profesionales", () => {
  assert.match(read("components/profile-dialog.tsx"), /<SignatureEditor compact\/>/);
  assert.match(read("components/professionals-panel.tsx"), /<SignatureEditor\/>/);
  const editor = read("components/signature-editor.tsx");
  assert.match(editor, /touch-none/, "el dedo dibuja, no desplaza la página en iPhone");
  assert.match(editor, /\/api\/documentos\/imagen/);
  const panel = read("components/documentation-panel.tsx");
  assert.doesNotMatch(panel, /function DocumentMarkEditor/);
  assert.match(panel, /Configuración → Profesionales/);
});

test("documento: firma grande con más espacio sobre la línea", () => {
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /h-\[2\.8cm\] w-\[6\.5cm\]/);
  assert.match(panel, /useTrimmedMark\(activeDocument\?\.documentMark/);
  assert.match(panel, /object-contain object-bottom/);
  const pdf = read("lib/budget-pdf.ts");
  assert.match(pdf, /fitInBox\(documentMark\.width, documentMark\.height, Math\.min\(cmToPt\(SIGNATURE_BOX_CM\.width\)/);
  assert.doesNotMatch(pdf, /maxW = 92, maxH = 42/);
});

test("impresión: solo el documento, hoja Carta, sin la app detrás", () => {
  const css = read("app/globals.css");
  assert.match(css, /@page\{size:letter;margin:10mm 12mm\}/);
  assert.doesNotMatch(css, /size:A4/);
  assert.match(css, /html\.gd-print-node body>\*:not\(#gd-print-root\)\{display:none!important\}/);
  assert.match(css, /#gd-print-root\{display:none\}/);
  const panel = read("components/documentation-panel.tsx");
  assert.doesNotMatch(panel, /window\.print\(\)/);
  assert.match(panel, /printNode\(document\.getElementById\("documentation-print"\)\)/);
  assert.match(panel, /"beforeprint"/);
  const helper = read("lib/print-node.ts");
  assert.match(helper, /afterprint/);
  assert.match(helper, /removeAttribute\("id"\)/, "la copia no duplica ids");
});
