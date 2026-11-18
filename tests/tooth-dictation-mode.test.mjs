import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedCariesFaces, crownShadeAfterDictation, isProximalChange, scopeToothProposal, toothDiagnosisOperation, toothDictationOperation, toothPlanBudgetItem } from '../lib/dictation/tooth-mode.ts';
import { toothPrompt } from '../lib/dictation/tooth-prompts.ts';
import { focusedToothReview, structureTranscript } from '../lib/dictation/proposal.ts';

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

test('la evaluación por pieza separa la pregunta hablada de diagnóstico y plan', () => {
  assert.equal(toothPrompt('diagnosis', 11), '¿Cuál es el diagnóstico o hipótesis diagnóstica de la pieza FDI 1.1?');
  assert.equal(toothPrompt('plan', 11), '¿Qué plan de tratamiento preliminar propones para la pieza FDI 1.1?');
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

test('el diagnóstico separado se guarda como dictado profesional y mantiene su carácter de hipótesis', () => {
  assert.deepEqual(toothDiagnosisOperation('  caries distal, dentina profunda  '), {
    kind: 'diagnosis',
    title: 'Diagnóstico / hipótesis (dictado)',
    detail: 'caries distal, dentina profunda',
  });
  assert.equal(toothDiagnosisOperation('   '), null);
  assert.equal(toothDiagnosisOperation('x'.repeat(1200)).detail.length, 1000);
});

test('el plan preliminar crea prestaciones editables, sin inventar un valor y ligadas a la pieza seleccionada', () => {
  assert.deepEqual(toothPlanBudgetItem('Endodoncia', 11, '5010001'), {
    label: 'Endodoncia', amount: 0, phase: 'Fase 1', discountPercent: 0, teeth: [11], code: '5010001',
  });
  assert.equal(toothPlanBudgetItem('Resina', 11, 'no-verificado').code, undefined);
  assert.equal(toothPlanBudgetItem('x'.repeat(200), 11).label.length, 180);
});

test('un dictado que omite el color de corona lo conserva y un color explícito lo reemplaza', () => {
  assert.equal(crownShadeAfterDictation(null, 'A2'), 'A2');
  assert.equal(crownShadeAfterDictation(undefined, 'A2'), 'A2');
  assert.equal(crownShadeAfterDictation('B1', 'A2'), 'B1');
  assert.equal(crownShadeAfterDictation(null, null), null);
});

test('la pieza chilena 8 pide aclarar distal o mesial aunque la resina distal solo sea un plan', () => {
  const text = 'FDI 1.1. Pieza 8 tiene una caries distal media. Vamos a planificar una resina compuesta distal para solucionar el problema. Vamos a usar, pero el diagnóstico por ahora es una caries mesial. Dentina media.';
  const review = focusedToothReview(text, 11);
  assert.deepEqual(review.otherTeeth, []);
  assert.equal(review.cariesFaceQuestion, true);
  assert.equal(isProximalChange(surface(11, { surface: 'M' })), true);
  assert.equal(isProximalChange(surface(11)), false);
});

test('un plan en otra cara no crea una contradicción y se detectan menciones de otra pieza', () => {
  assert.equal(focusedToothReview('FDI 1.1. Caries mesial. Planifico resina distal.', 11).cariesFaceQuestion, false);
  assert.equal(focusedToothReview('FDI 1.1. Caries mesial y distal.', 11).cariesFaceQuestion, false);
  assert.equal(focusedToothReview('FDI 1.1. Caries mesial o distal.', 11).cariesFaceQuestion, true);
  assert.deepEqual(focusedToothReview('FDI 1.1. Caries mesial. Control en FDI 2.1.', 11).otherTeeth, [21]);
});

test('la respuesta explícita confirma solo las caras elegidas sin transferir profundidades', () => {
  const mesial = { condition: 'caries', depth: 'dentin_deep' };
  assert.deepEqual(confirmedCariesFaces([], { M: mesial }), []);
  assert.deepEqual(confirmedCariesFaces(['M', 'D'], { M: mesial }), [
    { kind: 'surface', surface: 'M', finding: mesial },
    { kind: 'surface', surface: 'D', finding: { condition: 'caries', depth: null, icdas: null, activity: null } },
  ]);
});
