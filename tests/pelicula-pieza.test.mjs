import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toothStory, visualKey, stagePhoto } from '../lib/tooth-story.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const healthy = { status: 'Sin hallazgos', surfaces: {}, missingReason: null, crown: null };
const snap = (over = {}) => ({ ...healthy, ...over });
let n = 0;
const ev = (day, before, after, over = {}) => ({ id: `e${++n}`, tooth: 11, recordedAt: `${day}T12:00:00.000Z`, clinicalDate: day, eventType: 'status', source: 'manual', title: 'Cambio', detail: '', before, after, ...over });
const caries = snap({ surfaces: { V: { condition: 'caries', depth: 'dentina_superficial' } } });
const restored = snap({ surfaces: { V: { condition: 'restored', restorationMaterial: 'Resina' } } });
const lesion = snap({ status: 'Periodontitis apical', surfaces: restored.surfaces });
const crowned = snap({ status: 'Corona', crown: { material: 'Zirconio' }, surfaces: {} });
const implant = snap({ status: 'Implante', crown: { material: 'Zirconio' }, surfaces: {} });

test('ciclo completo: caries → obturación → lesión → corona → implante, en orden y con fecha', () => {
  const history = [
    ev('2020-03-01', healthy, caries),
    ev('2020-04-10', caries, restored),
    ev('2024-06-01', restored, lesion),
    ev('2024-09-01', lesion, crowned),
    ev('2026-01-15', crowned, implant),
  ];
  const stages = toothStory(history, 11);
  assert.deepEqual(stages.map(s => s.day), ['2020-03-01', '2020-04-10', '2024-06-01', '2024-09-01', '2026-01-15']);
  assert.match(stages[0].label, /^Caries en/);
  assert.match(stages[1].label, /^Obturación en/);
  assert.equal(stages[2].lesion, 'Periodontitis apical');
  assert.match(stages[3].label, /Corona/);
  assert.match(stages[4].label, /Implante/);
  assert.equal(stages.filter(s => s.current).length, 1);
  assert.equal(stages[4].current, true);
  assert.ok(stages.every(s => s.photo === null || typeof s.photo.src === 'string'));
});

test('la colección crece: agregar un hito agrega una etapa y no borra las anteriores', () => {
  const base = [ev('2020-03-01', healthy, caries)];
  const antes = toothStory(base, 11);
  const despues = toothStory([...base, ev('2020-04-10', caries, restored)], 11);
  assert.equal(despues.length, antes.length + 1);
  assert.equal(despues[0].day, antes[0].day);
  assert.equal(despues[0].label, antes[0].label);
});

test('varios hitos el mismo día forman una sola etapa', () => {
  const mid = snap({ surfaces: { V: { condition: 'caries', depth: null } } });
  const stages = toothStory([ev('2021-05-05', healthy, mid), ev('2021-05-05', mid, restored, { recordedAt: '2021-05-05T15:00:00.000Z' })], 11);
  assert.equal(stages.length, 1);
  assert.match(stages[0].label, /Obturación/);
});

test('sin cambio visual no hay etapa nueva', () => {
  const stages = toothStory([ev('2021-01-01', healthy, caries), ev('2021-02-01', caries, snap({ ...caries, missingReason: 'caries' }))], 11);
  assert.equal(stages.length, 1);
});

test('si una evolución se borra, su etapa desaparece', () => {
  const a = ev('2020-03-01', healthy, caries), b = ev('2020-04-10', caries, restored);
  assert.equal(toothStory([a, b], 11).length, 2);
  assert.equal(toothStory([a], 11).length, 1);
});

test('otras piezas no se mezclan y sin historial no hay etapas', () => {
  assert.deepEqual(toothStory([ev('2020-03-01', healthy, caries, { tooth: 21 })], 11), []);
  assert.deepEqual(toothStory([], 11), []);
});

test('pieza que ya traía algo antes del primer hito parte con una etapa inicial', () => {
  const stages = toothStory([ev('2022-02-02', restored, crowned)], 11);
  assert.equal(stages.length, 2);
  assert.equal(stages[0].initial, true);
  assert.equal(stages[1].initial, false);
});

test('endodoncia: se marca desde la fecha de obturación; sin fecha, solo en la etapa actual', () => {
  const obt = ev('2022-03-03', healthy, healthy, { id: 'endo:7:obturation', source: 'evolution', eventType: 'evolution', before: undefined, after: undefined, title: 'Endodoncia obturada' });
  const base = [ev('2021-01-01', healthy, caries), ev('2022-01-01', caries, restored)];
  const con = toothStory([...base, obt], 11);
  assert.deepEqual(con.map(s => s.endoDone), [false, false, true]);
  assert.match(con[2].label, /Endodoncia obturada/);
  const sin = toothStory(base, 11, { endoNow: true });
  assert.deepEqual(sin.map(s => s.endoDone), [false, true]);
});

test('imágenes del banco existen para los estados de la película', () => {
  for (const s of [caries, restored, lesion, crowned, implant, snap({ status: 'Ausente' })]) {
    const { photo } = stagePhoto(11, s, false);
    assert.ok(photo && photo.src.startsWith('/dientes/'), `sin imagen para ${s.status}`);
  }
  assert.notEqual(visualKey(caries, false), visualKey(restored, false));
  assert.notEqual(visualKey(restored, false), visualKey(restored, true));
});

test('integración: clic (panel compacto) y doble clic (ventana grande)', () => {
  assert.match(src('components/odontogram.tsx'), /<ToothStory tooth=\{selected\}[^>]*size="compact"/);
  const modal = src('components/tooth-3d-modal.tsx');
  assert.match(modal, /periodontalHistory === undefined && <ToothStory[^>]*size="large"/);
  const ui = src('components/tooth-story.tsx');
  for (const id of ['tooth-story', 'story-play', 'story-compare', 'story-stage', 'story-strip']) assert.ok(ui.includes(id), id);
  assert.match(ui, /Imagen referencial, no es el paciente/);
});

test('integración en el periodontograma: panel de la pieza y su ventana', () => {
  assert.match(src('components/periodontogram.tsx'), /<ToothStory tooth=\{tooth\} history=\{toothHistory\}/);
  assert.match(src('components/perio-tooth-modal.tsx'), /<ToothStory tooth=\{tooth\} history=\{toothHistory\}/);
});
