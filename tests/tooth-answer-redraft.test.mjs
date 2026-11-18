import test from 'node:test';
import assert from 'node:assert/strict';
import { redraftToothAnswer } from '../lib/dictation/tooth-answer-redraft.ts';

const answer = text => async (_url, init) => {
  const request = JSON.parse(init.body);
  assert.equal(request.model, 'gpt-5.6-luna');
  assert.match(request.messages[0].content, /odontológico experto/);
  assert.doesNotMatch(JSON.stringify(request.messages[1]), /test-secret/);
  return Response.json({ choices: [{ message: { content: JSON.stringify({ text }) } }] });
};

test('la IA redacta el plan sin la instrucción oral ni duplicar la restauración', async () => {
  const source = 'Intento colocar una base ionómero y una resina compuesta oclusal. Una obturación de resina compuesta oclusal. Analiza la respuesta.';
  const draft = 'Se propone colocar una base de ionómero y realizar una restauración oclusal con resina compuesta.';
  assert.equal(await redraftToothAnswer(source, 'plan', 16, 'test-secret', { fetcher: answer(draft) }), draft);
});

test('la hipótesis puede conservar la última versión de una autocorrección verbal', async () => {
  const source = 'Caries distal, me equivoqué, caries mesial en dentina.';
  const draft = 'Hipótesis diagnóstica: caries mesial en dentina.';
  assert.equal(await redraftToothAnswer(source, 'diagnosis', 16, 'test-secret', { fetcher: answer(draft) }), draft);
});

test('se rechazan piezas, caras o tratamientos realizados que el profesional no propuso', async () => {
  await assert.rejects(redraftToothAnswer('Caries mesial en pieza FDI 1.6.', 'diagnosis', 16, 'secret', { fetcher: answer('Caries mesial en pieza FDI 1.5.') }), /cifra/);
  await assert.rejects(redraftToothAnswer('Caries mesial en dentina.', 'diagnosis', 16, 'secret', { fetcher: answer('Caries distal en dentina.') }), /cara dental/);
  await assert.rejects(redraftToothAnswer('Propongo una resina oclusal.', 'plan', 16, 'secret', { fetcher: answer('Se realizó una restauración oclusal.') }), /tratamiento realizado/);
});

test('no acepta una instrucción de edición dentro de la redacción final', async () => {
  await assert.rejects(redraftToothAnswer('Resina oclusal. Analiza la respuesta.', 'plan', 16, 'secret', { fetcher: answer('Resina oclusal. Analiza la respuesta.') }), /instrucción/);
});
