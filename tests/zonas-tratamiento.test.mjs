import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneOptions, zoneTeeth, zoneLabel, parseZone, priceUnitFromName } from '../lib/treatment-zones.ts';
import { normalizeBudgetItems } from '../lib/budget-plans.ts';

const keys = d => Object.fromEntries(zoneOptions(d).map(o => [o.key, o.teeth]));

test('zonas permanentes: boca completa = 32, arcadas = 16, cuadrantes = 8', () => {
  const z = keys('perm');
  assert.equal(z.boca.length, 32);
  assert.equal(z['arc-sup'].length, 16);
  assert.equal(z['arc-inf'].length, 16);
  assert.deepEqual(z['cuad-1'], [11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(z['cuad-3'], [31, 32, 33, 34, 35, 36, 37, 38]);
  assert.ok(z['arc-sup'].every(t => t < 30) && z['arc-inf'].every(t => t > 30));
});

test('sextantes permanentes siguen el EPB MINSAL y cubren las 32 piezas sin repetir', () => {
  const z = keys('perm');
  assert.deepEqual(z['sext-1'], [14, 15, 16, 17, 18]);
  assert.deepEqual(z['sext-2'], [11, 12, 13, 21, 22, 23]);
  assert.deepEqual(z['sext-3'], [24, 25, 26, 27, 28]);
  assert.deepEqual(z['sext-4'], [44, 45, 46, 47, 48]);
  assert.deepEqual(z['sext-5'], [31, 32, 33, 41, 42, 43]);
  assert.deepEqual(z['sext-6'], [34, 35, 36, 37, 38]);
  const all = [1, 2, 3, 4, 5, 6].flatMap(n => z[`sext-${n}`]);
  assert.equal(new Set(all).size, 32);
  assert.equal(all.length, 32);
});

test('zonas temporales: 20 piezas, cuadrantes 5–8 y sextantes sin repetir', () => {
  const z = keys('temp');
  assert.equal(z.boca.length, 20);
  assert.deepEqual(z['cuad-1'], [51, 52, 53, 54, 55]);
  assert.deepEqual(z['cuad-4'], [81, 82, 83, 84, 85]);
  const all = [1, 2, 3, 4, 5, 6].flatMap(n => z[`sext-${n}`]);
  assert.equal(all.length, 20);
  assert.equal(new Set(all).size, 20);
});

test('zona: lectura, etiqueta y rechazo de valores inválidos', () => {
  assert.equal(zoneLabel('perm:arc-sup'), 'Arcada superior');
  assert.equal(zoneLabel('temp:cuad-2'), 'Cuadrante 2 (temporal)');
  assert.equal(parseZone('perm:cuad-9'), null);
  assert.equal(parseZone('xx:boca'), null);
  assert.deepEqual(zoneTeeth('nada'), []);
});

test('el plan guarda la zona y sus piezas; una zona inválida se ignora', () => {
  const [item] = normalizeBudgetItems([{ label: 'Destartraje', amount: 30000, zone: 'perm:sext-2' }]);
  assert.equal(item.zone, 'perm:sext-2');
  assert.deepEqual(item.teeth, [11, 12, 13, 21, 22, 23]);
  const [bad] = normalizeBudgetItems([{ label: 'Destartraje', amount: 30000, zone: 'perm:sext-9', teeth: [36] }]);
  assert.equal(bad.zone, undefined);
  assert.deepEqual(bad.teeth, [36]);
  const [boca] = normalizeBudgetItems([{ label: 'Flúor', amount: 20000, zone: 'perm:boca' }]);
  assert.equal(boca.teeth.length, 32);
});

test('unidad de cobro deducida del nombre del arancel', () => {
  assert.equal(priceUnitFromName('DESTARTRAJE SUBGINGIVAL POR SEXTANTE'), 'sextante');
  assert.equal(priceUnitFromName('APLICACION DE FLUOR BARNIZ BOCA COMPLETA'), 'boca');
  assert.equal(priceUnitFromName('Obturación de resina — 2 caras'), 'cara');
  assert.equal(priceUnitFromName('Exodoncia simple'), null);
});
