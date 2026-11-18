import test from 'node:test';
import assert from 'node:assert/strict';
import { crownShadeAfterDictation, scopeToothProposal, toothDictationOperation } from '../lib/dictation/tooth-mode.ts';
import { structureTranscript } from '../lib/dictation/proposal.ts';

const surface = (tooth, fields = {}) => ({
  id: `odo-${tooth}`,
  tooth,
  numbering: 'chilena',
  numberingLabel: `nacional chilena 30 · FDI 3.6`,
  sourceText: 'caries oclusal',
  kind: 'surface',
  surface: 'O',
  finding: { condition: 'caries', depth: 'dentin_deep', icdas: null, activity: null },
  ...fields,
});

test('el modo pieza deja pasar cambios de la pieza elegida y bloquea si el dictado nombra otra', () => {
  const intended = surface(36);
  assert.deepEqual(scopeToothProposal([intended], 36), { otherTeeth: [], changes: [intended] });

  const other = surface(24);
  assert.deepEqual(scopeToothProposal([intended, other], 36), { otherTeeth: [24], changes: [] });
});

test('el dictado enfocado acepta FDI o chilena y los dos resuelven la pieza seleccionada', () => {
  const fdi = structureTranscript('FDI 3.6. Se observa caries oclusal de dentina profunda.');
  const chile = structureTranscript('FDI 3.6. Se observa caries oclusal de dentina profunda en la pieza chilena 30.');
  assert.deepEqual(fdi.odontogram.map((change) => change.tooth), [36]);
  assert.deepEqual(chile.odontogram.map((change) => change.tooth), [36]);
  assert.equal(fdi.odontogram[0].numbering, 'FDI');
  assert.equal(chile.odontogram[0].numbering, 'chilena');
});

test('solo convierte propuestas clínicas completas y coherentes en operaciones guardables', () => {
  assert.deepEqual(toothDictationOperation(surface(36)), {
    kind: 'surface',
    surface: 'O',
    finding: { condition: 'caries', depth: 'dentin_deep', icdas: null, activity: null },
  });
  assert.equal(toothDictationOperation(surface(36, { conflict: true })), null);
  assert.equal(toothDictationOperation(surface(36, { advisory: 'Planificado' })), null);
  assert.equal(toothDictationOperation(surface(36, { coherence: 'incoherente' })), null);
  assert.equal(toothDictationOperation(surface(36, { finding: undefined })), null);
});

test('un dictado que omite el color de corona lo conserva y un color explícito lo reemplaza', () => {
  assert.equal(crownShadeAfterDictation(null, 'A2'), 'A2');
  assert.equal(crownShadeAfterDictation(undefined, 'A2'), 'A2');
  assert.equal(crownShadeAfterDictation('B1', 'A2'), 'B1');
  assert.equal(crownShadeAfterDictation(null, null), null);
});
