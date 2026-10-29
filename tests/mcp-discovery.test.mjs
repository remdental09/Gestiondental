import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/mcp/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const patientColumns = Object.fromEntries(
  ['id', 'name', 'birthDate', 'rut', 'reason', 'status', 'driveFolderId'].map(key => [key, key]),
);
const imports = {
  'drizzle-orm': {},
  '@/app/clinical-import': { ClinicalImportError: class ClinicalImportError extends Error {}, runDriveRecordImport: () => { throw new Error('Unexpected import'); } },
  '@/app/drive-backup': { confirmDriveSnapshot() {}, getDriveSnapshot() {}, listDriveBackupQueue() {} },
  '@/app/sync-odontogram': { syncInstalledImplants: async () => ({ updatedTeeth: [] }) },
  '@/app/patient-identity': { hasFourNameParts: value => typeof value === 'string' && value.trim().split(/\s+/).filter(Boolean).length >= 4, fullNameRequiredMessage: () => 'Completa los dos nombres y los dos apellidos del paciente antes de guardar.' },
  '@/db': { getDb: () => { throw new Error('Unexpected database access'); } },
  '@/db/schema': { patients: patientColumns, evolutions: {} },
};
runInNewContext(compiled, {
  exports,
  require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  },
  Request,
  Response,
  URL,
  TextEncoder,
  crypto,
  Intl,
  Date,
  console,
});

async function call(method, params) {
  const response = await exports.POST(new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, ...(params ? { params } : {}) }),
  }));
  return response.json();
}

test('permite descubrir herramientas sin identidad de paciente', async () => {
  const discovery = await call('server/discover');
  assert.deepEqual(Array.from(discovery.result.supportedVersions), ['2026-07-28']);
  const list = await call('tools/list');
  assert.ok(list.result.tools.some(tool => tool.name === 'append_clinical_evolution'));
  const contact = list.result.tools.find(tool => tool.name === 'update_patient_contact');
  assert.ok(contact);
  assert.deepEqual(Array.from(contact.inputSchema.required), ['patientId', 'fullName', 'confirmed']);
  const evolution = list.result.tools.find(tool => tool.name === 'append_clinical_evolution');
  assert.ok(evolution.inputSchema.required.includes('fullName'));
  const byName = list.result.tools.find(tool => tool.name === 'evolve_patient_by_name');
  assert.deepEqual(Array.from(byName.inputSchema.required), ['name', 'body']);
});

test('rechaza llamadas clínicas sin identidad autenticada', async () => {
  const result = await call('tools/call', { name: 'append_clinical_evolution', arguments: { patientId: 999999, body: 'Texto sintético.', confirmed: true } });
  assert.equal(result.error.code, -32001);
});
