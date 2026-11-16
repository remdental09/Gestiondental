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

test("la imagen de lesión también marca la caries de la pieza (aproximada), sin perder la lesión", () => {
  const photo = toothPhotoFor({ fdi: 36, status: "Granuloma apical", cariesSurfaces: [{ surface: "O", depth: "dentina_profunda" }, { surface: "M", depth: "esmalte" }] });
  assert.equal(photo?.kind, "lesion");
  assert.match(photo?.src ?? "", /granuloma-apical/);
  assert.deepEqual(photo?.lesions.map((s) => s.surface).sort(), ["M", "O"]);
  assert.equal(toothPhotoFor({ fdi: 36, status: "Granuloma apical" })?.lesions.length, 0);
});

test("capas de tratamiento: perno, onlay y ortodoncia se dibujan sobre el molar superior 1 solo si están puestos", async () => {
  const { toothPhotoFor } = await import("../lib/tooth-photos.ts");
  const { placedLayers } = await import("../lib/tooth-treatments.ts");
  const photo = toothPhotoFor({ fdi: 16, placed: ["perno", "ortodoncia"] });
  assert.deepEqual(photo.layers.map(l => l.kind), ["perno", "ortodoncia"]);
  assert.match(photo.layers[0].src, /\/v3\/trat\/upper-molar-1-perno\.webp$/);
  assert.equal(toothPhotoFor({ fdi: 16, placed: ["perno"], face: "palatina" }).layers.length, 0);
  assert.equal(toothPhotoFor({ fdi: 26, placed: ["perno"] }).layers.length, 1);
  assert.equal((toothPhotoFor({ fdi: 14, placed: ["perno"] })?.layers ?? []).length, 0);
  const m = (kind, status) => ({ kind, status, label: kind });
  assert.deepEqual(placedLayers([m("perno", "realizado"), m("onlay", "planificado"), m("carilla", "realizado"), m("ortodoncia", "en curso")]), ["perno", "ortodoncia"]);
});

test("letras de caras: M y D cambian de lado según cuadrante y vista; O va del lado de la corona", async () => {
  const { surfaceScreenSide } = await import("../app/odontogram-surface.ts");
  assert.equal(surfaceScreenSide(15, "M"), "right");
  assert.equal(surfaceScreenSide(25, "M"), "left");
  assert.equal(surfaceScreenSide(35, "M"), "left");
  assert.equal(surfaceScreenSide(45, "M"), "right");
});
