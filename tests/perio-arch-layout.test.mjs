import test from 'node:test';
import assert from 'node:assert/strict';
import { archCurves, archSlots, depthTone, excludedKind, FACE_SITES, jawOf, LOWER_ORDER, sampleCurve, siteLevel, siteXs, toothLevels, UPPER_ORDER } from '../app/perio-arch-layout.ts';

test('cada arcada reparte sus 16 piezas en orden FDI, de derecha a izquierda del paciente', () => {
  const upper = archSlots('upper', 'vestibular');
  const lower = archSlots('lower', 'vestibular');
  assert.deepEqual(upper.slots.map(s => s.tooth), UPPER_ORDER);
  assert.deepEqual(lower.slots.map(s => s.tooth), LOWER_ORDER);
  assert.equal(new Set(upper.slots.map(s => s.tooth)).size, 16);
  assert.ok(upper.slots.every((s, i) => i === 0 || s.cx > upper.slots[i - 1].cx));
});

test('la cara lingual es el espejo de la vestibular', () => {
  const v = archSlots('lower', 'vestibular');
  const l = archSlots('lower', 'lingual');
  assert.deepEqual(l.slots.map(s => s.tooth), [...LOWER_ORDER].reverse());
  assert.equal(v.width, l.width);
  const v46 = v.slots.find(s => s.tooth === 46), l46 = l.slots.find(s => s.tooth === 46);
  assert.ok(Math.abs(v46.cx + l46.cx - v.width) < 1e-9);
});

test('el lado mesial de cada sitio mira siempre a la línea media', () => {
  for (const face of ['vestibular', 'lingual']) {
    for (const jaw of ['upper', 'lower']) {
      const { slots, width } = archSlots(jaw, face);
      for (const slot of slots) {
        const [distal, centro, mesial] = siteXs(slot);
        assert.equal(centro, slot.cx);
        const towardMidline = Math.abs(mesial - width / 2) < Math.abs(distal - width / 2);
        assert.ok(towardMidline, `${slot.tooth} ${face}`);
      }
    }
  }
});

test('el orden de sitios es distal, central, mesial en cada cara', () => {
  assert.deepEqual(FACE_SITES.vestibular, ['DV', 'V', 'MV']);
  assert.deepEqual(FACE_SITES.lingual, ['DL', 'L', 'ML']);
  const data = { sites: { DV: { depth: 3, margin: 0, bleeding: false, suppuration: false }, DL: { depth: 7, margin: 1, bleeding: true, suppuration: false } }, mobility: '', furcation: '' };
  assert.equal(toothLevels(16, data, 'vestibular').sites[0].depth, 3);
  assert.equal(toothLevels(16, data, 'lingual').sites[0].depth, 7);
  assert.equal(toothLevels(16, data, 'lingual').sites[0].bleeding, true);
});

test('sin medir no se confunde con sano, y la cresta estimada nunca sube sobre el margen', () => {
  const vacio = siteLevel(undefined);
  assert.equal(vacio.measured, false);
  assert.equal(vacio.depth, null);
  const bolsa = siteLevel({ depth: 6, margin: 1, bleeding: true, suppuration: false });
  assert.equal(bolsa.measured, true);
  assert.equal(bolsa.gumMm, 1);
  assert.equal(bolsa.boneMm, 9);
  const sano = siteLevel({ depth: 2, margin: -2, bleeding: false, suppuration: false });
  assert.ok(sano.boneMm >= sano.gumMm + 1.5);
  assert.equal(siteLevel({ depth: 4, margin: null, bleeding: false, suppuration: false }).gumMm, 0);
});

test('piezas ausentes e implantes se muestran como reborde o implante, no como diente sondeable', () => {
  assert.equal(excludedKind('Ausente'), 'absent');
  assert.equal(excludedKind('Implante'), 'implant');
  assert.equal(excludedKind('Implante con pilar'), 'implant');
  assert.equal(excludedKind('Obturado'), null);
  assert.equal(excludedKind(undefined), null);
  assert.equal(jawOf(16), 'upper');
  assert.equal(jawOf(36), 'lower');
});

test('las curvas siguen las mediciones: más recesión baja el margen y más pérdida baja la cresta', () => {
  const { slots, width } = archSlots('lower', 'vestibular');
  const cej = slots.map(() => 100);
  const sano = slots.map(s => toothLevels(s.tooth, { sites: Object.fromEntries(['DV', 'V', 'MV'].map(k => [k, { depth: 2, margin: -1, bleeding: false, suppuration: false }])), mobility: '', furcation: '' }, 'vestibular'));
  const enfermo = slots.map(s => toothLevels(s.tooth, { sites: Object.fromEntries(['DV', 'V', 'MV'].map(k => [k, { depth: 7, margin: 3, bleeding: true, suppuration: false }])), mobility: '', furcation: '' }, 'vestibular'));
  const a = archCurves(slots, sano, cej, width), b = archCurves(slots, enfermo, cej, width);
  const mid = Math.floor(a.gum.length / 2);
  assert.ok(b.gum[mid][1] > a.gum[mid][1]);
  assert.ok(b.bone[mid][1] > a.bone[mid][1]);
  assert.ok(b.bone.every((p, i) => p[1] >= b.gum[i][1] - 20 * 9));
  assert.ok(a.gum.every((p, i) => i === 0 || p[0] >= a.gum[i - 1][0]));
});

test('un reborde sin diente baja la encía y la deja plana', () => {
  const { slots, width } = archSlots('upper', 'vestibular');
  const cej = slots.map(() => 100);
  const levels = slots.map(s => toothLevels(s.tooth, undefined, 'vestibular', s.tooth === 14 ? 'Ausente' : undefined));
  const { gum } = archCurves(slots, levels, cej, width);
  const ausente = slots.find(s => s.tooth === 14);
  const alrededor = gum.filter(p => p[0] > ausente.cx - ausente.width * 0.4 && p[0] < ausente.cx + ausente.width * 0.4);
  assert.ok(alrededor.length >= 1);
  assert.ok(alrededor.every(p => p[1] > 100));
});

test('la curva muestreada pasa por los puntos y se mantiene plana en los extremos', () => {
  const pts = [[0, 10], [50, 40], [100, 20]];
  const ys = sampleCurve(pts, 0, 100);
  assert.equal(ys.length, 101);
  assert.ok(Math.abs(ys[0] - 10) < 1e-6);
  assert.ok(Math.abs(ys[50] - 40) < 0.5);
  assert.ok(Math.abs(ys[100] - 20) < 0.5);
  const fuera = sampleCurve(pts, -20, 120);
  assert.equal(fuera[0], 10);
  assert.equal(fuera[fuera.length - 1], 20);
});

test('colores de sondaje: 0–3 verde, 4–5 ámbar, 6 o más rojo, sin medir gris', () => {
  assert.deepEqual([null, 0, 3, 4, 5, 6, 9].map(depthTone), ['none', 'ok', 'ok', 'warn', 'warn', 'crit', 'crit']);
});
