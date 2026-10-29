import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bestStoredNameMatches, normalizePatientName, storedNameMatchScore } from '../app/patient-identity.ts';

const source = readFileSync(new URL('../app/mcp/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const patients = Object.fromEntries(
  ['id', 'name', 'birthDate', 'rut', 'phone', 'email', 'reason', 'status', 'driveFolderId', 'ownerId', 'updatedAt'].map(key => [key, key]),
);

function createHandler(record, duplicates = []) {
  const records = [record, ...duplicates];
  const eq = (column, value) => ({ column, value });
  const ne = (column, value) => ({ column, value, notEqual: true });
  const and = (...conditions) => conditions.flat();
  const matches = (target, conditions) => conditions.every(({ column, value, notEqual }) => notEqual ? target[column] !== value : target[column] === value);
  const getDb = () => ({
    select: fields => ({
      from: () => ({
        where: conditions => ({
          limit: async () => records.filter(target => matches(target, conditions)).map(target => Object.fromEntries(Object.entries(fields).map(([key]) => [key, target[key]]))),
        }),
      }),
    }),
    update: () => ({
      set: changes => ({
        where: async conditions => {
          if (matches(record, conditions)) Object.assign(record, changes);
        },
      }),
    }),
  });

  const exports = {};
  const imports = {
    'drizzle-orm': { and, desc: () => null, eq, ne, gt: () => null, inArray: () => null },
    '@/app/clinical-import': { ClinicalImportError: class ClinicalImportError extends Error {}, runDriveRecordImport: async () => ({}) },
    '@/app/drive-backup': { confirmDriveSnapshot: async () => ({}), getDriveSnapshot: async () => ({}), listDriveBackupQueue: async () => ({}) },
    '@/app/sync-odontogram': { syncInstalledImplants: async () => ({ updatedTeeth: [] }) },
    '@/app/patient-identity': { bestStoredNameMatches, hasFourNameParts: value => typeof value === 'string' && value.trim().split(/\s+/).filter(Boolean).length >= 4, normalizePatientName, storedNameMatchScore },
    '@/db': { getDb },
    '@/db/schema': { patients, evolutions: {}, toothStatuses: {} },
  };
  runInNewContext(compiled, {
    exports,
    require: name => imports[name],
    Request,
    Response,
    URL,
    TextEncoder,
    crypto,
    Intl,
    Date,
  });
  return exports.POST;
}

async function call(post, args, ownerId = 'owner-1') {
  const response = await post(new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': ownerId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_patient_contact', arguments: args } }),
  }));
  return response.json();
}

test('actualiza solo los datos de contacto entregados y relee la ficha del propietario', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1980-01-01', phone: '', email: 'vigente@example.test', updatedAt: '' };
  const result = await call(createHandler(patient), { patientId: 8, fullName: 'Paciente María de Prueba', identityBirthDate: '1980-01-01', phone: '+56 96963089', confirmed: true });

  assert.equal(result.result.structuredContent.saved, true);
  assert.equal(result.result.structuredContent.verified, true);
  assert.equal(patient.phone, '+56 96963089');
  assert.equal(patient.email, 'vigente@example.test');
});

test('rechaza un nombre completo que no coincide con la ficha', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', phone: '', email: '', updatedAt: '' };
  const result = await call(createHandler(patient), { patientId: 8, fullName: 'Otra Persona Pérez Rojas', identityBirthDate: '1980-01-01', phone: '+56 96963089', confirmed: true });
  assert.equal(result.result.structuredContent.identityMismatch, true);
  assert.equal(patient.phone, '');
});

test('detiene la escritura ante homónimos hasta distinguir la ficha', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1980-01-01', phone: '', email: '', updatedAt: '' };
  const homonym = { id: 9, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1990-01-01', phone: '', email: '', updatedAt: '' };
  const result = await call(createHandler(patient, [homonym]), { patientId: 8, fullName: 'Paciente María de Prueba', phone: '+56 96963089', confirmed: true });
  assert.equal(result.result.structuredContent.needsClarification, true);
  assert.equal(patient.phone, '');
});

test('fecha de nacimiento resuelve un homónimo antes de actualizar', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1980-01-01', phone: '', email: '', updatedAt: '' };
  const homonym = { id: 9, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1990-01-01', phone: '', email: '', updatedAt: '' };
  const result = await call(createHandler(patient, [homonym]), { patientId: 8, fullName: 'Paciente María de Prueba', identityBirthDate: '1980-01-01', phone: '+56 96963089', confirmed: true });
  assert.equal(result.result.structuredContent.saved, true);
  assert.equal(patient.phone, '+56 96963089');
  assert.equal(homonym.phone, '');
});

test('actualiza y verifica RUN / RUT y correo sin modificar teléfono omitido', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', birthDate: '1980-01-01', rut: '', phone: '+56 900000000', email: '', updatedAt: '' };
  const result = await call(createHandler(patient), { patientId: 8, fullName: 'Paciente María de Prueba', identityBirthDate: '1980-01-01', rut: '12.345.678-5', email: 'test@example.test', confirmed: true });

  assert.equal(result.result.structuredContent.saved, true);
  assert.equal(result.result.structuredContent.patient.rut, '123456785');
  assert.equal(result.result.structuredContent.patient.email, 'test@example.test');
  assert.equal(patient.phone, '+56 900000000');
});

test('no escribe si falta la confirmación expresa', async () => {
  const patient = { id: 8, ownerId: 'owner-1', name: 'Paciente María de Prueba', phone: '', email: '', updatedAt: '' };
  const result = await call(createHandler(patient), { patientId: 8, fullName: 'Paciente María de Prueba', identityBirthDate: '1980-01-01', phone: '+56 96963089', confirmed: false });

  assert.equal(result.result.structuredContent.saved, false);
  assert.equal(result.result.structuredContent.needsConfirmation, true);
  assert.equal(patient.phone, '');
});

test('no actualiza una ficha que pertenece a otro propietario', async () => {
  const patient = { id: 8, ownerId: 'owner-2', name: 'Paciente María de Prueba', phone: '', email: '', updatedAt: '' };
  const result = await call(createHandler(patient), { patientId: 8, fullName: 'Paciente María de Prueba', identityBirthDate: '1980-01-01', phone: '+56 96963089', confirmed: true }, 'owner-1');

  assert.equal(result.result.structuredContent.saved, false);
  assert.equal(patient.phone, '');
});
