import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { appendToothHistory, toothHistorySnapshot } from '../app/odontogram-history.ts';
import { isCariesDepth } from '../lib/caries.ts';

const source = readFileSync(new URL('../app/mcp-tooth-surface.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup(initial, { concurrent = false, failVerify = false } = {}) {
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
    '@/lib/caries': { isCariesDepth },
    '@/db': { getDb: () => db },
    '@/db/schema': { toothStatuses: { patientId: 'patientId', ownerId: 'ownerId', data: 'data' } },
  };
  const exports = {};
  runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, Date, JSON, Object, Array, Number, Set });
  return { write: exports.persistMcpToothSurface, result: () => persisted, writes: () => writes };
}

test('guarda caries con profundidad, conserva piezas, historial y relee el resultado', async () => {
  const initial = { teeth: {}, surfaces: { 36: { M: { condition: 'sealant' } }, 46: { O: { condition: 'restored' } } }, missingReason: {}, crowns: {}, history: [{ id: 'previo' }], custom: 'conservar' };
  const s = setup(JSON.stringify(initial));
  const result = await s.write('owner-test', 1, 36, 'O', { condition: 'caries', depth: 'dentina_profunda' });
  const saved = JSON.parse(s.result());
  assert.equal(result.verified, true);
  assert.equal(saved.surfaces['36'].O.depth, 'dentina_profunda');
  assert.equal(saved.surfaces['36'].M.condition, 'sealant');
  assert.equal(saved.surfaces['46'].O.condition, 'restored');
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].surface, 'O');
  assert.equal(saved.history[1].after.surfaces.O.condition, 'caries');
  assert.equal(saved.custom, 'conservar');
});

test('restauración conserva material y tipo previos cuando no se vuelven a indicar', async () => {
  const s = setup(JSON.stringify({ teeth: {}, surfaces: { 36: { O: { condition: 'restored', restorationStage: 'definitive', restorationMaterial: 'Resina compuesta' } } }, missingReason: {}, crowns: {}, history: [] }));
  const result = await s.write('owner-test', 1, 36, 'O', { condition: 'restored' });
  assert.equal(result.verified, true);
  assert.equal(result.finding.restorationStage, 'definitive');
  assert.equal(result.finding.restorationMaterial, 'Resina compuesta');
});

test('caries nueva solo por profundidad; al actualizar conserva ICDAS y actividad anteriores', async () => {
  const s = setup(JSON.stringify({ teeth: {}, surfaces: { 36: { O: { condition: 'caries', icdas: 3, activity: 'active' } } }, missingReason: {}, crowns: {}, history: [] }));
  const result = await s.write('owner-test', 1, 36, 'O', { condition: 'caries', depth: 'dentina_profunda' });
  assert.equal(result.verified, true);
  assert.equal(result.finding.icdas, 3);
  assert.equal(result.finding.activity, 'active');
  assert.equal(result.finding.depth, 'dentina_profunda');
  const fresh = setup('{}');
  for (const input of [{ condition: 'caries', icdas: 3 }, { condition: 'caries', activity: 'active' }]) assert.equal((await fresh.write('owner-test', 1, 36, 'O', input)).saved, false);
  assert.equal(fresh.writes(), 0);
});

test('rechaza caries en pieza ausente o implante y rechaza datos inválidos', async () => {
  for (const status of ['Ausente', 'Implante', 'Implante con pilar']) {
    const s = setup(JSON.stringify({ teeth: { 36: status } }));
    const result = await s.write('owner-test', 1, 36, 'O', { condition: 'caries', depth: 'esmalte' });
    assert.equal(result.saved, false);
    assert.equal(s.writes(), 0);
  }
  const contradictory = setup(JSON.stringify({ teeth: { 36: 'Corona' }, crowns: { 36: { foundation: 'implant', material: 'Zirconio' } } }));
  assert.equal((await contradictory.write('owner-test', 1, 36, 'O', { condition: 'caries' })).saved, false);
  assert.equal(contradictory.writes(), 0);
  const s = setup('{}');
  for (const args of [[99, 'O', { condition: 'caries' }], [36, 'X', { condition: 'caries' }], [36, 'O', { condition: 'caries', depth: 'inventada' }], [36, 'O', { condition: 'restored', restorationMaterial: 'inventado' }]]) {
    assert.equal((await s.write('owner-test', 1, ...args)).saved, false);
  }
  assert.equal(s.writes(), 0);
});

test('rechaza registros corruptos o estados incompatibles sin sobrescribir', async () => {
  for (const data of ['{', JSON.stringify({ history: 'corrupto' }), JSON.stringify({ surfaces: { 36: 'corrupto' } }), JSON.stringify({ teeth: { 36: 'Corona' }, 36: 'Implante' })]) {
    const s = setup(data);
    assert.equal((await s.write('owner-test', 1, 36, 'O', { condition: 'caries' })).saved, false);
    assert.equal(s.writes(), 0);
  }
});

test('conflicto concurrente y fallo de relectura no se declaran guardado verificado', async () => {
  const concurrent = setup('{}', { concurrent: true });
  assert.equal((await concurrent.write('owner-test', 1, 36, 'O', { condition: 'caries' })).concurrentChange, true);
  assert.equal(concurrent.writes(), 0);
  const uncertain = setup('{}', { failVerify: true });
  const result = await uncertain.write('owner-test', 1, 36, 'O', { condition: 'caries' });
  assert.equal(result.saved, false);
  assert.equal(result.verificationFailed, true);
  assert.equal(uncertain.writes(), 1);
});
