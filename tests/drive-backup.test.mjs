import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/drive-backup.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tables = Object.fromEntries(
  ['patients', 'evolutions', 'budgets', 'appointments', 'periodontalExams', 'toothStatuses', 'clinicalImages', 'driveBackups']
    .map(name => [name, Object.fromEntries(['id', 'ownerId', 'patientId', 'backupStatus'].map(key => [key, key]))]),
);

function fixture() {
  const patient = {
    id: 4, ownerId: 'owner', name: 'Paciente Ejemplo', birthDate: '1980-01-01', rut: null,
    phone: '', email: '', reason: 'Evaluación', status: 'Evaluación', allergies: 'Sin registrar',
    history: 'Sin registrar', driveFolderId: null, createdAt: '2026-10-01T12:00:00Z', updatedAt: '',
  };
  const note = {
    id: 7, ownerId: 'owner', patientId: 4, clinicalDate: '2026-10-01', recordedAt: '2026-10-01T12:00:00Z',
    title: 'Control', body: 'Texto sintético.', sourceDocumentId: null, backupStatus: 'not_configured',
  };
  const rows = {
    patients: [patient], evolutions: [note], budgets: [], appointments: [], periodontalExams: [],
    toothStatuses: [], clinicalImages: [], driveBackups: [],
  };
  const keyOf = table => Object.keys(tables).find(key => tables[key] === table);
  const eq = (column, value) => ({ column, value });
  const and = (...conditions) => conditions;
  const getDb = () => ({
    select: () => ({
      from(table) {
        const query = {
          conditions: [],
          where(conditions) { this.conditions = conditions; return this; },
          orderBy() { return this; },
          result() { return rows[keyOf(table)].filter(row => this.conditions.every(({ column, value }) => row[column] === value)); },
          async limit(n) { return this.result().slice(0, n); },
          then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
        };
        return query;
      },
    }),
    insert(table) {
      return { values(value) { return { async onConflictDoUpdate() {
        const list = rows[keyOf(table)];
        const index = list.findIndex(row => row.patientId === value.patientId);
        if (index < 0) list.push(value); else list[index] = value;
      } }; } };
    },
    update(table) {
      return { set(value) { return { async where(conditions) {
        for (const row of rows[keyOf(table)]) {
          if (conditions.every(({ column, value: expected }) => row[column] === expected)) Object.assign(row, value);
        }
      } }; } };
    },
  });
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: name => ({
      'drizzle-orm': { and, asc: value => value, eq, gt: () => null },
      '@/db': { getDb },
      '@/db/schema': tables,
    })[name],
    crypto, TextEncoder, Date, Uint8Array, ArrayBuffer,
  });
  return { ...exports, patient, note, rows };
}

test('el respaldo detecta cambios de contacto y no considera copiados los binarios', async () => {
  const { getDriveSnapshot, confirmDriveSnapshot, patient, note, rows } = fixture();
  const original = await getDriveSnapshot('owner', 4);
  assert.equal(original.pending, true);
  assert.equal(original.documentText.includes('Texto sintético.'), true);
  assert.equal((await confirmDriveSnapshot('owner', 4, 'documento12345', '0'.repeat(64), null)).stale, true);
  assert.equal(rows.driveBackups.length, 0);

  const saved = await confirmDriveSnapshot('owner', 4, 'documento12345', original.digest, null);
  assert.equal(saved.saved, true);
  assert.equal(note.backupStatus, 'source_in_drive');
  assert.equal((await getDriveSnapshot('owner', 4)).pending, false);

  patient.phone = '+56 900000000';
  const changed = await getDriveSnapshot('owner', 4);
  assert.equal(changed.pending, true);
  assert.notEqual(changed.digest, original.digest);
  assert.equal(changed.previousDocumentId, 'documento12345');
});
