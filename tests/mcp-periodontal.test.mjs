import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/mcp-periodontal.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const patients = { id: 'id', name: 'name', ownerId: 'ownerId' };
const periodontalExams = { id: 'id', ownerId: 'ownerId', patientId: 'patientId', teeth: 'teeth', recordedAt: 'recordedAt' };
const scenario = () => ({ confirmed: true, patientId: 7, fullName: 'Paciente Sintetico Uno Dos', teeth: { 36: { sites: { MV: { depth: 4, margin: null, bleeding: true, suppuration: false }, DV: { depth: 6, margin: 1, bleeding: true, suppuration: true } }, mobility: 'I' } }, epb: { 4: '3' } });

function harness({ corruptRead = false } = {}) {
  const records = [{ id: 7, ownerId: 'owner-a', name: 'Paciente Sintetico Uno Dos' }], exams = [];
  const eq = (field, value) => ({ field, value });
  const and = (...conditions) => conditions;
  const db = {
    select: fields => ({ from: table => ({ where: conditions => ({ limit: async () => {
      const rows = table === patients ? records : exams;
      return rows.filter(row => conditions.every(({ field, value }) => row[field] === value)).map(row => Object.fromEntries(Object.entries(fields).map(([alias, field]) => [alias, corruptRead && table === periodontalExams && field === 'teeth' ? '{}' : row[field]])));
    } }) }) }),
    insert: table => ({ values: row => ({ returning: async () => { assert.equal(table, periodontalExams); const exam = { ...row, id: exams.length + 1 }; exams.push(exam); return [{ id: exam.id }]; } }) }),
  };
  const exported = {};
  const imports = { 'drizzle-orm': { and, eq }, '@/db': { getDb: () => db }, '@/db/schema': { patients, periodontalExams } };
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Date, JSON, Number, Object, Array, String });
  return { ...exported, exams };
}

test('guarda y relee la instantánea exacta del propietario sin inventar mediciones o diagnóstico', async () => {
  const h = harness(), input = scenario();
  const result = await h.savePeriodontalExam('owner-a', input, async () => null);
  assert.equal(result.saved, true);
  assert.equal(result.verified, true);
  assert.equal(h.exams.length, 1);
  assert.deepEqual(JSON.parse(h.exams[0].teeth), { teeth: input.teeth, epb: input.epb });
  assert.equal('classification' in result.exam, false);
});

test('requiere confirmación e identidad y no escribe una ficha de otro propietario', async () => {
  const h = harness();
  assert.equal((await h.savePeriodontalExam('owner-a', { ...scenario(), confirmed: false }, async () => null)).needsConfirmation, true);
  assert.equal((await h.savePeriodontalExam('owner-b', scenario(), async () => null)).saved, false);
  assert.equal((await h.savePeriodontalExam('owner-a', scenario(), async () => ({ identityMismatch: true }))).identityMismatch, true);
  assert.equal(h.exams.length, 0);
});

test('rechaza datos inválidos o inventados antes de escribir', async () => {
  const h = harness();
  for (const teeth of [{ 36: { sites: { X: { depth: 4, margin: null, bleeding: false, suppuration: false } } } }, { 36: { sites: { MV: { depth: 21, margin: null, bleeding: false, suppuration: false } } } }, { 36: { diagnosis: 'Periodontitis' } }, { 99: { sites: {} } }, { 36: { sites: {}, mobility: '' } }]) {
    assert.equal((await h.savePeriodontalExam('owner-a', { ...scenario(), teeth }, async () => null)).saved, false);
  }
  assert.equal((await h.savePeriodontalExam('owner-a', { ...scenario(), teeth: {}, epb: {} }, async () => null)).saved, false);
  assert.equal((await h.savePeriodontalExam('owner-a', { ...scenario(), teeth: {}, epb: {}, classification: { system: 'AAP-EFP 2017' } }, async () => null)).saved, false);
  assert.equal((await h.savePeriodontalExam('owner-a', { ...scenario(), teeth: { 36: { sites: { MV: { depth: 4, margin: null } } } } }, async () => null)).saved, false, 'el sangrado y la supuración desconocidos no se convierten a false');
  assert.equal(h.exams.length, 0);
});

test('dos exámenes idénticos autorizados se guardan como dos exámenes independientes', async () => {
  const h = harness();
  assert.equal((await h.savePeriodontalExam('owner-a', scenario(), async () => null)).saved, true);
  assert.equal((await h.savePeriodontalExam('owner-a', scenario(), async () => null)).saved, true);
  assert.equal(h.exams.length, 2);
});

test('si la relectura difiere no declara éxito ni vuelve a escribir', async () => {
  const h = harness({ corruptRead: true });
  const result = await h.savePeriodontalExam('owner-a', scenario(), async () => null);
  assert.equal(result.saved, false);
  assert.equal(result.verificationFailed, true);
  assert.equal(h.exams.length, 1);
  assert.match(result.message, /antes de reintentar/);
});
