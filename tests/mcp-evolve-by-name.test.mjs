import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bestStoredNameMatches, normalizePatientName, storedNameMatchScore } from '../app/patient-identity.ts';

const patientColumns = Object.fromEntries(['id', 'name', 'rut', 'birthDate', 'ownerId'].map(key => [key, `p.${key}`]));
const evolutionColumns = Object.fromEntries(['id', 'patientId', 'ownerId', 'clinicalDate', 'recordedAt', 'title', 'body', 'requestId', 'sourceDocumentId', 'backupStatus'].map(key => [key, `e.${key}`]));
const rows = [
  { id: 1, name: 'Paciente María Ejemplo Pérez', rut: null, birthDate: '1980-01-01', ownerId: 'owner' },
  { id: 2, name: 'Paciente María Ejemplo Pérez', rut: null, birthDate: '1990-01-01', ownerId: 'owner' },
];
const notes = [];
const matching = (row, condition) => condition.every(({ op, column, value }) => op === 'eq' ? row[column.split('.')[1]] === value : row[column.split('.')[1]] > value);
const project = (row, fields) => Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.split('.')[1]]]));
const db = {
  select(fields) {
    let table, conditions = [];
    const query = {
      from(value) { table = value; return query; },
      where(value) { conditions = value; return query; },
      orderBy() { return query; },
      async limit(count) { return (table === patientColumns ? rows : notes).filter(row => matching(row, conditions)).slice(0, count).map(row => project(row, fields)); },
    };
    return query;
  },
  insert(table) {
    let data;
    return {
      values(value) { data = value; return this; },
      async returning(fields) {
        assert.equal(table, evolutionColumns);
        const row = { id: notes.length + 1, ...data };
        notes.push(row);
        return [project(row, fields)];
      },
    };
  },
};
const source = readFileSync(new URL('../app/mcp/route.ts', import.meta.url), 'utf8') + '\nexport { evolvePatientByName };';
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
runInNewContext(compiled, {
  exports,
  require: name => ({
    'drizzle-orm': { eq: (column, value) => [{ op: 'eq', column, value }], gt: (column, value) => [{ op: 'gt', column, value }], and: (...parts) => parts.flat(), desc: value => value, inArray: () => [] },
    '@/app/clinical-import': { ClinicalImportError: class extends Error {}, runDriveRecordImport() {} },
    '@/app/drive-backup': { confirmDriveSnapshot() {}, getDriveSnapshot() {}, listDriveBackupQueue() {} },
    '@/app/sync-odontogram': { syncInstalledImplants: async () => ({ updatedTeeth: [] }) },
    '@/db': { getDb: () => db },
    '@/db/schema': { patients: patientColumns, evolutions: evolutionColumns },
    '@/app/patient-identity': { bestStoredNameMatches, hasFourNameParts: value => typeof value === 'string' && value.trim().split(/\s+/).filter(Boolean).length >= 4, normalizePatientName, storedNameMatchScore },
  })[name],
  crypto, TextEncoder, Intl, Date,
});

test('el nombre duplicado no escribe en ninguna ficha', async () => {
  const result = await exports.evolvePatientByName('owner', { name: 'Paciente María Ejemplo Pérez', body: 'Texto sintético.' });
  assert.equal(result.needsClarification, true);
  assert.equal(notes.length, 0);
});

test('un nombre que no alcanza a identificar la ficha no guarda', async () => {
  const result = await exports.evolvePatientByName('owner', { name: 'Paciente María Ejemplo', birthDate: '1990-01-01', body: 'Texto sintético.' });
  assert.equal(result.found, false);
  assert.equal(notes.length, 0);
});

test('el identificador resuelve el homónimo, guarda una vez y verifica contenido', async () => {
  const args = { name: 'Paciente María Ejemplo Pérez', birthDate: '1990-01-01', clinicalDate: '2026-10-20', identityBirthDate: '1990-01-01', title: 'Control', body: 'Texto sintético.', requestId: 'solicitud-sintetica' };
  const first = await exports.evolvePatientByName('owner', args);
  assert.equal(first.saved, true);
  assert.equal(first.verified, true);
  assert.equal(first.evolution.body, args.body);
  assert.equal(first.evolution.patientId, 2);
  const retry = await exports.evolvePatientByName('owner', args);
  assert.equal(retry.alreadySaved, true);
  assert.equal(retry.verified, true);
  assert.equal(notes.length, 1);
});

test('una ficha antigua con tres componentes se resuelve con el nombre dictado más completo y fecha de nacimiento', async () => {
  rows.splice(0, rows.length, { id: 3, name: 'Paciente Ficticia Demo', rut: null, birthDate: '1970-01-01', ownerId: 'owner' });
  const result = await exports.evolvePatientByName('owner', {
    name: 'Paciente Prueba Ficticia Demo',
    birthDate: '1970-01-01',
    clinicalDate: '2026-10-20',
    identityBirthDate: '1970-01-01',
    title: 'Control',
    body: 'Texto sintético.',
    requestId: 'nombre-incompleto-sintetico',
  });
  assert.equal(result.saved, true);
  assert.equal(result.verified, true);
  assert.equal(result.patient.name, 'Paciente Ficticia Demo');
  assert.equal(notes.at(-1).patientId, 3);
});

test('una ficha existente con nombre incompleto se guarda cuando la coincidencia es única', async () => {
  rows.splice(0, rows.length, { id: 4, name: 'Paciente Demo', rut: null, birthDate: '1970-01-01', ownerId: 'owner' });
  const base = { name: 'Paciente Prueba Ficticia Demo', clinicalDate: '2026-10-20', title: 'Control', body: 'Texto sintético.' };
  const result = await exports.evolvePatientByName('owner', base);
  assert.equal(result.verified, true);
  assert.equal(result.patient.name, 'Paciente Demo');
  assert.equal(notes.at(-1).patientId, 4);
});

test('los homónimos con nombre incompleto siguen requiriendo identificador', async () => {
  rows.splice(0, rows.length,
    { id: 4, name: 'Paciente Demo', rut: null, birthDate: '1970-01-01', ownerId: 'owner' },
    { id: 5, name: 'Paciente Demo', rut: null, birthDate: '1980-01-01', ownerId: 'owner' },
  );
  const base = { name: 'Paciente Prueba Ficticia Demo', clinicalDate: '2026-10-20', title: 'Control', body: 'Texto sintético.' };
  const savedBefore = notes.length;
  const unresolved = await exports.evolvePatientByName('owner', base);
  assert.equal(unresolved.needsClarification, true);
  assert.equal(notes.length, savedBefore);
  const resolved = await exports.evolvePatientByName('owner', { ...base, birthDate: '1970-01-01' });
  assert.equal(resolved.verified, true);
  assert.equal(notes.at(-1).patientId, 4);
});
