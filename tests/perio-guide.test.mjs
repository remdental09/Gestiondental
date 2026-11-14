import test from 'node:test';
import assert from 'node:assert/strict';
import { guideHear, guideOrder, guideStart, parseGuideFlags } from '../lib/dictation/perio-guide.ts';

const run = (state, phrases, name = 'Luis') => phrases.reduce((acc, phrase) => { const out = guideHear(acc.state, phrase, name); return { state: out.state, outs: [...acc.outs, out] }; }, { state, outs: [] });

test('guía periodontal: parte en 1.8 y salta ausentes e implantes del odontograma', () => {
  assert.equal(guideOrder({}).length, 32);
  assert.deepEqual(guideOrder({ 18: 'Ausente', 17: 'Implante con pilar' }).slice(0, 2), [16, 15]);
  const start = guideStart({ 18: 'Ausente' }, 'Luis');
  assert.equal(start.state.order[0], 17);
  assert.match(start.say, /Son 31 piezas\. Pieza uno siete\. Sondaje vestibular, de mesial a distal\./);
  assert.deepEqual(guideOrder({}).slice(15, 18), [28, 38, 37]);
});

test('guía periodontal: una pieza completa, paso a paso y en orden', () => {
  const { state, outs } = run(guideStart({}, 'Luis').state, ['tres dos cuatro', 'cinco, seis, cinco', 'cero uno uno', 'menos uno cero cero', 'sangrado mesial vestibular', 'siguiente']);
  assert.deepEqual(outs[0].apply, { tooth: 18, sites: { MV: { depth: 3 }, V: { depth: 2 }, DV: { depth: 4 } } });
  assert.match(outs[0].say, /^3, 2, 4\. Sondaje palatino\.$/);
  assert.deepEqual(outs[1].apply.sites, { ML: { depth: 5 }, L: { depth: 6 }, DL: { depth: 5 } });
  assert.match(outs[1].say, /Ahora, Luis, dime el margen gingival vestibular\./);
  assert.deepEqual(outs[2].apply.sites, { MV: { margin: 0 }, V: { margin: 1 }, DV: { margin: 1 } });
  assert.deepEqual(outs[3].apply.sites, { ML: { margin: -1 }, L: { margin: 0 }, DL: { margin: 0 } });
  assert.match(outs[3].say, /Pieza uno ocho: ¿sangrado o supuración\?/);
  assert.deepEqual(outs[4].apply.sites, { MV: { bleeding: true } });
  assert.equal(outs[4].state.step, 'flags');
  assert.equal(state.order[state.index], 17);
  assert.match(outs[5].say, /^Pieza uno siete\. Sondaje vestibular/);
});

test('guía periodontal: junta los valores dictados con pausas y no acepta de más ni fuera de rango', () => {
  const start = guideStart({}).state;
  const partial = run(start, ['tres', 'dos', 'cuatro']);
  assert.equal(partial.outs[0].say, 'Faltan dos.');
  assert.equal(partial.outs[1].say, 'Falta uno.');
  assert.deepEqual(partial.outs[2].apply.sites, { MV: { depth: 3 }, V: { depth: 2 }, DV: { depth: 4 } });
  const extra = guideHear(start, 'tres dos cuatro cinco');
  assert.equal(extra.apply, undefined);
  assert.equal(extra.state.step, 'depthV');
  assert.equal(guideHear(start, 'tres dos cuarenta y uno').apply, undefined);
  assert.deepEqual(guideHear(start, '324').apply.sites, { MV: { depth: 3 }, V: { depth: 2 }, DV: { depth: 4 } });
});

test('guía periodontal: ausente quita la pieza del recorrido y avisa para el odontograma', () => {
  const out = guideHear(guideStart({}).state, 'ausente');
  assert.equal(out.markedAbsent, 18);
  assert.deepEqual(out.state.absent, [18]);
  assert.equal(out.state.order[out.state.index], 17);
  assert.match(out.say, /^Pieza uno ocho ausente\. Pieza uno siete\./);
});

test('guía periodontal: repetir, atrás, saltar, pausa y terminar', () => {
  let s = run(guideStart({}).state, ['tres dos cuatro', 'cinco']).state;
  assert.deepEqual(s.buffer, [5]);
  s = guideHear(s, 'repetir').state; assert.deepEqual(s.buffer, []); assert.equal(s.step, 'depthL');
  s = guideHear(s, 'atrás').state; assert.equal(s.step, 'depthV');
  s = guideHear(s, 'saltar').state; assert.equal(s.order[s.index], 17);
  s = guideHear(s, 'atrás').state; assert.equal(s.order[s.index], 18);
  s = guideHear(s, 'pausa').state; assert.equal(s.paused, true);
  assert.equal(guideHear(s, 'tres dos cuatro').apply, undefined);
  s = guideHear(s, 'continuar').state; assert.equal(s.paused, false);
  assert.equal(guideHear(s, 'terminar').state.done, true);
});

test('guía periodontal: sangrado y supuración por cara y sitio; «nada» pasa a la siguiente', () => {
  assert.deepEqual(parseGuideFlags('sangrado').sites, { MV: { bleeding: true }, V: { bleeding: true }, DV: { bleeding: true }, ML: { bleeding: true }, L: { bleeding: true }, DL: { bleeding: true } });
  assert.deepEqual(parseGuideFlags('sangrado vestibular').sites, { MV: { bleeding: true }, V: { bleeding: true }, DV: { bleeding: true } });
  assert.deepEqual(parseGuideFlags('sangrado mesial y distal palatino, supuración distopalatino').sites, { ML: { bleeding: true }, DL: { bleeding: true, suppuration: true } });
  assert.ok('error' in parseGuideFlags('sangrado mesial'));
  let s = run(guideStart({}).state, ['3 2 4', '3 2 4', '0 0 0', 'normal']).state;
  assert.equal(s.step, 'flags');
  const mixed = guideHear(s, 'sangrado vestibular, sin supuración');
  assert.deepEqual(mixed.apply.sites, { MV: { bleeding: true }, V: { bleeding: true }, DV: { bleeding: true } });
  assert.equal(mixed.state.step, 'flags');
  const none = guideHear(s, 'sin sangrado ni supuración');
  assert.equal(none.apply, undefined);
  assert.equal(none.state.order[none.state.index], 17);
});

test('guía periodontal: al terminar la última pieza cierra el examen', () => {
  const statuses = Object.fromEntries([...Array(32).keys()].map(i => [[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47][i], 'Ausente']).filter(([k]) => k));
  const start = guideStart(statuses);
  assert.deepEqual(start.state.order, [48]);
  const end = run(start.state, ['2 2 2', '2 2 2', 'normal', 'normal', 'nada']);
  assert.equal(end.state.done, true);
  assert.match(end.outs[4].say, /Examen completo/);
});
