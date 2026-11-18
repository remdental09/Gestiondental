import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceReviewCommand, stripFinishCommand, updateVoiceSilence, voiceAnswerReadback } from '../lib/dictation/voice-answer.ts';

test('«terminar» al final cierra la respuesta sin borrar palabras clínicas anteriores', () => {
  assert.equal(stripFinishCommand('Caries distal de dentina profunda, terminar.'), 'Caries distal de dentina profunda');
  assert.equal(stripFinishCommand('Planificar la restauración y terminar la preparación'), 'Planificar la restauración y terminar la preparación');
  assert.equal(stripFinishCommand('Undiagnosticoterminar'), 'Undiagnosticoterminar');
  assert.equal(stripFinishCommand('terminar'), '');
  assert.equal(stripFinishCommand('Caries mesial en dentina media. Termina respuesta.'), 'Caries mesial en dentina media');
});

test('el silencio solo termina tras haber detectado voz y después del umbral configurado', () => {
  let state = { lastVoiceAt: null };
  let update = updateVoiceSilence(state, 0.001, 1000, 900);
  assert.equal(update.shouldStop, false);
  update = updateVoiceSilence(update.state, 0.04, 1100, 900);
  assert.equal(update.shouldStop, false);
  update = updateVoiceSilence(update.state, 0.001, 1999, 900);
  assert.equal(update.shouldStop, false);
  update = updateVoiceSilence(update.state, 0.001, 2000, 900);
  assert.equal(update.shouldStop, true);
});

test('un nuevo fragmento de voz reinicia la cuenta del silencio', () => {
  const update = updateVoiceSilence({ lastVoiceAt: 1000 }, 0.05, 1800, 900);
  assert.deepEqual(update, { state: { lastVoiceAt: 1800 }, shouldStop: false });
});

test('la lectura de regreso distingue hipótesis diagnóstica y plan', () => {
  assert.equal(voiceAnswerReadback('diagnosis', 'Caries distal.'), 'Entendí esta hipótesis diagnóstica: Caries distal. ¿Es correcto? Di correcto, pasar al plan; rectificar; o repetir.');
  assert.equal(voiceAnswerReadback('plan', 'Restaurar con resina.'), 'Entendí este plan de tratamiento: Restaurar con resina. ¿Es correcto? Di correcto, preparar propuesta; rectificar; o repetir.');
});

test('las órdenes habladas aprueban cada etapa y exigen una orden explícita para guardar', () => {
  assert.equal(parseVoiceReviewCommand('Correcto, preguntar plano.', 'diagnosis'), 'accept');
  assert.equal(parseVoiceReviewCommand('Correcto pasar al plan', 'diagnosis'), 'accept');
  assert.equal(parseVoiceReviewCommand('Correcto, preparar propuesta', 'plan'), 'accept');
  assert.equal(parseVoiceReviewCommand('Rectificar diagnóstico', 'proposal'), 'correct');
  assert.equal(parseVoiceReviewCommand('Guardar diagnóstico y plan', 'proposal'), 'save');
  assert.equal(parseVoiceReviewCommand('Cara mesial', 'proposal'), 'mesial');
  assert.equal(parseVoiceReviewCommand('El diagnóstico correcto es caries mesial', 'diagnosis'), null);
  assert.equal(parseVoiceReviewCommand('Correcto', 'proposal'), null);
  assert.equal(parseVoiceReviewCommand('Guardar', 'diagnosis'), null);
});
