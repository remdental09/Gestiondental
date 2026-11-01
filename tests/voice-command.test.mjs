import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCommand, resolveCommandTarget, spokenDate } from '../lib/dictation/voice-command.ts';
import { wordDiff, changedWordCount } from '../lib/dictation/word-diff.ts';

const TODAY = '2026-11-01';

test('orden de Luis: anular la evolución del 1 de noviembre y dejar solo el control del implante', () => {
  const text = 'Oye elimina el último dictado de Marcela del Pilar Acevedo Cisterna elimina el dictado de la evolución del 1 de noviembre y pon solamente que controlamos el implante 2,6 y que está todo bien';
  const command = parseVoiceCommand(text, TODAY);
  assert.ok(command);
  assert.deepEqual(command.target, { type: 'date', date: '2026-11-01' });
  assert.equal(command.replacement, 'Controlamos el implante 2,6 y que está todo bien');
  assert.match(command.evidence, /^elimina el último dictado/);
});

test('variantes de orden', () => {
  assert.deepEqual(parseVoiceCommand('borra el último dictado', TODAY)?.target, { type: 'last' });
  assert.equal(parseVoiceCommand('borra el último dictado', TODAY)?.replacement, null);
  assert.deepEqual(parseVoiceCommand('anula la evolución de ayer', TODAY)?.target, { type: 'date', date: '2026-10-31' });
  assert.deepEqual(parseVoiceCommand('anula la evolución del primero de octubre', TODAY)?.target, { type: 'date', date: '2026-10-01' });
  assert.deepEqual(parseVoiceCommand('elimina la evolución del 15 de diciembre', TODAY)?.target, { type: 'date', date: '2025-12-15' });
  assert.deepEqual(parseVoiceCommand('elimina la evolución del 03-10-2026', TODAY)?.target, { type: 'date', date: '2026-10-03' });
  const replaced = parseVoiceCommand('reemplaza la última nota por: control sin molestias', TODAY);
  assert.equal(replaced?.replacement, 'Control sin molestias');
  assert.deepEqual(replaced?.target, { type: 'last' });
  assert.equal(parseVoiceCommand('quita el dictado de hoy y escribe solo que no vino', TODAY)?.replacement, 'No vino');
});

test('dictado clínico normal no es orden', () => {
  for (const text of [
    'Se elimina la caries de la pieza 3.6 y se obtura con resina',
    'Se borra el registro de mordida antiguo',
    'Control del implante 2.6, todo bien, nos vemos en tres semanas',
    'Paciente refiere que le sacaron una pieza el año pasado',
  ]) assert.equal(parseVoiceCommand(text, TODAY), null, text);
});

test('una pieza dentaria no se lee como fecha', () => {
  assert.equal(spokenDate('elimina la evolucion del implante 2.6', TODAY), null);
});

test('resolveCommandTarget ignora anuladas y avisa si no hay', () => {
  const notes = [
    { id: 1, clinicalDate: '2026-11-01', recordedAt: '2026-11-01T12:00:00Z', title: 'A', body: 'a' },
    { id: 2, clinicalDate: '2026-11-01', recordedAt: '2026-11-01T15:00:00Z', title: 'B', body: 'b', status: 'anulada' },
    { id: 3, clinicalDate: '2026-10-20', recordedAt: '2026-10-20T12:00:00Z', title: 'C', body: 'c' },
  ];
  assert.equal(resolveCommandTarget({ type: 'last' }, notes).note?.id, 1);
  assert.equal(resolveCommandTarget({ type: 'date', date: '2026-10-20' }, notes).note?.id, 3);
  const none = resolveCommandTarget({ type: 'date', date: '2026-09-01' }, notes);
  assert.equal(none.note, null);
  assert.match(none.message, /01-09-2026/);
});

test('wordDiff marca lo cambiado', () => {
  const diff = wordDiff('pieza dos seis con caries oclusal', 'pieza 2.6 con caries oclusal');
  assert.deepEqual(diff, [
    { type: 'same', text: 'pieza' },
    { type: 'removed', text: 'dos seis' },
    { type: 'added', text: '2.6' },
    { type: 'same', text: 'con caries oclusal' },
  ]);
  assert.equal(changedWordCount(diff), 3);
  assert.deepEqual(wordDiff('igual', 'igual'), [{ type: 'same', text: 'igual' }]);
  assert.deepEqual(wordDiff('', 'nuevo texto'), [{ type: 'added', text: 'nuevo texto' }]);
});
