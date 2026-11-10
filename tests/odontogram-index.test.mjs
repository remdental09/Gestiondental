import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCariesExperience } from '../app/odontogram-index.ts';

test('la exodoncia indicada conserva la pieza en el preconteo COP-D', () => {
  const data = {
    teeth: { 36: 'Indicación de exodoncia', 46: 'Ausente', 26: 'Implante' },
    missingReason: { 36: 'caries', 46: 'caries', 26: 'caries' },
    surfaces: {},
  };
  assert.deepEqual(calculateCariesExperience([36, 46, 26], data), {
    caries: 1, missing: 2, filled: 0, total: 3, missingUnknownCause: 0, implantsCounted: 1,
  });
});

test('una indicación por otra causa no se cuenta como pérdida ni caries', () => {
  const data = {
    teeth: { 36: 'Indicación de exodoncia' },
    missingReason: { 36: 'other' },
    surfaces: {},
  };
  assert.deepEqual(calculateCariesExperience([36], data), {
    caries: 0, missing: 0, filled: 0, total: 0, missingUnknownCause: 0, implantsCounted: 0,
  });
});

test('el implante cuenta como pieza perdida en el COP-D, salvo «otra causa»', () => {
  const data = {
    teeth: { 36: 'Implante', 46: 'Implante con pilar', 21: 'Implante', 11: 'Corona', 45: 'Ausente' },
    missingReason: { 21: 'other' },
    crowns: { 11: { material: 'Zirconio', foundation: 'implant' } },
    surfaces: {},
  };
  const r = calculateCariesExperience([36, 46, 21, 11, 45], data);
  assert.equal(r.missing, 4, '3.6, 4.6, 1.1 (corona sobre implante) y 4.5 ausente; 2.1 por otra causa no');
  assert.equal(r.implantsCounted, 3);
  assert.equal(r.missingUnknownCause, 4);
});
