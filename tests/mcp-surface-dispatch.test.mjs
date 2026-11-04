import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bestStoredNameMatches, normalizePatientName, storedNameMatchScore } from '../app/patient-identity.ts';

const source = readFileSync(new URL('../app/mcp/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const patients = Object.fromEntries(['id', 'name', 'ownerId', 'rut', 'birthDate', 'phone', 'email', 'reason', 'status', 'driveFolderId'].map(key => [key, key]));
const patient = { id: 12, name: 'Persona Sintética Ejemplo Prueba', ownerId: 'owner-a', rut: '', birthDate: '' };

function handler() {
  const writes = [];
  const eq = (column, value) => ({ column, value });
  const db = { select: fields => ({ from: () => ({ where: conditions => ({ limit: async () => {
    if (!conditions.every(({ column, value }) => patient[column] === value)) return [];
    return [Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, patient[column]]))];
  } }) }) }) };
  const imports = {
    'drizzle-orm': { and: (...conditions) => conditions, eq },
    '@/app/mcp-chart-read': { readDentalChart() {} },
    '@/app/mcp-periodontal': { periodontalExamTool: { name: 'save_periodontal_exam' }, savePeriodontalExam() {} },
    '@/app/mcp-tooth-status': { persistMcpToothStatus() {} },
    '@/app/mcp-tooth-surface': { persistMcpToothSurface: async (...args) => { writes.push(args); return { saved: true, verified: true }; } },
    '@/app/clinical-import': { ClinicalImportError: class extends Error {}, runDriveRecordImport() {} },
    '@/app/drive-backup': { confirmDriveSnapshot() {}, getDriveSnapshot() {}, listDriveBackupQueue() {} },
    '@/app/sync-odontogram': { syncInstalledImplants() {} },
    '@/app/patient-identity': { bestStoredNameMatches, normalizePatientName, storedNameMatchScore },
    '@/db': { getDb: () => db },
    '@/db/schema': { patients, evolutions: {}, calendarEvents: {} },
  };
  const exported = {};
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Request, Response, URL, TextEncoder, crypto, Intl, Date });
  const call = async (args, owner = 'owner-a') => {
    const response = await exported.POST(new Request('https://example.test/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(owner ? { 'oai-authenticated-user-id': owner } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_tooth_surface', arguments: args } }),
    }));
    return response.json();
  };
  return { call, writes };
}

const valid = { patientId: 12, fullName: patient.name, toothFDI: 36, surface: 'O', finding: { condition: 'caries', depth: 'dentina_profunda' }, confirmed: true };

test('la escritura de superficie exige identidad autenticada y confirmación', async () => {
  const h = handler();
  assert.equal((await h.call(valid, '')).error.code, -32001);
  assert.equal((await h.call({ ...valid, confirmed: false })).result.structuredContent.needsConfirmation, true);
  assert.equal(h.writes.length, 0);
});

test('rechaza otra ficha, otro propietario, datos inválidos y registros ICDAS nuevos', async () => {
  const h = handler();
  for (const [args, owner] of [[valid, 'owner-b'], [{ ...valid, fullName: 'Otra Persona Ficticia Prueba' }, 'owner-a'], [{ ...valid, toothFDI: 99 }, 'owner-a'], [{ ...valid, surface: 'X' }, 'owner-a'], [{ ...valid, finding: { ...valid.finding, icdas: 5 } }, 'owner-a']]) {
    assert.equal((await h.call(args, owner)).result.structuredContent.saved, false);
  }
  assert.equal(h.writes.length, 0);
});

test('pasa a persistencia solo la pieza, cara y hallazgo de la ficha verificada', async () => {
  const h = handler();
  assert.equal((await h.call(valid)).result.structuredContent.verified, true);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].slice(0, 4), ['owner-a', 12, 36, 'O']);
  assert.equal(h.writes[0][4].depth, 'dentina_profunda');
});
