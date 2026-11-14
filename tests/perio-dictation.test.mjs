import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePerioDictation, describePerioDictation, chileToFdi } from '../lib/dictation/perio-dictation.ts';

const tooth = (result, n) => result.teeth.find(item => item.tooth === n);

test('dictado periodontal: pieza, cara y tres sondajes de mesial a distal', () => {
  const r = parsePerioDictation('Pieza uno seis vestibular tres, dos, cuatro. Palatino cinco seis cinco.');
  assert.deepEqual(r.teeth.map(t => t.tooth), [16]);
  const t = tooth(r, 16);
  assert.deepEqual([t.sites.MV.depth, t.sites.V.depth, t.sites.DV.depth], [3, 2, 4]);
  assert.deepEqual([t.sites.ML.depth, t.sites.L.depth, t.sites.DL.depth], [5, 6, 5]);
  assert.deepEqual(r.ignored, []);
});

test('dictado periodontal: acepta cifras como las escribe el transcriptor', () => {
  const r = parsePerioDictation('1.6 vestibular 3-2-4, lingual 324. Pieza 46 vestibular 5, 6, 7');
  assert.deepEqual([tooth(r, 16).sites.MV.depth, tooth(r, 16).sites.V.depth, tooth(r, 16).sites.DV.depth], [3, 2, 4]);
  assert.deepEqual([tooth(r, 16).sites.ML.depth, tooth(r, 16).sites.L.depth, tooth(r, 16).sites.DL.depth], [3, 2, 4]);
  assert.deepEqual([tooth(r, 46).sites.MV.depth, tooth(r, 46).sites.V.depth, tooth(r, 46).sites.DV.depth], [5, 6, 7]);
});

test('dictado periodontal: varias piezas seguidas sin decir «pieza»', () => {
  const r = parsePerioDictation('uno seis vestibular tres dos cuatro cuatro seis vestibular cinco cinco seis treinta y seis lingual dos dos tres');
  assert.deepEqual(r.teeth.map(t => t.tooth), [16, 46, 36]);
  assert.deepEqual([tooth(r, 46).sites.MV.depth, tooth(r, 46).sites.V.depth, tooth(r, 46).sites.DV.depth], [5, 5, 6]);
  assert.deepEqual([tooth(r, 36).sites.ML.depth, tooth(r, 36).sites.L.depth, tooth(r, 36).sites.DL.depth], [2, 2, 3]);
});

test('dictado periodontal: margen con signo, recesión y agrandamiento', () => {
  const r = parsePerioDictation('pieza 2.1 vestibular 3 3 3 margen menos uno cero dos. Palatino 4 4 4 recesión 2 2 1. Pieza 1.1 vestibular 2 2 2 agrandamiento 1 1 1');
  const t = tooth(r, 21);
  assert.deepEqual([t.sites.MV.margin, t.sites.V.margin, t.sites.DV.margin], [-1, 0, 2]);
  assert.deepEqual([t.sites.ML.margin, t.sites.L.margin, t.sites.DL.margin], [2, 2, 1]);
  assert.deepEqual([tooth(r, 11).sites.MV.margin, tooth(r, 11).sites.V.margin, tooth(r, 11).sites.DV.margin], [-1, -1, -1]);
});

test('dictado periodontal: sangrado y supuración por sitio o en toda la cara', () => {
  const r = parsePerioDictation('pieza 3.6 vestibular 5 6 7 sangrado mesial y distal, supuración distal. Lingual 4 4 4 sangrado');
  const t = tooth(r, 36);
  assert.equal(t.sites.MV.bleeding, true);
  assert.equal(t.sites.V.bleeding, undefined);
  assert.equal(t.sites.DV.bleeding, true);
  assert.equal(t.sites.DV.suppuration, true);
  assert.deepEqual([t.sites.ML.bleeding, t.sites.L.bleeding, t.sites.DL.bleeding], [true, true, true]);
});

test('dictado periodontal: un solo sitio, movilidad y furcación', () => {
  const r = parsePerioDictation('pieza 4.6 mesiovestibular 7, distolingual 6, movilidad grado dos, furca uno');
  const t = tooth(r, 46);
  assert.equal(t.sites.MV.depth, 7);
  assert.equal(t.sites.DL.depth, 6);
  assert.equal(t.sites.V, undefined);
  assert.equal(t.mobility, 'II');
  assert.equal(t.furcation, 'I');
});

test('dictado periodontal: nunca inventa; lo que no entiende queda aparte', () => {
  const r = parsePerioDictation('hola paciente pieza 9.9 vestibular 3 2 4');
  assert.equal(r.teeth.length, 0);
  assert.ok(r.ignored.includes('hola'));
  const extra = parsePerioDictation('pieza 1.6 vestibular 3 2 4 9');
  assert.deepEqual(Object.keys(tooth(extra, 16).sites), ['MV', 'V', 'DV']);
  assert.ok(extra.ignored.includes('9'));
  assert.deepEqual(parsePerioDictation('pieza 1.6 vestibular 35').teeth, []);
});

test('dictado periodontal: resumen legible para revisar', () => {
  const [item] = parsePerioDictation('pieza 1.6 vestibular 3 2 4 margen 0 1 1 sangrado mesial movilidad uno').teeth;
  assert.deepEqual(describePerioDictation(item), ['Vestibular: sondaje 3 · 2 · 4; margen 0 · 1 · 1; sangrado mesial', 'Movilidad I']);
});

test('dictado periodontal: numeración como en el resto de la aplicación (FDI con punto o dos cifras; cardinal 1–32 = chilena)', () => {
  assert.deepEqual([3, 8, 9, 16, 19, 24, 25, 30, 32].map(chileToFdi), [16, 11, 21, 28, 46, 41, 31, 36, 38]);
  assert.deepEqual(parsePerioDictation('pieza 3 vestibular 3 2 4').teeth.map(t => t.tooth), [16]);
  assert.deepEqual(parsePerioDictation('pieza treinta vestibular 3 2 4').teeth.map(t => t.tooth), [36]);
  assert.deepEqual(parsePerioDictation('pieza dieciséis vestibular 3 2 4').teeth.map(t => t.tooth), [28]);
  assert.deepEqual(parsePerioDictation('FDI 16 vestibular 3 2 4').teeth.map(t => t.tooth), [16]);
  assert.deepEqual(parsePerioDictation('pieza uno seis vestibular 3 2 4').teeth.map(t => t.tooth), [16]);
  assert.deepEqual(parsePerioDictation('pieza 1.6 vestibular 3 2 4').teeth.map(t => t.tooth), [16]);
  const dos = parsePerioDictation('uno seis vestibular cinco seis siete. Pieza 3 punto 6 lingual tres tres ocho');
  assert.deepEqual(dos.teeth.map(t => t.tooth), [16, 36]);
  assert.deepEqual([dos.teeth[0].sites.MV.depth, dos.teeth[0].sites.V.depth, dos.teeth[0].sites.DV.depth], [5, 6, 7]);
  assert.equal(dos.teeth[1].sites.DL.depth, 8);
});
