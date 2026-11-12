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

test("el odontograma muestra una miniatura con foto en cada pieza permanente", () => {
  const odo = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
  assert.match(odo, /tooth-thumb-\$\{tooth\}/);
  assert.match(odo, /toothPhotoFor\(\{fdi:tooth/);
});

test("las piezas superiores se ven invertidas: raíces arriba, corona hacia oclusal", () => {
  assert.equal(toothPhotoFor({ fdi: 16 })?.transform, "scaleY(-1)");
  assert.equal(toothPhotoFor({ fdi: 26 })?.transform, "scale(-1,-1)");
  assert.equal(toothPhotoFor({ fdi: 36 })?.transform, "scaleX(-1)");
  assert.equal(toothPhotoFor({ fdi: 46 })?.transform, undefined);
  assert.equal(toothPhotoFor({ fdi: 11 })?.upper, true);
  assert.equal(toothPhotoFor({ fdi: 41 })?.upper, false);
});

test("el implante se muestra según su fase: sumergido, con pilar o con corona", () => {
  assert.equal(toothPhotoKind({ implant: true }), "implante-sumergido");
  assert.equal(toothPhotoKind({ implant: true, implantPhase: "pilar" }), "implante-pilar");
  assert.equal(toothPhotoKind({ implant: true, crown: true }), "implante");
  assert.equal(toothPhotoKind({ implant: true, implantPhase: "corona" }), "implante");
  // sin corona no se usa la foto con corona: si falta la imagen de la fase, cae al esquema
  const p = toothPhotoFor({ fdi: 36, implant: true, implantPhase: "pilar" });
  assert.equal(p?.src, "/dientes/implante-pilar-ancho.webp");
  const q = toothPhotoFor({ fdi: 11, implant: true, implantPhase: "sumergido" });
  assert.equal(q?.src, "/dientes/implante-sumergido-angosto.webp");
  assert.equal(toothPhotoFor({ fdi: 36, implant: true, crown: true })?.src, "/dientes/lower-molar-1-implante.webp");
  const odo = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
  assert.match(odo, /implantPhase:toothStatus==="Implante con pilar"\?"pilar"/);
});

test("la caries se dibuja en la superficie registrada, no donde la trae la foto", async () => {
  const { toothPhotoFor, cariesSpots } = await import("../lib/tooth-photos.ts");
  // 2.6 con caries distal en dentina profunda (caso reportado): pieza sana + lesión distal.
  const p26 = toothPhotoFor({ fdi: 26, caries: true, cariesSurfaces: [{ surface: "D", depth: "dentina_profunda" }] });
  assert.equal(p26.kind, "caries");
  assert.equal(p26.src, "/dientes/upper-molar-1-sano.webp", "la foto de caries trae la lesión en oclusal: no sirve para distal");
  assert.equal(p26.lesions.length, 1);
  const [d26] = p26.lesions;
  assert.equal(d26.surface, "D");
  assert.ok(d26.x > 210, "en el cuadrante 2 distal queda a la derecha (mesial mira a la línea media, a la izquierda)");
  assert.ok(d26.y > 288, "en superiores la corona va abajo");
  // Lado según cuadrante.
  const side = (fdi, surface) => cariesSpots(fdi, [{ surface, depth: "esmalte" }])[0].x > 210 ? "der" : "izq";
  assert.equal(side(16, "D"), "izq"); assert.equal(side(16, "M"), "der");
  assert.equal(side(26, "D"), "der"); assert.equal(side(26, "M"), "izq");
  assert.equal(side(36, "D"), "der"); assert.equal(side(46, "D"), "izq");
  // Inferiores: corona arriba.
  assert.ok(cariesSpots(36, [{ surface: "O", depth: null }])[0].y < 288);
  // Más profunda, más grande.
  const r = depth => cariesSpots(26, [{ surface: "D", depth }])[0].rx;
  assert.ok(r("esmalte") < r("dentina_superficial") && r("dentina_superficial") < r("dentina_profunda") && r("dentina_profunda") < r("pulpar"));
  // Palatina: cara de atrás.
  assert.equal(cariesSpots(26, [{ surface: "P", depth: "esmalte" }])[0].back, true);
  // Solo oclusal: se mantiene la foto con caries oclusal, sin dibujo encima.
  const occ = toothPhotoFor({ fdi: 26, caries: true, cariesSurfaces: [{ surface: "O", depth: "dentina_superficial" }] });
  assert.equal(occ.src, "/dientes/upper-molar-1-caries.webp");
  assert.equal(occ.lesions.length, 0);
  // Obturada y con caries mesial: base obturada + lesión.
  const mixed = toothPhotoFor({ fdi: 14, caries: true, restored: true, cariesSurfaces: [{ surface: "M", depth: "esmalte" }, { surface: "O", depth: "esmalte" }] });
  assert.equal(mixed.src, "/dientes/upper-premolar-1-restauracion.webp");
  assert.deepEqual(mixed.lesions.map(l => l.surface), ["M", "O"]);
});
