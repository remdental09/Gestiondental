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
    caries: 1, missing: 1, filled: 0, total: 2,
  });
});

test('una indicación por otra causa no se cuenta como pérdida ni caries', () => {
  const data = {
    teeth: { 36: 'Indicación de exodoncia' },
    missingReason: { 36: 'other' },
    surfaces: {},
  };
  assert.deepEqual(calculateCariesExperience([36], data), {
    caries: 0, missing: 0, filled: 0, total: 0,
  });
});
