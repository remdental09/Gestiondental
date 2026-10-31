import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bitingFaceName,
  chileLabel,
  innerFaceName,
  rootCount,
  surfaceAxis,
  toothKind,
} from '../app/tooth-3d-map.ts';

test('el tipo, las raíces y la numeración chilena siguen la pieza FDI', () => {
  assert.equal(toothKind(11), 'incisor');
  assert.equal(toothKind(13), 'canine');
  assert.equal(toothKind(14), 'premolar');
  assert.equal(toothKind(24), 'premolar');
  assert.equal(toothKind(16), 'molar');
  assert.equal(toothKind(36), 'molar');
  assert.equal(toothKind(46), 'molar');
  assert.equal(toothKind(55), 'molar');
  assert.equal(toothKind(51), 'incisor');

  assert.equal(rootCount(11), 1);
  assert.equal(rootCount(14), 1);
  assert.equal(rootCount(16), 3);
  assert.equal(rootCount(26), 3);
  assert.equal(rootCount(36), 2);
  assert.equal(rootCount(46), 2);
  assert.equal(rootCount(55), 3);
  assert.equal(rootCount(75), 2);

  assert.equal(chileLabel(36), 'Chile 30');
  assert.equal(chileLabel(46), 'Chile 19');
  assert.equal(chileLabel(24), 'Chile 12');
  assert.equal(chileLabel(11), 'Chile 8');
  assert.equal(chileLabel(18), 'Chile 1');
  assert.equal(chileLabel(55), 'Chile A');
});

test('las caras miran al eje correcto y se invierten por cuadrante', () => {
  for (const tooth of [11, 14, 16, 41, 46, 55, 85]) {
    assert.deepEqual(surfaceAxis(tooth, 'O'), { axis: 'y', sign: 1 });
    assert.deepEqual(surfaceAxis(tooth, 'V'), { axis: 'z', sign: 1 });
    assert.deepEqual(surfaceAxis(tooth, 'P'), { axis: 'z', sign: -1 });
    assert.deepEqual(surfaceAxis(tooth, 'M'), { axis: 'x', sign: 1 });
    assert.deepEqual(surfaceAxis(tooth, 'D'), { axis: 'x', sign: -1 });
  }
  for (const tooth of [21, 24, 26, 31, 36, 65, 75]) {
    assert.deepEqual(surfaceAxis(tooth, 'M'), { axis: 'x', sign: -1 }, `mesial ${tooth}`);
    assert.deepEqual(surfaceAxis(tooth, 'D'), { axis: 'x', sign: 1 }, `distal ${tooth}`);
  }
  assert.equal(innerFaceName(16), 'Palatina');
  assert.equal(innerFaceName(21), 'Palatina');
  assert.equal(innerFaceName(36), 'Lingual');
  assert.equal(innerFaceName(46), 'Lingual');
  assert.equal(bitingFaceName(11), 'Incisal');
  assert.equal(bitingFaceName(13), 'Incisal');
  assert.equal(bitingFaceName(16), 'Oclusal');
  assert.equal(bitingFaceName(36), 'Oclusal');
});
