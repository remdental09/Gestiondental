import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findViews } from "../lib/capture-detect.ts";
import { needsCut } from "../lib/capture-bridge.ts";
import { cutLabel, partOfWindow } from "../lib/capture-crop.ts";

/** Ventana inventada con la disposición de Blue Sky Plan: barra clara, recuadros negros, divisiones grises y reglas de color. */
function windowImage(panels, { width = 1100, height = 700, lines = [] } = {}) {
  const data = new Uint8Array(width * height * 4);
  const fill = (x, y, w, h, [r, g, b]) => { for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) data.set([r, g, b, 255], (row * width + column) * 4); };
  fill(0, 0, width, height, [238, 238, 238]);
  fill(0, 80, 900, 600, [0, 0, 0]);
  for (const [x, y, w, h] of lines) fill(x, y, w, h, [108, 108, 108]);
  for (const { x, y, w, h, rulers = [], label = false } of panels) {
    // Imagen en grises, como un corte, y la columna de botones a la derecha.
    fill(x + Math.round(w * 0.2), y + 30, Math.round(w * 0.55), h - 70, [120, 120, 120]);
    for (let button = 0; button < 4; button++) fill(x + w - 26, y + 6 + button * 25, 22, 22, [213, 213, 213]);
    rulers.forEach((color, index) => fill(x + 4 + index * Math.floor((w - 40) / rulers.length), y + h - 14, Math.floor((w - 40) / rulers.length) - 6, 4, color));
    if (label) fill(x + 4, y + 6, 120, 3, [242, 242, 0]);
  }
  return { width, height, data };
}
const BLUE = [102, 178, 255], GREEN = [78, 229, 53], PALE = [178, 229, 153], LILAC = [150, 150, 216], YELLOW = [238, 241, 124], PINK = [216, 108, 108];
const lines = [[0, 379, 900, 2], [300, 80, 2, 299], [600, 80, 2, 299], [378, 381, 2, 299]];
const layout = [
  { x: 0, y: 80, w: 298, h: 297, rulers: [LILAC, YELLOW, PINK] },
  { x: 304, y: 80, w: 294, h: 297, rulers: [BLUE] },
  { x: 604, y: 80, w: 296, h: 297, rulers: [GREEN] },
  { x: 0, y: 383, w: 376, h: 297, label: true },
  { x: 382, y: 383, w: 518, h: 297, rulers: [PALE] },
];
const inside = (rect, panel) => {
  assert.ok(rect, "vista encontrada");
  assert.ok(Math.abs(rect.x - panel.x) <= 6 && Math.abs(rect.y - panel.y) <= 6, JSON.stringify(rect));
  assert.ok(Math.abs(rect.height - panel.h) <= 6, JSON.stringify(rect));
  assert.ok(rect.x + rect.width <= panel.x + panel.w - 24 && rect.x + rect.width >= panel.x + panel.w - 40, "sin la columna de botones: " + JSON.stringify(rect));
};

test("cortes: ubica solas las cuatro vistas y no confunde el corte tangencial", () => {
  const found = findViews(windowImage(layout, { lines }));
  assert.deepEqual(Object.keys(found).sort(), ["Axial", "Panorámica", "Transversal", "Vista 3D"]);
  inside(found["Transversal"], layout[0]);
  inside(found["Axial"], layout[1]);
  inside(found["Vista 3D"], layout[3]);
  inside(found["Panorámica"], layout[4]);
});

test("cortes: reconoce una vista ampliada que ocupa toda el área", () => {
  const big = { x: 0, y: 80, w: 900, h: 600, rulers: [LILAC, YELLOW, PINK] };
  const found = findViews(windowImage([big]));
  assert.deepEqual(Object.keys(found), ["Transversal"]);
  inside(found["Transversal"], big);
});

test("cortes: si no reconoce nada, no recorta", () => {
  assert.deepEqual(findViews(windowImage([{ x: 0, y: 80, w: 900, h: 600 }])), {});
  assert.deepEqual(findViews({ width: 800, height: 600, data: new Uint8Array(800 * 600 * 4).fill(245) }), {});
});

test("cortes: solo recorta una ventana completa de Blue Sky Plan", () => {
  const base = { viewer: "Blue Sky Plan", view: "Axial", marked: [], wholeWindow: false, all: false };
  assert.equal(needsCut(base), true);
  assert.equal(needsCut({ ...base, marked: null }), true, "capturadora anterior");
  assert.equal(needsCut({ ...base, wholeWindow: true }), false);
  assert.equal(needsCut({ ...base, wholeWindow: true, all: true }), true);
  assert.equal(needsCut({ ...base, marked: ["Axial"] }), false, "ya viene recortada");
  assert.equal(needsCut({ ...base, view: "Radiografía" }), false);
  assert.equal(needsCut({ ...base, viewer: "Otro visor" }), false);
  assert.equal(needsCut({ ...base, viewer: null }), false);
});

test("cortes: con vistas marcadas en cualquier visor se puede pedir la ventana completa", () => {
  const panel = readFileSync(new URL("../components/capture-link.tsx", import.meta.url), "utf8");
  assert.match(panel, /\(blueSky \|\| !!marked\?\.length\) && <div [^>]*aria-label="Qué capturar"/);
});

test("cortes: el rótulo lleva el nombre que mostraba el visor, la vista y la fecha de Chile", () => {
  const night = new Date("2026-11-25T02:00:00Z");
  assert.equal(cutLabel("PRUEBA FICTICIA", "Transversal", night), "PRUEBA FICTICIA · Transversal · 24-11-2026");
  assert.equal(cutLabel(null, "Axial", night), "Axial · 24-11-2026");
});

/** Recorta de la ventana inventada el rectángulo dado, como quien sube un corte que ya venía recortado. */
function piece(image, { x, y, width, height }) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4);
  return { width, height, data };
}

test("subidas: se ofrece recortar una ventana completa y no un corte que ya venía recortado", () => {
  for (const window of [windowImage(layout, { lines }), windowImage([{ x: 0, y: 80, w: 900, h: 600, rulers: [LILAC, YELLOW, PINK] }])]) {
    const found = Object.values(findViews(window));
    assert.ok(found.length);
    for (const rect of found) {
      assert.equal(partOfWindow(rect, window.width, window.height), true);
      const cut = piece(window, rect);
      for (const again of Object.values(findViews(cut))) assert.equal(partOfWindow(again, cut.width, cut.height), false, "un corte ya recortado entra como está");
    }
  }
});

test("subidas: el rótulo no inventa nombre ni fecha", () => {
  assert.equal(cutLabel(null, "Transversal", null), "Transversal");
});

test("subidas: pegar, arrastrar y subir pasan por la propuesta; nada se guarda sin elegir", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const panel = read("../components/implantology.tsx"), card = read("../components/cut-offer.tsx");
  assert.match(panel, /cutViews\(original, "all", null, \{ date: null, partsOnly: true \}\)/);
  assert.match(panel, /onDrop=\{[^}]*receive\(/);
  assert.match(panel, /onChange=\{[^}]*receive\(/);
  assert.equal(panel.match(/receive\(files\)/g)?.length, 2, "Ctrl+V y botón Pegar");
  assert.match(panel, /view === "Radiografía"[^\n]*addFiles\(files\)/);
  assert.match(panel, /onCapture=\{\(file, as\) => addFiles\(\[file\], as\)\}/, "la capturadora ya recorta sola");
  assert.match(panel, /offers\.length > 0 && "las imágenes aún sin guardar"/, "cerrar o cambiar de implante pregunta");
  assert.match(panel, /if \(cutting\.current\) \{[^}]*return false; \}/);
  assert.equal(panel.match(/offer\.target !== current\?\.id\) return;/g)?.length, 2, "nunca a otro implante");
  assert.match(card, /Comprueba que sea de \{patientName\}/);
  assert.match(card, /Guardar completa/);
  assert.match(card, /No guardar/);
  assert.match(card, /behavior: still \? "auto" : "smooth"/, "respeta «reducir movimiento»");
});
