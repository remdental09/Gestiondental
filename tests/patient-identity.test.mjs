import test from 'node:test';
import assert from 'node:assert/strict';
import { bestStoredNameMatches, hasFourNameParts, fullNameRequiredMessage, storedNameMatchScore } from '../app/patient-identity.ts';

test('exige al menos cuatro componentes de nombre sin inferirlos', () => {
  assert.equal(hasFourNameParts('Paciente Ficticia Demo'), false);
  assert.equal(hasFourNameParts('Paciente Prueba Ficticia Demo'), true);
  assert.equal(hasFourNameParts('  Ana   María Pérez de la Cruz  '), true);
  assert.equal(hasFourNameParts('Ana 123 Pérez Rojas'), false);
  assert.match(fullNameRequiredMessage(), /dos nombres y los dos apellidos/i);
});

test('acepta como mejor coincidencia una ficha cuyo nombre guardado tiene menos componentes', () => {
  assert.equal(storedNameMatchScore('Paciente Prueba Ficticia Demo', 'Paciente Ficticia Demo'), 3);
  assert.equal(storedNameMatchScore('Paciente Prueba Ficticia Demo', 'Paciente Prueba Ficticia Demo'), 4);
  assert.equal(storedNameMatchScore('Paciente Prueba Ficticia Demo', 'Paciente Rojas'), 0);
  const matches = bestStoredNameMatches('Paciente Prueba Ficticia Demo', [
    { id: 1, name: 'Paciente Ficticia Demo' },
    { id: 2, name: 'Paciente Prueba Ficticia Demo' },
    { id: 3, name: 'Paciente Rojas' },
  ]);
  assert.deepEqual(matches.map(patient => patient.id), [2]);
});
