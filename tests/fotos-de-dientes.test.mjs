import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { toothPhotoFor, toothPhotoKind, TOOTH_PHOTOS, V3_PIECES, V3_MISSING } from "../lib/tooth-photos.ts";

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

test("FDI inválidos caen al esquema dibujado", () => {
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

test("la posición de la caries aproximada (cara palatina oculta) sigue la cara registrada", async () => {
  const { toothPhotoFor, cariesSpots } = await import("../lib/tooth-photos.ts");
  const [d26] = cariesSpots(26, [{ surface: "D", depth: "dentina_profunda" }]);
  assert.equal(d26.surface, "D");
  assert.ok(d26.x > 210, "en el cuadrante 2 distal queda a la derecha (mesial mira a la línea media, a la izquierda)");
  assert.ok(d26.y > 288, "en superiores la corona va abajo");
  const side = (fdi, surface) => cariesSpots(fdi, [{ surface, depth: "esmalte" }])[0].x > 210 ? "der" : "izq";
  assert.equal(side(16, "D"), "izq"); assert.equal(side(16, "M"), "der");
  assert.equal(side(26, "D"), "der"); assert.equal(side(26, "M"), "izq");
  assert.equal(side(36, "D"), "der"); assert.equal(side(46, "D"), "izq");
  assert.ok(cariesSpots(36, [{ surface: "O", depth: null }])[0].y < 288);
  const r = depth => cariesSpots(26, [{ surface: "D", depth }])[0].rx;
  assert.ok(r("esmalte") < r("dentina_superficial") && r("dentina_superficial") < r("dentina_profunda") && r("dentina_profunda") < r("pulpar"));
  assert.equal(cariesSpots(26, [{ surface: "P", depth: "esmalte" }])[0].back, true);
  // Sin caries ni obturaciones por cara sigue la foto sana de siempre.
  assert.equal(toothPhotoFor({ fdi: 26 }).src, "/dientes/upper-molar-1-sano.webp");
});

test("caries, obturaciones y sellantes se arman por capas sobre una base por tipo de pieza", () => {
  const p = toothPhotoFor({ fdi: 16, caries: true, restored: true, cariesSurfaces: [{ surface: "M", depth: "esmalte" }, { surface: "V", depth: "dentina_profunda" }], restorations: [{ surface: "O", material: "Amalgama" }, { surface: "D", stage: "provisional" }], sealedSurfaces: ["O"] });
  assert.equal(p.src, "/dientes/v3/base/upper-molar-1.webp");
  assert.equal(p.transform, "scaleY(-1)");
  const by = Object.fromEntries(p.layers.map(l => [`${l.kind}-${l.surface}`, l]));
  assert.equal(by["caries-incipiente-M"].src, "/dientes/v3/inc/upper-molar-1-M.webp");
  assert.equal(by["caries-cavitada-V"].src, "/dientes/v3/cav/upper-molar-1-V.webp");
  assert.equal(by["obturacion-O"].src, "/dientes/v3/forma/upper-molar-1-O.webp");
  assert.equal(by["obturacion-O"].material.name, "amalgama");
  assert.equal(by["obturacion-D"].material.name, "provisorio", "sin material, la etapa provisoria usa la textura provisoria");
  assert.equal(by["sellante-O"].src, "/dientes/v3/sell/upper-molar-1-O.webp");
  const resin = toothPhotoFor({ fdi: 36, restored: true, restoredSurfaces: ["D"] });
  assert.equal(resin.layers[0].material.name, "resina");
  assert.equal(resin.transform, "scaleX(-1)");
  assert.equal(toothPhotoFor({ fdi: 26, caries: true, cariesSurfaces: [{ surface: "M", depth: null }] }).transform, "scale(-1,-1)");
  // Los sellantes solo existen desde el primer premolar.
  assert.equal(toothPhotoFor({ fdi: 11, sealedSurfaces: ["O"] }).layers.length, 0);
});

test("molar 1 superior: juego v3 sobre la foto translúcida, con pulpitis si hay compromiso pulpar", async () => {
  const { existsSync } = await import("node:fs");
  assert.ok(V3_PIECES.has("upper-molar-1"));
  const p = toothPhotoFor({ fdi: 16, caries: true, cariesSurfaces: [{ surface: "M", depth: "dentina_superficial" }], restorations: [{ surface: "O", material: "Resina compuesta" }], sealedSurfaces: ["O"] });
  assert.equal(p.src, "/dientes/v3/base/upper-molar-1.webp");
  assert.equal(p.layers.find(l => l.kind === "caries-cavitada").src, "/dientes/v3/cav/upper-molar-1-M.webp");
  assert.equal(p.layers.find(l => l.kind === "obturacion").material.src, "/dientes/v2/mat/resina.webp", "las texturas de material se comparten");
  const pulp = toothPhotoFor({ fdi: 16, caries: true, cariesSurfaces: [{ surface: "O", depth: "pulpar" }] });
  assert.equal(pulp.src, "/dientes/v3/base/upper-molar-1-pulpitis.webp");
  assert.equal(toothPhotoFor({ fdi: 16, caries: true, cariesSurfaces: [{ surface: "O", depth: "pulpar" }], face: "palatina" }).src, "/dientes/v3/base/upper-molar-1-palatina.webp");
  assert.equal(toothPhotoFor({ fdi: 26, caries: true, cariesSurfaces: [{ surface: "O", depth: "pulpar" }] }).src, "/dientes/v3/base/upper-molar-1-pulpitis.webp", "el 2.6 es el mismo tipo de pieza, espejado");
  for (const f of ["base/upper-molar-1", "base/upper-molar-1-palatina", "base/upper-molar-1-pulpitis", "sell/upper-molar-1-O"]) assert.ok(existsSync(`public/dientes/v3/${f}.webp`), f);
  for (const set of ["inc", "cav", "forma"]) for (const sf of "OVMDP") assert.ok(existsSync(`public/dientes/v3/${set}/upper-molar-1-${sf}.webp`), `${set}-${sf}`);
});




test("las 16 piezas tienen su juego v3 completo sin capas pendientes", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(V3_PIECES.size, 16);
  assert.equal(V3_MISSING.size, 0, "no quedan capas pendientes de regenerar");
  for (const k of V3_PIECES) {
    for (const f of [`base/${k}`, `base/${k}-palatina`, `base/${k}-pulpitis`]) assert.ok(existsSync(`public/dientes/v3/${f}.webp`), f);
    for (const set of ["inc", "cav", "forma"]) for (const sf of "OVMDP") assert.ok(V3_MISSING.has(`${k}/${set}/${sf}`) || existsSync(`public/dientes/v3/${set}/${k}-${sf}.webp`), `${set}/${k}-${sf}`);
    if (!/incisivo|canino/.test(k)) assert.ok(V3_MISSING.has(`${k}/sell/O`) || existsSync(`public/dientes/v3/sell/${k}-O.webp`), `sell/${k}`);
  }
  for (const e of V3_MISSING) { const [k, set, sf] = e.split("/"); assert.ok(!existsSync(`public/dientes/v3/${set}/${k}-${sf}.webp`), `${e} figura como pendiente pero el archivo existe`); }
});


test("la cara palatina usa su propia base y solo las lesiones palatinas", () => {
  const state = { fdi: 14, caries: true, cariesSurfaces: [{ surface: "P", depth: "esmalte" }, { surface: "M", depth: "esmalte" }] };
  const vest = toothPhotoFor(state);
  assert.equal(vest.hasPalatal, true);
  assert.deepEqual(vest.layers.map(l => l.surface), ["M"]);
  assert.equal(vest.lesions.length, 1, "la palatina se insinúa en línea punteada mientras se ve la cara vestibular");
  const pal = toothPhotoFor({ ...state, face: "palatina" });
  assert.equal(pal.src, "/dientes/v3/base/upper-premolar-1-palatina.webp");
  assert.deepEqual(pal.layers.map(l => l.src), ["/dientes/v3/inc/upper-premolar-1-P.webp"]);
  assert.equal(pal.lesions.length, 0);
});

test("existen todos los archivos de capas por cara, base, palatina, sellante y material", async () => {
  const { existsSync } = await import("node:fs");
  for (const arch of ["upper", "lower"]) for (const t of ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"]) {
    const k = `${arch}-${t}`;
    for (const f of [`base/${k}`, `base/${k}-palatina`]) assert.ok(existsSync(`public/dientes/v2/${f}.webp`), f);
    for (const set of ["inc", "cav", "forma"]) for (const sf of "OVMDP") assert.ok(existsSync(`public/dientes/v2/${set}/${k}-${sf}.webp`), `${set}/${k}-${sf}`);
    if (!["incisivo-central", "incisivo-lateral", "canino"].includes(t)) assert.ok(existsSync(`public/dientes/v2/sell/${k}-O.webp`), `sell/${k}`);
  }
  for (const m of ["resina", "amalgama", "ionomero", "provisorio"]) assert.ok(existsSync(`public/dientes/v2/mat/${m}.webp`), m);
});

test("existen las 64 fotos de caries y obturación por cara", () => {
  for (const arch of ["upper", "lower"]) for (const t of ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"]) for (const k of ["caries", "restauracion"]) for (const v of ["lado", "vestibular"]) {
    const n = `${arch}-${t}-${k}-${v}`;
    assert.ok(TOOTH_PHOTOS.has(n), n);
  }
});

test("dentición temporal: base por tipo, capas del molar inferior e imagen de lesión", () => {
  const p = toothPhotoFor({ fdi: 75, status: "Sin hallazgos" });
  assert.equal(p.src, "/dientes/v3/base/temp-lower-molar-2.webp");
  const m = toothPhotoFor({ fdi: 74, status: "Sin hallazgos", caries: true, cariesSurfaces: [{ surface: "M", depth: "dentina_superficial" }], sealedSurfaces: ["O"] });
  assert.equal(m.src, "/dientes/v3/base/temp-lower-molar-1.webp");
  assert.equal(m.mirror, true);
  assert.deepEqual(m.layers.map(l => l.src), ["/dientes/v3/cav/temp-lower-molar-1-M.webp", "/dientes/v3/sell/temp-lower-molar-1-O.webp"]);
  const l = toothPhotoFor({ fdi: 84, status: "Absceso apical agudo" });
  assert.equal(l.src, "/dientes/temp-lower-molar-1-absceso-apical-agudo.webp");
  assert.equal(toothPhotoFor({ fdi: 55, status: "Sin hallazgos" }).upper, true);
  assert.equal(toothPhotoFor({ fdi: 56, status: "Sin hallazgos" }), null);
});

test("dentición temporal: las 10 piezas tienen capas por cara e imágenes de lesión en disco", async () => {
  const { existsSync } = await import("node:fs");
  const fdis = [51, 52, 53, 54, 55, 81, 82, 83, 84, 85];
  for (const fdi of fdis) {
    const ph = toothPhotoFor({ fdi, status: "Sin hallazgos", caries: true, cariesSurfaces: [{ surface: "M", depth: "dentina_superficial" }, { surface: fdi % 10 >= 4 ? "O" : "V", depth: "esmalte" }], restorations: [{ surface: "D", material: "resina" }] });
    assert.ok(ph.layers.length >= 3, `capas de ${fdi}`);
    for (const l of ph.layers) assert.ok(existsSync(`public${l.src}`), l.src);
    assert.ok(existsSync(`public${ph.src}`), ph.src);
    for (const st of ["Absceso apical agudo", "Quiste radicular", "Corona"]) {
      const w = toothPhotoFor({ fdi, status: st });
      assert.ok(existsSync(`public${w.src}`), w.src);
    }
  }
  const anterior = toothPhotoFor({ fdi: 53, status: "Sin hallazgos", sealedSurfaces: ["O"] });
  assert.deepEqual(anterior.layers, []);
});
