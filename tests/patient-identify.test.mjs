import test from 'node:test';
import assert from 'node:assert/strict';
import { runPatientIdentifyEval } from '../scripts/patient-identify-eval.mjs';
import { decidePatient, extractIdentity, nameSimilarity } from '../lib/dictation/patient-identify.ts';
import { normalizeIdentityNumbers } from '../lib/dictation/identity-numbers.ts';

test('corpus de identificación: paciente nuevo vs existente', () => {
  const { rows } = runPatientIdentifyEval();
  for (const row of rows) assert.deepEqual(row.diffs, [], row.item.id);
});

test('el RUT manda sobre el nombre y nunca se propone duplicar una ficha', () => {
  const patients = [{ id: 7, name: 'Ana María Soto Lara', rut: '12.345.678-5' }];
  const result = decidePatient('paciente nuevo Pedro Rojas RUT 12345678-5', patients);
  assert.equal(result.decision, 'existing');
  assert.equal(result.suggestedPatientId, 7);
  assert.match(result.explanation, /no coincide|ya es de/);
});

test('sin pacientes cargados, un nombre dictado propone crear la ficha', () => {
  const result = decidePatient('paciente Luisa Andrea Reyes Pino, dolor en la 1.1', []);
  assert.equal(result.decision, 'new');
  assert.equal(result.identity.name, 'Luisa Andrea Reyes Pino');
});

test('parecido de nombre tolera una letra mal oída', () => {
  assert.equal(nameSimilarity('Juan Peres', 'Juan Andrés Pérez Soto'), 1);
  assert.equal(nameSimilarity('Pedro', 'Juan Andrés Pérez Soto'), 0);
});

test('convierte RUN hablado y fecha de nacimiento hablada para la identificación', () => {
  const transcript = 'RUN ocho millones cero treinta y uno cuatrocientos quince guion nueve. Fecha de nacimiento el veintitrés 23 de mayo de mil novecientos ochenta y cuatro.';
  const normalized = normalizeIdentityNumbers(transcript);
  assert.equal(normalized.text, 'RUN 8.031.415-9. Fecha de nacimiento el 23/05/1984.');
  assert.equal(normalized.corrections.length, 2);

  const identity = extractIdentity(transcript);
  assert.equal(identity.rut, '8.031.415-9');
  assert.equal(identity.rutValid, true);
  assert.equal(identity.birthDate, '1984-05-23');
});

test('no adivina un RUN/RUT ni fecha de nacimiento incompletos', () => {
  const transcript = 'RUN cerca de ocho millones guion nueve. Fecha de nacimiento probablemente en mil novecientos ochenta.';
  assert.equal(normalizeIdentityNumbers(transcript).text, transcript);
});
