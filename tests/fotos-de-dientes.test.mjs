import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { toothPhotoFor, toothPhotoKind, TOOTH_PHOTOS } from "../lib/tooth-photos.ts";

test("cada imagen listada existe en public/dientes", () => {
  const files = new Set(readdirSync(new URL("../public/dientes/", import.meta.url)).map((f) => f.replace(/\.webp$/, "")));
  for (const name of TOOTH_PHOTOS) assert.ok(files.has(name), `falta ${name}.webp`);
});

test("la situación manda la imagen: implante, corona, endodoncia, caries, obturación, sano", () => {
  assert.equal(toothPhotoKind({ implant: true, crown: true, endo: true, caries: true }), "implante");
  assert.equal(toothPhotoKind({ crown: true, endo: true }), "corona");
  assert.equal(toothPhotoKind({ endo: true, caries: true }), "endodoncia");
  assert.equal(toothPhotoKind({ caries: true, restored: true }), "caries");
  assert.equal(toothPhotoKind({ restored: true }), "restauracion");
  assert.equal(toothPhotoKind({}), "sano");
});

test("el FDI elige arcada y tipo de pieza; el lado izquierdo va espejado", () => {
  const a = toothPhotoFor({ fdi: 16, endo: true });
  assert.equal(a?.src, "/dientes/upper-molar-1-endodoncia.webp");
  assert.equal(a?.mirror, false);
  const b = toothPhotoFor({ fdi: 26, endo: true });
  assert.equal(b?.src, a?.src);
  assert.equal(b?.mirror, true);
  assert.equal(toothPhotoFor({ fdi: 41, caries: true })?.src, "/dientes/lower-incisivo-central-caries.webp");
  assert.equal(toothPhotoFor({ fdi: 38 })?.src, "/dientes/lower-molar-3-sano.webp");
});

test("piezas temporales o FDI inválidos y fotos que faltan caen al esquema dibujado", () => {
  assert.equal(toothPhotoFor({ fdi: 55 }), null);
  assert.equal(toothPhotoFor({ fdi: 19 }), null);
  assert.equal(toothPhotoFor({ fdi: 0 }), null);
});

test("la vista ampliada usa la foto y conserva el esquema como respaldo", () => {
  const src = readFileSync(new URL("../components/tooth-detail-view.tsx", import.meta.url), "utf8");
  assert.match(src, /toothPhotoFor/);
  assert.match(src, /data-testid="tooth-photo"/);
  assert.match(src, /Imagen referencial, no es el paciente/);
  assert.match(src, /Esquema, no a escala/);
  const odo = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
  assert.match(odo, /fdi=\{selected\}/);
});
