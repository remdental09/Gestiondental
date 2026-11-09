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
  '@/app/mcp-chart-read': { readDentalChart: async (owner, patientId) => ({ owner, patientId, found: true }) },
  '@/app/mcp-periodontal': { periodontalExamTool: { name: 'save_periodontal_exam' }, savePeriodontalExam: async (owner, args, verify) => ({ owner, patientId: args.patientId, hasIdentityCheck: typeof verify === 'function' }) },
  '@/app/mcp-tooth-status': { persistMcpToothStatus() {} },
  '@/app/mcp-tooth-surface': { persistMcpToothSurface() {} },
  '@/app/clinical-data': { formatFdi: tooth => String(tooth) },
  '@/app/clinical-import': { ClinicalImportError: class ClinicalImportError extends Error {}, runDriveRecordImport: () => { throw new Error('Unexpected import'); } },
  '@/app/drive-backup': { confirmDriveSnapshot() {}, getDriveSnapshot() {}, listDriveBackupQueue() {} },
  '@/app/sync-odontogram': { syncInstalledImplants: async () => ({ updatedTeeth: [] }) },
  '@/app/patient-identity': { hasFourNameParts: value => typeof value === 'string' && value.trim().split(/\s+/).filter(Boolean).length >= 3, fullNameRequiredMessage: () => 'Completa los dos nombres y los dos apellidos del paciente antes de guardar.' },
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
  assert.ok(list.result.tools.some(tool => tool.name === 'get_dental_chart' && tool.annotations.readOnlyHint));
  assert.ok(list.result.tools.some(tool => tool.name === 'save_periodontal_exam' && !tool.annotations.readOnlyHint));
  assert.ok(list.result.tools.some(tool => tool.name === 'set_tooth_surface' && !tool.annotations.readOnlyHint));
  const contact = list.result.tools.find(tool => tool.name === 'update_patient_contact');
  assert.ok(contact);
  assert.deepEqual(Array.from(contact.inputSchema.required), ['patientId', 'fullName', 'confirmed']);
  const evolution = list.result.tools.find(tool => tool.name === 'append_clinical_evolution');
  assert.ok(evolution.inputSchema.required.includes('fullName'));
  const byName = list.result.tools.find(tool => tool.name === 'evolve_patient_by_name');
  assert.deepEqual(Array.from(byName.inputSchema.required), ['name', 'body']);
});

test('negocia la versión MCP y expone capacidades en initialize', async () => {
  const result = await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
  assert.equal(result.result.protocolVersion, '2025-03-26');
  assert.equal(result.result.serverInfo.name, 'gestion-dental');
  assert.equal(result.result.capabilities.tools.listChanged, false);
  const fallback = await call('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
  assert.equal(fallback.result.protocolVersion, '2025-06-18');
  const invalid = await call('initialize', {});
  assert.equal(invalid.error.code, -32600);
});

test('acepta la notificación initialized sin responder JSON-RPC', async () => {
  const response = await exports.POST(new Request('https://example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
  const invalid = await call('notifications/initialized');
  assert.equal(invalid.error.code, -32600);
});

test('rechaza llamadas clínicas sin identidad autenticada', async () => {
  const result = await call('tools/call', { name: 'append_clinical_evolution', arguments: { patientId: 999999, body: 'Texto sintético.', confirmed: true } });
  assert.equal(result.error.code, -32001);
  for (const name of ['get_dental_chart', 'save_periodontal_exam', 'set_tooth_surface']) {
    const blocked = await call('tools/call', { name, arguments: { patientId: 1 } });
    assert.equal(blocked.error.code, -32001);
  }
});

test('dirige lectura y escritura periodontal al propietario autenticado', async () => {
  for (const name of ['get_dental_chart', 'save_periodontal_exam']) {
    const response = await exports.POST(new Request('https://example.test/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'owner-sintetico' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name, arguments: { patientId: 12 } } }),
    }));
    const data = await response.json();
    assert.equal(data.result.structuredContent.owner, 'owner-sintetico');
    assert.equal(data.result.structuredContent.patientId, 12);
    if (name === 'save_periodontal_exam') assert.equal(data.result.structuredContent.hasIdentityCheck, true);
  }
});
