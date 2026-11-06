import test from 'node:test';
import assert from 'node:assert/strict';
import { procedureCovered, deduplicateProcedureSentences, CLINICAL_WRITING_PROMPT } from '../lib/dictation/clinical-writing.ts';
import { buildModelUserPrompt, proposeFromTranscript, validateAiExtraction } from '../lib/dictation/proposal.ts';
import { judgeCorrection } from '../lib/dictation/spoken.ts';

// Casos sintéticos independientes de las fichas y capturas de producción.
const output = (nota = {}, procedimientos = []) => ({ nota, procedimientos, hallazgos: [], presupuesto: [], ficha: [], dudas: [] });
const propose = (transcript, extraction) => proposeFromTranscript({ transcript, chart: [] }, {
  id: 'test', model: 'test', complete: async () => extraction,
}, () => {});

test('la narrativa y el título conservan la numeración nacional frente a puntos añadidos por IA', async () => {
  const result = await propose('Pieza doce con sellante oclusal.', output({ examen: 'Pieza 1.2 con sellante oclusal.' }));
  assert.match(result.proposal.evolution.body, /Pieza 12 con sellante/);
  assert.doesNotMatch(result.proposal.evolution.body, /1\.2/);
  assert.match(result.proposal.evolution.title, /nacional chilena 12 · FDI 2\.4/);
  assert.equal(result.proposal.odontogram[0].tooth, 24);
  assert.equal(judgeCorrection('pieza doce', 'pieza 1.2').safe, false);
});

test('FDI explícito y sistemas distintos no se confunden', () => {
  for (const transcript of ['FDI 1.2 con sellante.', 'Pieza 1.2 con sellante.', 'Pieza doce con sellante. FDI 1.2 sin hallazgos.']) {
    const extraction = validateAiExtraction(output({ examen: 'Pieza 1.2 sin hallazgos.' }), transcript);
    assert.match(extraction.noteBody, /Pieza 1\.2/);
  }
  const prompt = buildModelUserPrompt({ transcript: 'Pieza doce con sellante.', chart: [] });
  assert.match(prompt, /nacional chilena 12 · FDI 2\.4/);
  const universal = validateAiExtraction(output({ examen: 'Pieza Universal 12 sin hallazgos.' }), 'Pieza Universal 12 sin hallazgos.');
  assert.match(universal.noteBody, /Universal 12/);
});

test('no inventa Control como motivo ni usa la próxima cita como motivo de hoy', () => {
  for (const transcript of ['Se realiza profilaxis.', 'Se realiza profilaxis. Control en seis meses.']) {
    const extraction = validateAiExtraction(output({ motivo: 'Control.', procedimientos: 'Se realiza profilaxis.' }), transcript);
    assert.doesNotMatch(extraction.noteBody, /Motivo de consulta|Control/);
  }
  assert.match(validateAiExtraction(output({ motivo: 'Control.' }), 'Paciente viene a control.').noteBody, /Control/);
});

test('integra la redacción y no vuelve a pegar una frase mixta del dictado', async () => {
  const transcript = 'En la pieza 14 se observa una restauración antigua, se hace pulido con pasta. Se realiza profilaxis.';
  const result = await propose(transcript, output({
    examen: 'Se observa una restauración antigua en la pieza 14.',
    procedimientos: 'Se realiza pulido con pasta en la pieza 14 y profilaxis.',
  }, [
    { texto: 'Se realiza pulido con pasta en la pieza 14.', evidencia: 'se hace pulido con pasta' },
    { texto: 'Se realiza profilaxis.', evidencia: 'Se realiza profilaxis' },
  ]));
  assert.equal((result.proposal.evolution.body.match(/pulido/g) || []).length, 1);
  assert.equal((result.proposal.evolution.body.match(/profilaxis/g) || []).length, 1);
  assert.doesNotMatch(result.proposal.evolution.body, /se hace/);
});

test('un procedimiento omitido se recupera desde su redacción verificada', async () => {
  const result = await propose('Se realiza profilaxis.', output({ examen: 'Evaluación de tejidos blandos.' }, [
    { texto: 'Se realiza profilaxis.', evidencia: 'Se realiza profilaxis' },
  ]));
  assert.match(result.proposal.evolution.body, /Procedimientos realizados\nSe realiza profilaxis/);
});

test('si no se puede comprobar la cobertura, deja una revisión visible sin pegar texto crudo', async () => {
  const result = await propose('Se realiza pulido con pasta en pieza 15.', output({ procedimientos: 'Se realiza pulido.' }));
  assert.match(result.proposal.clarifications.join(' '), /Revisa que la evolución incluya.*pasta.*15/);
  assert.doesNotMatch(result.proposal.evolution.body, /Se realiza pulido con pasta/);
});

test('la deduplicación conserva piezas, medidas, materiales y negaciones diferentes', () => {
  for (const [source, candidate] of [
    ['Pulido en pieza 14', 'Pulido en pieza 15'],
    ['Sutura de seda 4-0', 'Sutura de seda 3-0'],
    ['Se realiza pulido con pasta', 'Se realiza pulido'],
    ['No se realiza profilaxis', 'Se realiza profilaxis'],
    ['Se realiza profilaxis', 'No se realiza profilaxis'],
  ]) assert.equal(procedureCovered(source, candidate), false, source);
  assert.equal(deduplicateProcedureSentences('Se realiza pulido con pasta y profilaxis. Se realiza profilaxis.'), 'Se realiza pulido con pasta y profilaxis.');
  assert.equal(deduplicateProcedureSentences('Se realiza profilaxis. Se realiza pulido con pasta y profilaxis.'), 'Se realiza pulido con pasta y profilaxis.');
});

import { CLINICAL_WRITING_PROMPT as WRITING_PROMPT_REGISTER } from "../lib/dictation/clinical-writing.ts";
import { AI_SYSTEM_PROMPT as SYSTEM_PROMPT_REGISTER } from "../lib/dictation/proposal.ts";

test("el prompt de redacción exige registro formal sin agregar pasos no dictados", () => {
  assert.match(WRITING_PROMPT_REGISTER, /Registro formal/);
  assert.match(WRITING_PROMPT_REGISTER, /Prohibido agregar/);
  assert.match(WRITING_PROMPT_REGISTER, /remoción de tejido cariado/);
  assert.match(SYSTEM_PROMPT_REGISTER, /Registro formal/);
});

test("el prompt conserva términos técnicos y separa indicaciones del plan", () => {
  assert.match(CLINICAL_WRITING_PROMPT, /«sextante» no es «grupo»/);
  assert.match(CLINICAL_WRITING_PROMPT, /técnica de cepillado.*«Indicaciones»/s);
  assert.match(CLINICAL_WRITING_PROMPT, /nunca pidas aclarar un término que tú mismo cambiaste/);
});
