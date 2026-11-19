import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { decideGoogleChange, chileDayTime, latestIso, shouldSyncNow } from '../lib/calendar-two-way.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const appt = { day: '2026-12-19', time: '09:00' };
const ev = (over = {}) => ({ id: 'e1', status: 'confirmed', updated: '2026-11-20T12:00:00.000Z', start: { dateTime: '2026-12-21T10:30:00-03:00' }, ...over });

test('hora de Chile de un instante de Google', () => {
  assert.deepEqual(chileDayTime('2026-12-21T13:30:00Z'), { day: '2026-12-21', time: '10:30' });
  assert.deepEqual(chileDayTime('2026-12-22T02:30:00Z'), { day: '2026-12-21', time: '23:30' });
  assert.equal(chileDayTime('nada'), null);
});

test('movido en Google → nueva fecha y hora en la app', () => {
  assert.deepEqual(decideGoogleChange(ev(), { googleUpdated: '2026-11-19T12:00:00Z', appChangedAt: '2026-11-19T12:00:00Z' }, appt), { kind: 'move', day: '2026-12-21', time: '10:30' });
  // Sin historial (eventos creados antes de esta versión): también se aplica.
  assert.equal(decideGoogleChange(ev(), { googleUpdated: null, appChangedAt: null }, appt).kind, 'move');
  // Pasado a «todo el día»: se toma la fecha y se mantiene la hora.
  assert.deepEqual(decideGoogleChange(ev({ start: { date: '2026-12-20' } }), { googleUpdated: null, appChangedAt: null }, appt), { kind: 'move', day: '2026-12-20', time: '09:00' });
});

test('borrado o cancelado en Google → se cancela en la app', () => {
  assert.deepEqual(decideGoogleChange(ev({ status: 'cancelled', start: undefined }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: null }, appt), { kind: 'cancel' });
});

test('sin rebotes: lo que escribió la propia app no vuelve', () => {
  const echo = decideGoogleChange(ev({ updated: '2026-11-20T12:00:00.000Z' }), { googleUpdated: '2026-11-20T12:00:00.000Z', appChangedAt: '2026-11-20T11:59:59Z' }, appt);
  assert.deepEqual(echo, { kind: 'ignore', why: 'eco' });
  assert.equal(decideGoogleChange(ev({ updated: '2026-11-20T11:00:00Z' }), { googleUpdated: '2026-11-20T12:00:00Z', appChangedAt: null }, appt).kind, 'ignore');
});

test('gana el cambio más reciente', () => {
  // La app cambió la cita después de la edición en Google → se ignora Google.
  assert.deepEqual(decideGoogleChange(ev({ updated: '2026-11-20T12:00:00Z' }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: '2026-11-20T12:05:00Z' }, appt), { kind: 'ignore', why: 'app-mas-reciente' });
  // También para un borrado viejo en Google.
  assert.equal(decideGoogleChange(ev({ status: 'cancelled', updated: '2026-11-20T12:00:00Z' }), { googleUpdated: null, appChangedAt: '2026-11-20T13:00:00Z' }, appt).kind, 'ignore');
  // Google más nuevo que la app → gana Google.
  assert.equal(decideGoogleChange(ev({ updated: '2026-11-20T12:10:00Z' }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: '2026-11-20T12:05:00Z' }, appt).kind, 'move');
});

test('solo título cambiado o sin cita en la app → nada', () => {
  assert.deepEqual(decideGoogleChange(ev({ start: { dateTime: '2026-12-19T09:00:00-03:00' } }), { googleUpdated: null, appChangedAt: null }, appt), { kind: 'ignore', why: 'sin-cambio' });
  assert.deepEqual(decideGoogleChange(ev(), { googleUpdated: null, appChangedAt: null }, null), { kind: 'ignore', why: 'sin-cita' });
});

test('utilidades: el más nuevo y el límite a pedido (2 minutos)', () => {
  assert.equal(latestIso('2026-11-20T12:00:00Z', '2026-11-20T11:00:00Z'), '2026-11-20T12:00:00Z');
  assert.equal(latestIso(null, '2026-11-20T11:00:00Z'), '2026-11-20T11:00:00Z');
  assert.equal(latestIso(null, null), null);
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(shouldSyncNow(null, now), true);
  assert.equal(shouldSyncNow('2026-11-20T11:59:00Z', now), false);
  assert.equal(shouldSyncNow('2026-11-20T11:57:59Z', now), true);
});

test('cableado: syncToken con borrados, 410 → lectura completa, cron cada 15 min y a pedido', () => {
  const google = src('app/drive-oauth.ts');
  assert.match(google, /showDeleted: "true"/);
  assert.match(google, /params\.set\("syncToken", syncToken\)/);
  assert.match(google, /response\.status === 410/);
  assert.match(google, /noteAppWrite\(ownerId, appointment\.id, created\.updated\)/);
  assert.match(google, /markAppChanged\(ownerId, appointmentId\)/);
  assert.match(src('app/scheduled.ts'), /AGENDA_CHANGES_CRON[\s\S]*syncAppEventsFromGoogle\(\)/);
  assert.match(src('wrangler.cloudflare.jsonc'), /"\*\/15 \* \* \* \*"/);
  assert.match(src('app/api/controles/route.ts'), /syncAppEventsFromGoogle\(user\.userId, \{ onDemand: true \}\)/);
  assert.match(src('app/api/calendar/route.ts'), /syncAppEventsFromGoogle\(user\.userId, \{ onDemand: true \}\)/);
  const twoWay = src('app/calendar-two-way.ts');
  assert.match(twoWay, /ADD COLUMN google_updated TEXT/);
  assert.doesNotMatch(twoWay, /DROP |DELETE FROM appointments/);
  assert.doesNotMatch(google.slice(google.indexOf('export async function syncAppEventsFromGoogle')), /console\.log/);
});

const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: mover, borrar (reversible), eco y aislamiento por owner_id', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = globalThis.__gdTestEnv;', shortCircuit: true };
      if (specifier.startsWith('@/')) return next(pathToFileURL(path.join(root, specifier.slice(2))).href + '.ts', context);
      return next(specifier, context);
    },
  });
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE patients (id INTEGER PRIMARY KEY, owner_id TEXT, name TEXT, phone TEXT);
    CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, patient_id INTEGER, day TEXT, time TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, calendar_id TEXT, google_event_id TEXT, title TEXT, start_at TEXT, end_at TEXT, status TEXT, all_day INTEGER, imported_at TEXT, source_updated_at TEXT);
    INSERT INTO patients VALUES (1, 'A', 'Paciente Uno', '');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const followup = await import('../app/followup-db.ts');
  const twoWay = await import('../app/calendar-two-way.ts');
  await twoWay.ensureTwoWay();
  const control = await followup.addControl('A', { patientId: 1, dueOn: '2026-12-19', reason: 'Conexión', note: '', evolutionId: null, createdBy: '' });
  const a = sqlite.prepare("INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at) VALUES ('A', 1, '2026-12-19', '09:00', 'Control: Conexión', 'x') RETURNING id").get().id;
  await followup.linkControlAppointment('A', control.id, a);
  sqlite.prepare("INSERT INTO calendar_events (owner_id, calendar_id, google_event_id, title, start_at, end_at, status, all_day) VALUES ('A', 'g:s1:dr@x', 'ev1', 't', '2026-12-19T12:00:00.000Z', '2026-12-19T12:30:00.000Z', 'confirmed', 0)").run();
  sqlite.prepare("INSERT INTO appointment_google_events (owner_id, appointment_id, google_sub, calendar_id, event_id) VALUES ('A', ?, 's1', 'g:s1:dr@x', 'ev1')").run(a);
  // La app escribió el evento: su «updated» es eco.
  await twoWay.noteAppWrite('A', a, '2026-11-20T12:00:00.000Z');
  let r = await twoWay.applyGoogleEvents('A', 's1', [{ id: 'ev1', status: 'confirmed', updated: '2026-11-20T12:00:00.000Z', start: { dateTime: '2026-12-21T10:30:00-03:00' } }]);
  assert.deepEqual(r, { moved: 0, cancelled: 0, ignored: 1 });
  // Otro dueño con el mismo id de evento no toca nada.
  r = await twoWay.applyGoogleEvents('B', 's1', [{ id: 'ev1', status: 'cancelled', updated: '2026-11-21T00:00:00.000Z' }]);
  assert.equal(r.cancelled, 0);
  // Movido en Google (sábado → lunes 10:30).
  r = await twoWay.applyGoogleEvents('A', 's1', [{ id: 'ev1', status: 'confirmed', updated: '2026-11-20T13:00:00.000Z', start: { dateTime: '2026-12-21T10:30:00-03:00' }, end: { dateTime: '2026-12-21T11:00:00-03:00' } }, { id: 'ajeno', status: 'confirmed', updated: '2026-11-20T13:00:00.000Z', start: { dateTime: '2026-12-01T10:00:00-03:00' } }]);
  assert.equal(r.moved, 1);
  assert.deepEqual({ ...sqlite.prepare('SELECT day, time FROM appointments WHERE id = ?').get(a) }, { day: '2026-12-21', time: '10:30' });
  assert.equal((await followup.getControl('A', control.id)).dueOn, '2026-12-21');
  assert.equal(sqlite.prepare("SELECT start_at FROM calendar_events WHERE google_event_id = 'ev1'").get().start_at, '2026-12-21T13:30:00.000Z');
  // Repetir la misma lectura no hace nada (idempotente).
  r = await twoWay.applyGoogleEvents('A', 's1', [{ id: 'ev1', status: 'confirmed', updated: '2026-11-20T13:00:00.000Z', start: { dateTime: '2026-12-21T10:30:00-03:00' } }]);
  assert.equal(r.moved, 0);
  // Borrado en Google: cita «Cancelada» (no se borra), control descartado, evento cancelado en la agenda.
  r = await twoWay.applyGoogleEvents('A', 's1', [{ id: 'ev1', status: 'cancelled', updated: '2026-11-20T14:00:00.000Z' }]);
  assert.equal(r.cancelled, 1);
  assert.ok(sqlite.prepare('SELECT id FROM appointments WHERE id = ?').get(a), 'la cita sigue existiendo');
  assert.equal(sqlite.prepare("SELECT status FROM appointment_attendance WHERE owner_id = 'A' AND source = 'app' AND ref_id = ?").get(a).status, 'cancelada');
  const after = await followup.getControl('A', control.id);
  assert.equal(after.status, 'descartado');
  assert.equal(after.appointmentId, a, 'el control conserva su cita para poder reabrirlo');
  assert.equal(sqlite.prepare("SELECT status FROM calendar_events WHERE google_event_id = 'ev1'").get().status, 'cancelled');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM appointment_google_events').get().n, 0);
  // Estado del sync por cuenta (aditivo).
  await twoWay.writeSyncState('A', 's1', { sync_token: 'tok', last_run_at: '2026-11-20T12:00:00Z' });
  assert.equal((await twoWay.readSyncState('A', 's1')).sync_token, 'tok');
  assert.equal((await twoWay.readSyncState('B', 's1')).sync_token, null);
});
