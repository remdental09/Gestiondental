import test from "node:test";
import assert from "node:assert/strict";
import { toothPhotoFor, TOOTH_PHOTOS } from "../lib/tooth-photos.ts";

const STATUSES = ["Periodontitis apical", "Absceso apical agudo", "Absceso apical crónico (fístula)", "Granuloma apical", "Quiste radicular", "Osteítis condensante", "Fisura coronaria", "Fractura coronaria de esmalte", "Fractura coronaria con dentina", "Fractura coronaria con pulpa expuesta", "Fractura corono-radicular", "Fractura radicular horizontal", "Fractura radicular vertical"];

test("hay una imagen por familia de pieza y estado de lesión (104)", () => {
  const lesion = [...TOOTH_PHOTOS].filter(n => /-(periodontitis|absceso|granuloma|quiste|osteitis|fisura|fractura)/.test(n));
  assert.equal(lesion.length, 104);
});

test("cada estado general de lesión muestra su imagen en las 32 piezas permanentes", () => {
  for (const status of STATUSES) for (const q of [1, 2, 3, 4]) for (let i = 1; i <= 8; i++) {
    const photo = toothPhotoFor({ fdi: q * 10 + i, status });
    assert.ok(photo, `${status} ${q}${i}`);
    assert.equal(photo.kind, "lesion");
    assert.ok(TOOTH_PHOTOS.has(photo.src.replace("/dientes/", "").replace(".webp", "")));
  }
});

test("la familia depende de la pieza y el espejo del cuadrante", () => {
  assert.equal(toothPhotoFor({ fdi: 11, status: "Quiste radicular" })?.src, "/dientes/upper-incisivo-quiste-radicular.webp");
  assert.equal(toothPhotoFor({ fdi: 24, status: "Quiste radicular" })?.src, "/dientes/upper-premolar-quiste-radicular.webp");
  assert.equal(toothPhotoFor({ fdi: 36, status: "Fractura radicular vertical" })?.src, "/dientes/lower-molar-fractura-radicular-vertical.webp");
  assert.equal(toothPhotoFor({ fdi: 13, status: "Granuloma apical" })?.transform, "scaleY(-1)");
  assert.equal(toothPhotoFor({ fdi: 23, status: "Granuloma apical" })?.transform, "scale(-1,-1)");
  assert.equal(toothPhotoFor({ fdi: 33, status: "Granuloma apical" })?.transform, "scaleX(-1)");
});

test("el implante manda sobre el estado y un estado sin imagen no cambia nada", () => {
  assert.equal(toothPhotoFor({ fdi: 16, status: "Quiste radicular", implant: true })?.kind, "implante-sumergido");
  assert.equal(toothPhotoFor({ fdi: 16, status: "Sin hallazgos" })?.kind, "sano");
});
