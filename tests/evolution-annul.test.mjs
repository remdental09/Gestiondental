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
  assert.equal(journal.entries.find(entry => entry.tag === '0006_evolution_annulment')?.idx, 6);
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
  assert.match(ui, /Error del sistema — quitar de la ficha/);
  assert.doesNotMatch(ui, /eliminar definitivamente|eliminará definitivamente/i);
  assert.match(ui, /Anular \(error clínico\)/);
  assert.doesNotMatch(ui, /Ley|20\.584/);
  assert.match(read('app/page.tsx'), /action:"deleteEvolution"/);
});

test('exportación y MCP excluyen anuladas; respaldo en Drive las marca', () => {
  assert.match(read('app/api/clinical/export/route.ts'), /annulledEvolutionsOmitted/);
  assert.match(read('app/mcp/route.ts'), /ne\(evolutions\.status, "anulada"\)/);
  assert.match(read('app/drive-backup.ts'), /\[ANULADA\] /);
});

test('«error del sistema» archiva una copia íntegra antes de quitarla (nada se destruye)', async () => {
  const route = read('app/api/clinical/route.ts');
  const block = actionBlock(route, 'deleteEvolution');
  const archive = block.indexOf('archiveEvolution(');
  assert.ok(archive > 0 && archive < block.indexOf('db.delete(evolutions)'), 'copia antes de quitar');
  assert.match(block, /if \(!archived\) return error/);
  assert.match(route, /CREATE TABLE IF NOT EXISTS evolution_removals/);
  assert.match(route, /FROM evolutions e WHERE e\.id = \? AND e\.owner_id = \? AND e\.patient_id = \?/);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE evolutions (id INTEGER PRIMARY KEY, owner_id TEXT, patient_id INTEGER, clinical_date TEXT, recorded_at TEXT, title TEXT, body TEXT, status TEXT, request_id TEXT); CREATE TABLE evolution_diagnoses (id INTEGER PRIMARY KEY, owner_id TEXT, patient_id INTEGER, evolution_id INTEGER, code TEXT, title TEXT, tooth INTEGER, findings TEXT, evidence TEXT, origin TEXT, created_at TEXT)");
  const ddl = route.match(/EVOLUTION_REMOVALS_DDL = "([^"]+)"/)[1];
  const copy = route.match(/EVOLUTION_REMOVALS_COPY = ("[\s\S]+?");\n/)[1].split(/"\s*\+\s*"/).join('').replace(/^"|"$/g, '');
  db.exec(ddl);
  db.prepare("INSERT INTO evolutions VALUES (7, 'o1', 3, '2026-11-20', 't', 'Exodoncia', 'texto', 'vigente', 'r1')").run();
  db.prepare("INSERT INTO evolution_diagnoses VALUES (1, 'o1', 3, 7, 'DA0', 'Caries', 36, '', '', 'manual', 't')").run();
  assert.equal(db.prepare(copy).run('dr@x.cl', 'ahora', 7, 'otro', 3).changes, 0, 'otra cuenta no archiva');
  assert.equal(db.prepare(copy).run('dr@x.cl', 'ahora', 7, 'o1', 3).changes, 1);
  const row = db.prepare('SELECT * FROM evolution_removals').get();
  assert.equal(row.body, 'texto'); assert.equal(row.removed_by, 'dr@x.cl'); assert.equal(JSON.parse(row.diagnoses)[0].code, 'DA0');
});
