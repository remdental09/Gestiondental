import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { appendToothHistory, toothHistorySnapshot } from '../app/odontogram-history.ts';

const source = readFileSync(new URL('../app/mcp-tooth-status.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup(initial, failVerify = false, concurrent = false) {
  let persisted = initial, writes = 0;
  const save = async row => { if (concurrent) return []; persisted = row.data; writes++; return [{ patientId: 1 }]; };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => persisted === null ? [] : [{ data: failVerify && writes ? '{}' : persisted }] }) }) }),
    insert: () => ({ values: row => ({ onConflictDoNothing: () => ({ returning: () => save(row) }) }) }),
    update: () => ({ set: row => ({ where: () => ({ returning: () => save(row) }) }) }),
  };
  const imports = {
    'drizzle-orm': { eq: (...args) => args, and: (...args) => args },
    '@/app/clinical-data': { formatFdi: tooth => `${Math.floor(tooth / 10)}.${tooth % 10}` },
    '@/app/odontogram-history': { appendToothHistory, toothHistorySnapshot },
    '@/db': { getDb: () => db },
    '@/db/schema': { toothStatuses: { patientId: 'patientId', ownerId: 'ownerId', data: 'data' } },
  };
  const exports = {};
  runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, Date, JSON, Object, Array, Number });
  return { write: exports.persistMcpToothStatus, result: () => persisted, writes: () => writes };
}

test('reafirmar implante conserva corona, superficies, historial y campos ajenos', async () => {
  const initial = { teeth: { 36: 'Implante' }, surfaces: { 24: { O: { condition: 'caries' } } }, missingReason: {}, crowns: { 36: { foundation: 'implant', material: 'Zirconio' } }, history: [{ id: 'previo', tooth: 36 }], custom: { version: 1 } };
  const s = setup(JSON.stringify(initial));
  const result = await s.write('owner-test', 1, 36, 'Implante');
  assert.equal(result.verified, true);
  assert.deepEqual(JSON.parse(s.result()), initial);
});

test('corregir soporte a corona registra transición y preserva los demás datos', async () => {
  const initial = { teeth: { 45: 'Implante' }, surfaces: {}, missingReason: {}, crowns: { 45: { foundation: 'implant', material: 'Zirconio' } }, history: [{ id: 'previo', tooth: 45 }], custom: 'conservar' };
  const s = setup(JSON.stringify(initial));
  const result = await s.write('owner-test', 1, 45, 'Corona');
  const saved = JSON.parse(s.result());
  assert.equal(result.verified, true);
  assert.equal(saved.teeth['45'], 'Corona');
  assert.equal(saved.crowns['45'].foundation, 'tooth');
  assert.equal(saved.crowns['45'].material, 'Zirconio');
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].before.status, 'Implante');
  assert.equal(saved.history[1].after.status, 'Corona');
  assert.equal(saved.custom, 'conservar');
});

test('sin hallazgos elimina también estado legado para impedir que reaparezca', async () => {
  const s = setup(JSON.stringify({ 36: 'Corona', teeth: {}, surfaces: {}, crowns: {}, missingReason: {}, history: [] }));
  await s.write('owner-test', 1, 36, 'Sin hallazgos');
  const saved = JSON.parse(s.result());
  assert.equal(saved['36'], undefined);
  assert.equal(saved.teeth['36'], undefined);
  assert.equal(saved.history[0].before.status, 'Corona');
});

test('JSON inválido no se sobrescribe y fallo de relectura no se declara verificado', async () => {
  const bad = setup('{');
  const rejected = await bad.write('owner-test', 1, 36, 'Corona');
  assert.equal(rejected.saved, false);
  assert.equal(bad.writes(), 0);
  const uncertain = setup('{}', true);
  const result = await uncertain.write('owner-test', 1, 36, 'Corona');
  assert.equal(result.saved, false);
  assert.equal(result.verificationFailed, true);
  assert.equal(uncertain.writes(), 1);
});

test('datos estructurados inválidos se conservan sin sobrescribir', async () => {
  for (const data of [{ history: 'corrupto' }, { surfaces: 'corrupto' }, { crowns: { 36: 'corrupto' } }]) {
    const s = setup(JSON.stringify(data));
    const result = await s.write('owner-test', 1, 36, 'Corona');
    assert.equal(result.saved, false);
    assert.equal(s.writes(), 0);
  }
});

test('si otra sesión modificó el odontograma se rechaza la escritura', async () => {
  const s = setup('{"teeth":{}}', false, true);
  const result = await s.write('owner-test', 1, 36, 'Corona');
  assert.equal(result.saved, false);
  assert.equal(result.concurrentChange, true);
  assert.equal(s.writes(), 0);
});
