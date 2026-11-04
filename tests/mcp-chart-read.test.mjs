import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/mcp-chart-read.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const patients = { id: 'id', ownerId: 'ownerId', name: 'name' };
const toothStatuses = { patientId: 'patientId', ownerId: 'ownerId', data: 'data', updatedAt: 'updatedAt' };
const periodontalExams = { id: 'id', patientId: 'patientId', ownerId: 'ownerId', teeth: 'teeth', recordedAt: 'recordedAt' };

function harness({ chart = JSON.stringify({ teeth: { 36: 'Corona' }, history: [{ title: 'corrección' }] }), exam = JSON.stringify({ teeth: { 36: { sites: {} } }, epb: { 4: '2' } }) } = {}) {
  const records = new Map([
    [patients, [{ id: 7, ownerId: 'owner-a', name: 'Paciente Sintético Uno Dos' }, { id: 8, ownerId: 'owner-b', name: 'Otro Paciente Ficticio Uno' }]],
    [toothStatuses, [{ patientId: 7, ownerId: 'owner-a', data: chart, updatedAt: '2026-01-01' }, { patientId: 8, ownerId: 'owner-b', data: '{}', updatedAt: '2026-01-01' }]],
    [periodontalExams, [{ id: 1, patientId: 7, ownerId: 'owner-a', teeth: exam, recordedAt: '2026-01-02' }, { id: 2, patientId: 8, ownerId: 'owner-b', teeth: '{}', recordedAt: '2026-01-02' }]],
  ]);
  const db = { select: fields => ({ from: table => ({ where: conditions => {
    const query = { orderBy: () => query, limit: async n => records.get(table).filter(row => conditions.every(c => row[c.key] === c.value)).slice(0, n).map(row => Object.fromEntries(Object.entries(fields).map(([alias, field]) => [alias, row[field]]))) };
    return query;
  } }) }) };
  const imports = { 'drizzle-orm': { and: (...conditions) => conditions, eq: (key, value) => ({ key, value }), desc: value => value }, '@/db': { getDb: () => db }, '@/db/schema': { patients, toothStatuses, periodontalExams } };
  const exported = {};
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Number, JSON, Object, Array, Promise });
  return exported.readDentalChart;
}

test('relee odontograma con historial y periodontograma del propietario', async () => {
  const result = await harness()('owner-a', 7);
  assert.equal(result.found, true);
  assert.equal(result.odontogram.teeth['36'], 'Corona');
  assert.equal(result.odontogram.history[0].title, 'corrección');
  assert.equal(result.periodontalExams[0].epb['4'], '2');
  assert.equal(result.periodontalExams.length, 1);
});

test('rechaza IDs inválidos y no expone fichas de otro propietario', async () => {
  const read = harness();
  assert.equal((await read('owner-a', 0)).found, false);
  const result = await read('owner-b', 7);
  assert.equal(result.found, false);
  assert.equal('odontogram' in result, false);
});

test('muestra exámenes anteriores sin contenedor teeth como mapa de piezas', async () => {
  const result = await harness({ exam: JSON.stringify({ 36: { sites: { MV: { depth: 4 } } } }) })('owner-a', 7);
  assert.equal(result.periodontalExams[0].teeth['36'].sites.MV.depth, 4);
});

test('datos corruptos detienen la lectura sin presentarlos como ficha vacía', async () => {
  for (const config of [{ chart: '{' }, { chart: JSON.stringify({ history: {} }) }, { exam: '{' }, { exam: JSON.stringify({ teeth: null }) }]) {
    const result = await harness(config)('owner-a', 7);
    assert.equal(result.found, false);
    assert.equal(result.readError, true);
    assert.equal('odontogram' in result, false);
  }
});
