import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('migración 0006: solo ALTER ADD', () => {
  const sql = read('drizzle/0006_evolution_annulment.sql');
  for (const col of ['status', 'annulled_at', 'annulled_by', 'annul_reason', 'replaces_id']) assert.match(sql, new RegExp('ADD `' + col + '`'));
  assert.match(sql, /DEFAULT 'vigente' NOT NULL/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
  const journal = JSON.parse(read('drizzle/meta/_journal.json'));
  assert.equal(journal.entries.at(-1).tag, '0006_evolution_annulment');
});

const actionBlock = (route, name) => {
  const start = route.indexOf(`action === "${name}"`);
  assert.ok(start > 0, name);
  const next = route.indexOf('if (action ===', start + 10);
  return route.slice(start, next > 0 ? next : undefined);
};

test('anular (error clínico): con motivo, nunca borra la evolución', () => {
  const block = actionBlock(read('app/api/clinical/route.ts'), 'annulEvolution');
  assert.match(block, /reason/);
  assert.match(block, /status: "anulada"/);
  assert.doesNotMatch(block, /db\.delete\(/);
});

test('eliminar (error del sistema): exige confirmación, borra diagnósticos y luego la evolución; no toca odontograma ni pagos', () => {
  const block = actionBlock(read('app/api/clinical/route.ts'), 'deleteEvolution');
  assert.match(block, /input\.confirm !== "eliminar"/);
  const tags = block.indexOf('db.delete(evolutionDiagnoses)');
  const note = block.indexOf('db.delete(evolutions)');
  assert.ok(tags > 0 && note > tags, 'diagnósticos antes que la evolución');
  assert.match(block, /db\.batch\(\[removeTags, removeNote/);
  assert.match(block, /eq\(evolutions\.ownerId, ownerId\)/);
  assert.doesNotMatch(block, /delete\((toothStatuses|payments|appointments|budgets)\)/);
  assert.doesNotMatch(block, /replacesId/);
});

test('el diálogo ofrece las dos salidas sin sermón legal', async () => {
  const ui = read('components/evolution-annul.tsx');
  assert.match(ui, /Error del sistema — eliminar definitivamente/);
  assert.match(ui, /Anular \(error clínico\)/);
  assert.doesNotMatch(ui, /Ley|20\.584/);
  assert.match(read('app/page.tsx'), /action:"deleteEvolution"/);
});

test('exportación y MCP excluyen anuladas; respaldo en Drive las marca', () => {
  assert.match(read('app/api/clinical/export/route.ts'), /annulledEvolutionsOmitted/);
  assert.match(read('app/mcp/route.ts'), /ne\(evolutions\.status, "anulada"\)/);
  assert.match(read('app/drive-backup.ts'), /\[ANULADA\] /);
});
