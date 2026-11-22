import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fitWithin, needsCompression, jpegName, thumbUrl, MAX_EDGE, THUMB_EDGE, KEEP_BELOW_BYTES, prepareImageUpload } from "../lib/image-compress.ts";
import { thumbKey, IMAGE_CACHE_CONTROL } from "../lib/image-keys.ts";

test("las fotos grandes quedan en 1600 px por el lado mayor, sin agrandar las chicas", () => {
  assert.deepEqual(fitWithin(4032, 3024, MAX_EDGE), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032, MAX_EDGE), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, MAX_EDGE), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(4032, 3024, THUMB_EDGE), { width: 400, height: 300 });
  assert.deepEqual(fitWithin(0, 10, MAX_EDGE), { width: 0, height: 0 });
});

test("solo se recomprime una imagen grande; PDF nunca", () => {
  assert.equal(needsCompression("image/jpeg", 4_000_000, 4032, 3024), true);
  assert.equal(needsCompression("image/png", 200_000, 2400, 1200), true);
  assert.equal(needsCompression("image/jpeg", KEEP_BELOW_BYTES + 1, 1200, 900), true);
  assert.equal(needsCompression("image/jpeg", 300_000, 1200, 900), false);
  assert.equal(needsCompression("application/pdf", 9_000_000, 0, 0), false);
});

test("nombres, miniatura y caché privada", () => {
  assert.equal(jpegName("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(jpegName("rx panoramica.png"), "rx panoramica.jpg");
  assert.equal(jpegName(".png"), "imagen.jpg");
  assert.equal(thumbUrl("/api/images/7"), "/api/images/7?thumb=1");
  assert.equal(thumbKey("o/1/uuid"), "o/1/uuid.thumb.jpg");
  assert.match(IMAGE_CACHE_CONTROL, /^private, max-age=\d+$/);
  assert.doesNotMatch(IMAGE_CACHE_CONTROL, /public/);
});

test("sin navegador (o con PDF) se sube el archivo original sin tocar", async () => {
  const pdf = new File([new Uint8Array([37, 80, 68, 70, 45])], "a.pdf", { type: "application/pdf" });
  const out = await prepareImageUpload(pdf);
  assert.equal(out.file, pdf);
  assert.equal(out.thumb, null);
});

test("la ruta de imágenes guarda la miniatura validada y la borra junto al original", () => {
  const post = readFileSync(new URL("../app/api/images/route.ts", import.meta.url), "utf8");
  const one = readFileSync(new URL("../app/api/images/[id]/route.ts", import.meta.url), "utf8");
  assert.match(post, /thumb\.size <= MAX_THUMB_BYTES/);
  assert.match(post, /bytes\[0\] === 0xff && bytes\[1\] === 0xd8/);
  assert.match(one, /delete\(\[image\.objectKey, thumbKey\(image\.objectKey\)\]\)/);
  assert.match(one, /eq\(clinicalImages\.ownerId, ownerId\)/);
  assert.match(one, /IMAGE_CACHE_CONTROL/);
});
