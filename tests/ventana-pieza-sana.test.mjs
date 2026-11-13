import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isHealthyWindow, toothPhotoFor, toothVideoFor, TOOTH_VIDEOS } from "../lib/tooth-photos.ts";

const modal = readFileSync(new URL("../components/tooth-3d-modal.tsx", import.meta.url), "utf8");

test("solo la pieza «Sin hallazgos», sin hallazgos de superficie ni periodontograma, usa foto o video", () => {
  assert.equal(isHealthyWindow("Sin hallazgos", 0, false), true);
  assert.equal(isHealthyWindow("Sin hallazgos", 1, false), false);
  assert.equal(isHealthyWindow("Sin hallazgos", 0, true), false);
  for (const status of ["Corona", "Ausente", "Implante", "Implante con pilar", "Indicación de exodoncia", "Periodontitis apical", "Fractura radicular vertical", undefined]) {
    assert.equal(isHealthyWindow(status, 0, false), false, String(status));
  }
});

test("la ventana usa esa función y deja el modelo 3D a un clic", () => {
  assert.match(modal, /isHealthyWindow\(status, findings\.length, Boolean\(periodontalSites\)\)/);
  assert.match(modal, /data-testid="tooth-modal-toggle3d"/);
  assert.match(modal, /Ver modelo 3D/);
  assert.doesNotMatch(modal, /aria-pressed=\{show3d\}/);
});

test("con foto o video no se muestran las instrucciones ni la leyenda del 3D", () => {
  assert.equal((modal.match(/!\(showHealthyPhoto && !fullArch\)/g) ?? []).length, 2);
});

test("la pieza superior se muestra invertida y la inferior no", () => {
  const upper = toothPhotoFor({ fdi: 11, status: "Sin hallazgos" });
  assert.ok(upper, "falta la foto de la 1.1");
  assert.equal(upper.upper, true);
  assert.equal(upper.transform, "scaleY(-1)");
  const lower = toothPhotoFor({ fdi: 41, status: "Sin hallazgos" });
  assert.ok(lower, "falta la foto de la 4.1");
  assert.equal(lower.upper, false);
  assert.equal(lower.transform, undefined);
  assert.equal(toothPhotoFor({ fdi: 21, status: "Sin hallazgos" })?.transform, "scale(-1,-1)");
});

test("cada video listado y su portada existen en public/dientes/video", () => {
  for (const name of TOOTH_VIDEOS) {
    assert.ok(existsSync(new URL(`../public/dientes/video/${name}.mp4`, import.meta.url)), `falta ${name}.mp4`);
    assert.ok(existsSync(new URL(`../public/dientes/video/${name}.jpg`, import.meta.url)), `falta ${name}.jpg`);
  }
});

test("el video de giro sirve a la 1.1 y, espejado, a la 2.1; el resto cae a la foto", () => {
  assert.equal(toothVideoFor(11, "Sin hallazgos")?.src, "/dientes/video/upper-incisivo-central-sano.mp4");
  assert.equal(toothVideoFor(11, "Sin hallazgos")?.transform, undefined);
  assert.equal(toothVideoFor(11)?.src, "/dientes/video/upper-incisivo-central-sano.mp4");
  assert.equal(toothVideoFor(21, "Sin hallazgos")?.transform, "scaleX(-1)");
  for (const fdi of [41, 12, 51, 19, 10, 0]) assert.equal(toothVideoFor(fdi, "Sin hallazgos"), null, String(fdi));
  assert.equal(toothVideoFor(11, "Corona"), null);
});

test("si el video falla, la ventana cae a la foto, sin sonido y en bucle", () => {
  assert.match(modal, /onError=\{\(\) => setVideoFailed\(true\)\}/);
  assert.match(modal, /loop muted playsInline/);
  assert.match(modal, /<figcaption/);
});
