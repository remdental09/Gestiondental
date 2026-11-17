import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FLUIDS, FLUID_TIERS, fluidFile, fluidTier, pickFluid, siteFluids, siteHash } from '../app/perio-fluids.ts';
import { siteLevel } from '../app/perio-arch-layout.ts';

const site = (reading) => siteLevel(reading);

test('las 8 capas del manifiesto existen como WebP con transparencia y las proporciones declaradas', () => {
  assert.deepEqual(Object.keys(FLUIDS).sort(), ['b1', 'b2', 'b3', 'b4', 'p1', 'p2', 'p3', 'p4']);
  for (const [id, spec] of Object.entries(FLUIDS)) {
    const path = new URL(`../public${fluidFile(id)}`, import.meta.url);
    assert.ok(existsSync(path), `falta ${id}`);
    const buf = readFileSync(path);
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
    assert.equal(buf.subarray(8, 12).toString(), 'WEBP');
    // VP8X con bit de alfa: la capa no puede traer fondo.
    assert.equal(buf.subarray(12, 16).toString(), 'VP8X', `${id} sin canal alfa`);
    assert.ok(buf[20] & 0x10, `${id} sin transparencia`);
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    assert.ok(Math.abs(h / w - spec.ratio) < 0.01, `${id}: ratio ${h / w} ≠ ${spec.ratio}`);
    assert.ok(buf.length < 40 * 1024, `${id} pesa demasiado`);
  }
});

test('cada intensidad usa solo variantes de su tipo y la profundidad sube la intensidad', () => {
  for (const kind of ['blood', 'pus']) for (const tier of FLUID_TIERS[kind]) for (const id of tier) assert.equal(FLUIDS[id].kind, kind);
  assert.equal(fluidTier(null), 0); assert.equal(fluidTier(3), 0); assert.equal(fluidTier(4), 1); assert.equal(fluidTier(5), 1); assert.equal(fluidTier(6), 2);
  assert.ok(FLUID_TIERS.blood[2].includes(pickFluid('blood', 16, 1, 'vestibular', 7)));
  assert.ok(FLUID_TIERS.pus[0].includes(pickFluid('pus', 16, 1, 'vestibular', 2)));
});

test('la elección es estable: la misma lectura se dibuja siempre igual y sitios vecinos no se copian todos', () => {
  const again = () => siteFluids(26, 1, 'vestibular', site({ depth: 5, margin: null, bleeding: true, suppuration: true }));
  assert.deepEqual(again(), again());
  const ids = new Set();
  for (let tooth = 11; tooth <= 18; tooth++) for (let k = 0; k < 3; k++) ids.add(pickFluid('blood', tooth, k, 'vestibular', 5));
  assert.ok(ids.size > 1, 'todas las piezas usan la misma variante');
  assert.notEqual(siteHash(26, 1, 'vestibular'), siteHash(26, 1, 'lingual'));
});

test('sin sangrado ni supuración no hay capas, y no se dibuja nada por una medida normal sin medir', () => {
  assert.deepEqual(siteFluids(26, 1, 'vestibular', site(undefined)), []);
  assert.deepEqual(siteFluids(26, 1, 'vestibular', site({ depth: 6, margin: null, bleeding: false, suppuration: false })), []);
});

test('un sitio que sangra y supura muestra ambas capas, separadas para que se vean las dos', () => {
  const layers = siteFluids(36, 2, 'lingual', site({ depth: 6, margin: null, bleeding: true, suppuration: true }));
  assert.deepEqual(layers.map(l => l.kind), ['blood', 'pus']);
  assert.ok(layers[0].dxMm < 0 && layers[1].dxMm > 0);
  const solo = siteFluids(36, 2, 'lingual', site({ depth: 6, margin: null, bleeding: true, suppuration: false }));
  assert.equal(solo.length, 1); assert.equal(solo[0].dxMm, 0);
});
