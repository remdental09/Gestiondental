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
  assert.match(start.say, /Son 31 piezas\. Autoriza la pieza uno siete\./);
  assert.deepEqual(guideOrder({}).slice(15, 18), [28, 38, 37]);
});

// Seis sitios, cada uno con sondaje y margen.
const SITES = ['3','0','2','0','4','0','5','0','6','0','5','0'];

test('guía periodontal: una pieza completa, sitio por sitio y en orden', () => {
  const phrases = ['tres', 'cero', 'dos', 'uno', 'cuatro', 'uno', 'cinco', 'menos uno', 'seis', 'cero', 'cinco', 'cero'];
  const { state, outs } = run(begin({}, 'Luis'), phrases);
  assert.deepEqual(outs[0].apply, { tooth: 18, sites: { MV: { depth: 3 } } });
  assert.equal(outs[0].say, '3. Margen gingival, mesial vestibular.');
  assert.deepEqual(outs[1].apply.sites, { MV: { margin: 0 } });
  assert.equal(outs[1].say, '0. central vestibular, sondaje.');
  assert.deepEqual(outs[2].apply.sites, { V: { depth: 2 } });
  assert.deepEqual(outs[6].apply.sites, { ML: { depth: 5 } });
  assert.match(outs[5].say, /distal vestibular|mesial palatino/);
  assert.equal(outs[5].say, '1. mesial palatino, sondaje.');
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
  assert.equal(both.say, '3, margen 1. central vestibular, sondaje.');
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
  assert.match(first.say, /^No te entendí\. Luis, pieza uno ocho\. mesial vestibular, sondaje\./);
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
  assert.match(out.say, /^Pieza uno ocho ausente\. Autoriza la pieza uno siete\./);
});

test('guía periodontal: repetir, atrás, saltar, pausa y terminar', () => {
  let s = run(begin(), ['tres', 'cero']).state;
  assert.equal(s.pos, 2);
  assert.match(guideHear(s, 'repetir').say, /central vestibular, sondaje/);
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
  assert.match(ok.say, /^Luis, pieza uno ocho\. mesial vestibular, sondaje/);
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
