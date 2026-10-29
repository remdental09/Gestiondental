import test from 'node:test';
import assert from 'node:assert/strict';
import { installedImplantTeeth } from '../app/implant-evidence.ts';
import { formatFdi } from '../app/clinical-data.ts';

test('FDI codes display with quadrant and tooth separated by a point', () => {
  assert.equal(formatFdi(12), '1.2');
  assert.equal(formatFdi(13), '1.3');
  assert.equal(formatFdi(21), '2.1');
});

test('two completed placements map Chile 30/19 to FDI 36/46', () => {
  const text = 'Se realizó exodoncia de dos raíces de la pieza 30 con odontosección. Se instaló un implante de 3,3 × 8 mm en la pieza 30 y un implante de 3,8 × 7 mm en el sitio edéntulo correspondiente a la pieza 19.';
  assert.deepEqual(installedImplantTeeth(text), [36, 46]);
});

test('plans, negations and isolated implant mentions do not change the chart', () => {
  assert.deepEqual(installedImplantTeeth('Se planifica implante en pieza 30. No se instaló implante en pieza 19.'), []);
  assert.deepEqual(installedImplantTeeth('Control de implante en pieza 30.'), []);
  assert.deepEqual(installedImplantTeeth('Se indicó implante en pieza 30.'), []);
});

test('explicit FDI numbers are kept distinct from Chilean numbering', () => {
  assert.deepEqual(installedImplantTeeth('Se colocó un implante en pieza FDI 46.'), [46]);
});

test('dotted FDI references are parsed as FDI while unmarked Chilean numbering stays national', () => {
  assert.deepEqual(installedImplantTeeth('Se colocó un implante en pieza 1.2.'), [12]);
  assert.deepEqual(installedImplantTeeth('Se colocó un implante en pieza 12.'), [24]);
});
