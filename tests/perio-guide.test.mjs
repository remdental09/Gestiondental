import test from 'node:test';
import assert from 'node:assert/strict';
import { guideAuthorize, guideHear, guideOrder, guideStart, parseGuideFlags } from '../lib/dictation/perio-guide.ts';

const begin = (statuses = {}, name = '') => { const start = guideStart(statuses, name).state; return guideAuthorize(start, start.order[start.index], name).state; };
const run = (state, phrases, name = 'Luis') => phrases.reduce((acc, phrase) => { const out = guideHear(acc.state, phrase, name); return { state: out.state, outs: [...acc.outs, out] }; }, { state, outs: [] });

test('guía periodontal: parte en 1.8 y salta ausentes e implantes del odontograma', () => {
  assert.equal(guideOrder({}).length, 32);
  assert.deepEqual(guideOrder({ 18: 'Ausente', 17: 'Implante con pilar' }).slice(0, 2), [16, 15]);
  const start = guideStart({ 18: 'Ausente' }, 'Luis');
  assert.equal(start.state.order[0], 17);
  assert.match(start.say, /Son 31 piezas\.\nAutoriza la pieza uno siete\./);
  assert.deepEqual(guideOrder({}).slice(15, 18), [28, 38, 37]);
});

// Seis sitios, cada uno con sondaje y margen.
const SITES = ['3','0','2','0','4','0','5','0','6','0','5','0'];

test('guía periodontal: una pieza completa, sitio por sitio y en orden', () => {
  const phrases = ['tres', 'cero', 'dos', 'uno', 'cuatro', 'uno', 'cinco', 'menos uno', 'seis', 'cero', 'cinco', 'cero'];
  const { state, outs } = run(begin({}, 'Luis'), phrases);
  assert.deepEqual(outs[0].apply, { tooth: 18, sites: { MV: { depth: 3 } } });
  assert.equal(outs[0].say, 'Sondaje mesial vestibular, 3.\nAhora, dime el margen gingival de mesial vestibular.');
  assert.deepEqual(outs[1].apply.sites, { MV: { margin: 0 } });
  assert.equal(outs[1].say, 'Margen gingival mesial vestibular, 0.\nDime el sondaje de central vestibular.');
  assert.deepEqual(outs[2].apply.sites, { V: { depth: 2 } });
  assert.deepEqual(outs[6].apply.sites, { ML: { depth: 5 } });
    assert.equal(outs[5].say, 'Margen gingival distal vestibular, 1.\nDime el sondaje de mesial palatino.');
  assert.deepEqual(outs[7].apply.sites, { ML: { margin: -1 } });
  assert.deepEqual(outs[10].apply.sites, { DL: { depth: 5 } });
  assert.match(outs[11].say, /Pieza uno ocho: ¿sangrado o supuración\?/);
  assert.equal(state.step, 'flags');
});

test('guía periodontal: sondaje y margen juntos, y sangrado dicho de pasada', () => {
  const start = begin();
  const both = guideHear(start, 'tres uno');
  assert.deepEqual(both.apply.sites, { MV: { depth: 3, margin: 1 } });
  assert.equal(both.state.pos, 2);
  assert.equal(both.say, 'Sondaje mesial vestibular, 3. Margen gingival, 1.\nDime el sondaje de central vestibular.');
  const bleed = guideHear(start, 'cuatro sangra');
  assert.deepEqual(bleed.apply.sites, { MV: { depth: 4, bleeding: true } });
  assert.equal(bleed.state.pos, 1);
  assert.equal(guideHear(start, 'cuatro sin sangrado').apply.sites.MV.bleeding, undefined);
  assert.equal(guideHear(start, 'cuarenta y uno').apply, undefined);
  assert.equal(guideHear(start, '3 2 4').apply, undefined);
});

test('guía periodontal: si no entiende repite y tras tres intentos avisa de ruido y deja de escuchar', () => {
  const start = begin({}, 'Luis');
  const first = guideHear(start, 'blablá ruido', 'Luis');
  assert.equal(first.apply, undefined);
  assert.match(first.say, /^No te entendí\.\nPieza uno ocho, Luis\.\nDime el sondaje de mesial vestibular\./);
  const second = guideHear(first.state, 'mmm', 'Luis');
  assert.equal(second.state.misses, 2);
  assert.equal(second.state.noisy, false);
  const third = guideHear(second.state, 'eh', 'Luis');
  assert.equal(third.state.noisy, true);
  assert.equal(third.state.paused, true);
  assert.match(third.say, /mucho ruido o varias voces/);
  // Con la escucha detenida, la voz no anota nada.
  assert.equal(guideHear(third.state, 'tres', 'Luis').apply, undefined);
  // Lo escrito a mano reanuda y se registra.
  const typed = guideHear(third.state, '3', 'Luis', true);
  assert.deepEqual(typed.apply.sites, { MV: { depth: 3 } });
  assert.equal(typed.state.noisy, false);
  assert.equal(typed.state.paused, false);
  // «Reintentar» sin escribir también reanuda.
  const retry = guideHear(third.state, 'reintentar', 'Luis');
  assert.equal(retry.state.noisy, false);
  assert.equal(retry.state.misses, 0);
  // Una respuesta buena reinicia el conteo.
  assert.equal(guideHear(second.state, 'tres').state.misses, 0);
});

test('guía periodontal: ausente quita la pieza del recorrido y avisa para el odontograma', () => {
  const out = guideHear(begin(), 'ausente');
  assert.equal(out.markedAbsent, 18);
  assert.deepEqual(out.state.absent, [18]);
  assert.equal(out.state.order[out.state.index], 17);
  assert.match(out.say, /^Pieza uno ocho ausente\.\s*\nAutoriza la pieza uno siete\./);
});

test('guía periodontal: repetir, atrás, saltar, pausa y terminar', () => {
  let s = run(begin(), ['tres', 'cero']).state;
  assert.equal(s.pos, 2);
  assert.match(guideHear(s, 'repetir').say, /Dime el sondaje de central vestibular/);
  s = guideHear(s, 'atrás').state; assert.equal(s.pos, 1);
  s = guideHear(s, 'atrás').state; assert.equal(s.pos, 0);
  s = guideHear(s, 'saltar').state; assert.equal(s.order[s.index], 17);
  s = guideHear(s, 'atrás').state; assert.equal(s.order[s.index], 18);
  s = guideHear(s, 'pausa').state; assert.equal(s.paused, true);
  assert.equal(guideHear(s, 'tres').apply, undefined);
  s = guideHear(s, 'continuar').state; assert.equal(s.paused, false);
  assert.equal(guideHear(s, 'terminar').state.done, true);
});

test('guía periodontal: sangrado y supuración por cara y sitio; «nada» pasa a la siguiente', () => {
  assert.deepEqual(parseGuideFlags('sangrado').sites, { MV: { bleeding: true }, V: { bleeding: true }, DV: { bleeding: true }, ML: { bleeding: true }, L: { bleeding: true }, DL: { bleeding: true } });
  assert.deepEqual(parseGuideFlags('sangrado vestibular').sites, { MV: { bleeding: true }, V: { bleeding: true }, DV: { bleeding: true } });
  assert.deepEqual(parseGuideFlags('sangrado mesial y distal palatino, supuración distopalatino').sites, { ML: { bleeding: true }, DL: { bleeding: true, suppuration: true } });
  assert.ok('error' in parseGuideFlags('sangrado mesial'));
  let s = run(begin(), SITES).state;
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
  const end = run(guideAuthorize(start.state, 48).state, [...Array(12).fill('2'), 'nada']);
  assert.equal(end.state.done, true);
  assert.match(end.outs[12].say, /Examen completo/);
});

test('guía periodontal: nada se registra hasta que el profesional autoriza la pieza', () => {
  const start = guideStart({}, 'Luis');
  assert.equal(start.state.step, 'await');
  const early = guideHear(start.state, 'tres dos cuatro', 'Luis');
  assert.equal(early.apply, undefined);
  assert.equal(early.state.step, 'await');
  assert.match(early.say, /Primero autoriza la pieza uno ocho/);
  const ok = guideAuthorize(start.state, 18, 'Luis');
  assert.equal(ok.state.step, 'site');
  assert.match(ok.say, /^Pieza uno ocho, Luis\.\nDime el sondaje de mesial vestibular/);
  // El profesional puede autorizar otra pieza distinta de la propuesta.
  const other = guideAuthorize(start.state, 46, 'Luis');
  assert.equal(other.state.order[other.state.index], 46);
  // A mitad de una pieza, un clic en otra no la cambia.
  const mid = guideAuthorize(ok.state, 17, 'Luis');
  assert.equal(mid.state.order[mid.state.index], 18);
  assert.equal(mid.state.step, 'site');
  // Una pieza fuera del recorrido (ausente) no se puede autorizar.
  assert.equal(guideAuthorize(guideStart({ 16: 'Ausente' }).state, 16).state.step, 'await');
});

test('guía periodontal: dictar solo una pieza empieza de inmediato en ella y se cierra al terminarla', () => {
  const start = guideStart({}, 'Luis', 11, true);
  assert.equal(start.state.single, true);
  assert.deepEqual(start.state.order, [11]);
  assert.equal(start.state.step, 'site');
  assert.match(start.say, /^Pieza uno uno solamente\.\nPieza uno uno, Luis\.\nDime el sondaje de mesial vestibular\./);
  const out = run(start.state, [...Array(12).fill('2'), 'nada']);
  assert.deepEqual(out.outs[0].apply.sites, { MV: { depth: 2 } });
  assert.equal(out.state.done, true);
  assert.match(out.outs[12].say, /Pieza uno uno lista/);
  // «atrás» en el primer sitio no salta a otra pieza.
  const back = guideHear(start.state, 'atrás');
  assert.equal(back.state.order[back.state.index], 11);
  assert.equal(back.state.step, 'site');
  // Otra pieza no se puede autorizar a mitad.
  assert.equal(guideAuthorize(start.state, 21).state.order[0], 11);
});

test('guía periodontal: una pieza ausente o con implante no se dicta sola y lo avisa', () => {
  const start = guideStart({ 21: 'Ausente' }, 'Luis', 21, true);
  assert.equal(start.state.done, true);
  assert.match(start.say, /ausente o con implante/);
  assert.equal(guideStart({ 21: 'Implante' }, '', 21, true).state.done, true);
});

test('guía periodontal: el recorrido completo puede partir de la pieza elegida', () => {
  const start = guideStart({}, 'Luis', 21);
  assert.equal(start.state.order[start.state.index], 21);
  assert.equal(start.state.step, 'await');
  assert.equal(start.state.order.length, 32);
});

test('la ventana de la pieza ofrece dictar solo esa pieza y la guía lo expone', async () => {
  const { readFileSync } = await import('node:fs');
  const modal = readFileSync(new URL('../components/perio-tooth-modal.tsx', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../components/perio-guide.tsx', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../components/periodontogram.tsx', import.meta.url), 'utf8');
  assert.match(modal, /data-testid="perio-modal-dictate"/);
  assert.match(modal, /Dictar periodontograma de esta pieza/);
  assert.match(guide, /startOnly\(tooth: number\): void/);
  assert.match(host, /onDictate=\{t=>\{setViewer\(null\);setTooth\(t\);guide\.current\?\.startOnly\(t\)\}\}/);
});

test('guía periodontal: la confirmación y la siguiente pregunta van en frases separadas, sondaje aparte del margen', () => {
  const depth = guideHear(begin({}, 'Luis'), 'tres', 'Luis');
  const [confirm, ask, ...rest] = depth.say.split('\n');
  assert.equal(rest.length, 0);
  assert.equal(confirm, 'Sondaje mesial vestibular, 3.');
  assert.equal(ask, 'Ahora, dime el margen gingival de mesial vestibular.');
  assert.ok(!/margen/i.test(confirm), 'la confirmación del sondaje no menciona el margen');
  const margin = guideHear(depth.state, 'uno', 'Luis');
  const [confirm2, ask2] = margin.say.split('\n');
  assert.equal(confirm2, 'Margen gingival mesial vestibular, 1.');
  assert.ok(!/sondaje/i.test(confirm2));
  assert.equal(ask2, 'Dime el sondaje de central vestibular.');
});
