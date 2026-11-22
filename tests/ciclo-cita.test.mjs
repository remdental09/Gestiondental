import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import {
  nextTimes, NO_TIMES, minutesBetween, waitLabel, waitingRoom, averageWait, checkWaitEntry, suggestForSlot, preferenceFits, offerMessage, waLink, chileClock,
} from '../lib/appointment-cycle.ts';
import { ATTENDANCE_STATUSES, ATTENDANCE_LABEL, baseAttendance, appointmentStats } from '../lib/dashboard.ts';
import { STATUS_COLOR, QUICK_STATUS, LEGEND, freesSlot } from '../lib/agenda-box.ts';
import { statusDenied, apiDenied } from '../lib/role-policy.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('estados del ciclo: llegó, en box, reagendada; el Dashboard los entiende', () => {
  assert.ok(ATTENDANCE_STATUSES.includes('reagendada'));
  assert.equal(ATTENDANCE_LABEL.reagendada, 'Reagendada');
  assert.equal(ATTENDANCE_LABEL.en_espera, 'Llegó · sala de espera');
  assert.equal(ATTENDANCE_LABEL.ingresada, 'En box');
  assert.ok(STATUS_COLOR.reagendada);
  assert.ok(LEGEND.some(l => l.status === 'reagendada'));
  assert.deepEqual(QUICK_STATUS.map(q => q.label), ['Confirmada', 'Llegó', 'En box', 'Atendida']);
  assert.equal(baseAttendance('reagendada'), 'cancelada');
  assert.equal(baseAttendance('en_espera'), 'confirmada');
  assert.equal(baseAttendance('ingresada'), 'confirmada');
  assert.ok(freesSlot('cancelada') && freesSlot('reagendada'));
  assert.ok(!freesSlot('inasistida') && !freesSlot('en_espera'));
  // Inasistidas y efectivas con los nuevos estados.
  const stats = appointmentStats([
    { day: '2026-11-10', patientId: 1, label: 'a', status: 'atendida' },
    { day: '2026-11-10', patientId: 2, label: 'a', status: 'inasistida' },
    { day: '2026-11-10', patientId: 3, label: 'a', status: 'reagendada' },
    { day: '2026-11-10', patientId: 4, label: 'a', status: 'ingresada' },
  ], new Set(['4|2026-11-10']), '2026-11-20');
  assert.equal(stats.effective, 2);
  assert.equal(stats.noShow, 1);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.scheduled, 3);
});

test('horas del ciclo: se guardan la primera vez, retroceder borra las siguientes', () => {
  const t1 = '2026-11-22T13:00:00.000Z', t2 = '2026-11-22T13:12:00.000Z', t3 = '2026-11-22T13:40:00.000Z';
  let t = nextTimes(NO_TIMES, 'en_espera', t1);
  assert.deepEqual(t, { arrivedAt: t1, inBoxAt: null, doneAt: null });
  assert.equal(nextTimes(t, 'en_espera', t2).arrivedAt, t1, 're-marcar no mueve la llegada');
  t = nextTimes(t, 'ingresada', t2);
  assert.deepEqual(t, { arrivedAt: t1, inBoxAt: t2, doneAt: null });
  t = nextTimes(t, 'atendida', t3);
  assert.deepEqual(t, { arrivedAt: t1, inBoxAt: t2, doneAt: t3 });
  assert.deepEqual(nextTimes(t, 'en_espera', t3), { arrivedAt: t1, inBoxAt: null, doneAt: null });
  assert.deepEqual(nextTimes(t, 'confirmada', t3), NO_TIMES);
  assert.deepEqual(nextTimes(t, 'cancelada', t3), t);
  assert.deepEqual(nextTimes(NO_TIMES, 'ingresada', t2), { arrivedAt: null, inBoxAt: t2, doneAt: null }, 'pasar directo a box sin sala de espera');
  assert.equal(minutesBetween(t1, t2), 12);
  assert.equal(minutesBetween(t2, t1), 0);
  assert.equal(minutesBetween(null, t1), null);
  assert.equal(waitLabel(8), '8 min');
  assert.equal(waitLabel(65), '1 h 05 min');
  assert.equal(waitLabel(null), '—');
  assert.equal(chileClock(t1), '10:00');
});

test('sala de espera: solo los que llegaron, el que más espera primero, y espera promedio', () => {
  const now = '2026-11-22T13:30:00.000Z';
  const list = [
    { key: 'a', start: '10:00', status: 'en_espera', arrivedAt: '2026-11-22T13:20:00.000Z', inBoxAt: null, doneAt: null },
    { key: 'b', start: '10:30', status: 'en_espera', arrivedAt: '2026-11-22T13:05:00.000Z', inBoxAt: null, doneAt: null },
    { key: 'c', start: '09:30', status: 'ingresada', arrivedAt: '2026-11-22T12:25:00.000Z', inBoxAt: '2026-11-22T12:35:00.000Z', doneAt: null },
    { key: 'd', start: '09:00', status: 'atendida', arrivedAt: '2026-11-22T11:55:00.000Z', inBoxAt: '2026-11-22T12:15:00.000Z', doneAt: '2026-11-22T12:50:00.000Z' },
    { key: 'e', start: '11:00', status: 'confirmada', arrivedAt: null, inBoxAt: null, doneAt: null },
  ];
  const room = waitingRoom(list, now);
  assert.deepEqual(room.map(r => [r.key, r.waiting]), [['b', 25], ['a', 10]]);
  assert.equal(averageWait(list), 15);
  assert.equal(averageWait([]), null);
});

test('lista de espera: validación, sugerencias por preferencia y WhatsApp manual', () => {
  assert.equal(checkWaitEntry({ name: 'Al' }).ok, false);
  const ok = checkWaitEntry({ name: '  Ana   Pérez ', phone: '+56 9 1234 5678', preference: 'tarde', note: 'x'.repeat(400) });
  assert.ok(ok.ok); assert.equal(ok.name, 'Ana Pérez'); assert.equal(ok.preference, 'tarde'); assert.equal(ok.note.length, 300);
  assert.equal(checkWaitEntry({ patientId: 7, preference: 'rara' }).preference, 'cualquiera');
  assert.ok(preferenceFits('manana', '09:00') && !preferenceFits('manana', '15:00') && preferenceFits('tarde', '13:00') && preferenceFits('cualquiera', '20:00'));
  const entries = [
    { id: 1, patientId: 10, name: 'Primero Tarde', phone: '', preference: 'tarde', note: '', createdAt: '2026-11-01' },
    { id: 2, patientId: 11, name: 'Segundo Mañana', phone: '', preference: 'manana', note: '', createdAt: '2026-11-02' },
    { id: 3, patientId: null, name: 'Tercero Cualquiera', phone: '', preference: 'cualquiera', note: '', createdAt: '2026-11-03' },
    { id: 4, patientId: 99, name: 'El que canceló', phone: '', preference: 'cualquiera', note: '', createdAt: '2026-10-01' },
  ];
  assert.deepEqual(suggestForSlot(entries, { start: '09:30', patientId: 99 }).map(e => e.id), [2, 3, 1]);
  assert.deepEqual(suggestForSlot(entries, { start: '16:00', patientId: 99 }).map(e => e.id), [1, 3, 2]);
  const msg = offerMessage('Ana Pérez', { dayLabel: 'martes 24 de noviembre', start: '10:30' });
  assert.match(msg, /^Hola Ana, /); assert.match(msg, /martes 24 de noviembre a las 10:30/);
  assert.equal(waLink('56912345678', 'Hola a&b'), 'https://wa.me/56912345678?text=Hola%20a%26b');
});

test('permisos: asistente marca llegó / en box / atendida; recepción gestiona la lista de espera', () => {
  for (const s of ['en_espera', 'ingresada', 'atendida']) assert.equal(statusDenied('asistente', s), null, s);
  assert.ok(statusDenied('asistente', 'reagendada'));
  assert.equal(statusDenied('recepcion', 'reagendada'), null);
  assert.equal(apiDenied('recepcion', 'GET', '/api/lista-espera'), null);
  assert.equal(apiDenied('recepcion', 'POST', '/api/lista-espera'), null);
  assert.equal(apiDenied('asistente', 'GET', '/api/lista-espera'), null);
  assert.ok(apiDenied('asistente', 'POST', '/api/lista-espera'));
  const route = src('app/api/lista-espera/route.ts');
  assert.match(route, /spaceRoleOf\(user\) === "asistente"/);
  assert.ok(route.includes('request.headers.get("origin")'));
});

test('migración 0018 aditiva, en el journal y en el workflow; todo filtra por owner_id', () => {
  const sql = src('drizzle/0018_appointment_cycle.sql');
  assert.doesNotMatch(sql, /DROP|ALTER TABLE \S+ DROP|DELETE/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `appointment_times`/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `waitlist_entries`/);
  assert.ok(JSON.parse(src('drizzle/meta/_journal.json')).entries.some(e => e.tag === '0018_appointment_cycle'));
  assert.match(src('.github/workflows/deploy-cloudflare-worker.yml'), /drizzle\/0018_appointment_cycle\.sql/);
  const db = src('app/cycle-db.ts');
  for (const m of db.matchAll(/"((?:SELECT|UPDATE|DELETE)[^"]+)"/g)) assert.match(m[1], /owner_id = \?/, m[1].slice(0, 80));
  assert.doesNotMatch(db, /DELETE FROM waitlist_entries/);
  // Nunca se envía WhatsApp automático: solo enlaces wa.me.
  assert.doesNotMatch(src('components/waiting-room.tsx'), /fetch\([^)]*(whatsapp|graph\.facebook)/i);
});

const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: las horas se guardan al cambiar el estado, la lista de espera es por espacio', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = globalThis.__gdTestEnv;', shortCircuit: true };
      if (specifier.startsWith('@/')) { const base = path.join(root, specifier.slice(2)); return next(pathToFileURL(existsSync(base + '.ts') ? base + '.ts' : existsSync(base + '.tsx') ? base + '.tsx' : path.join(base, 'index.ts')).href, context); }
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.startsWith('file:')) {
        const base = path.join(path.dirname(new URL(context.parentURL).pathname), specifier);
        const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(existsSync);
        if (file) return next(pathToFileURL(file).href, context);
      }
      return next(specifier, context);
    },
  });
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, rut TEXT, phone TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
    CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, patient_id INTEGER NOT NULL, day TEXT, time TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, calendar_id TEXT, google_event_id TEXT, title TEXT, start_at TEXT, end_at TEXT, status TEXT, all_day INTEGER, patient_id INTEGER);
    INSERT INTO patients (id, owner_id, name, phone) VALUES (1, 'A', 'Paciente Sintético Uno', '+56 9 1111 2222'), (2, 'B', 'Paciente Sintético Otro', '');
    INSERT INTO appointments (id, owner_id, patient_id, day, time, reason, created_at) VALUES (1, 'A', 1, '2026-11-22', '10:00', 'Control', 'x'), (2, 'B', 2, '2026-11-22', '10:00', 'Control', 'x');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const attendance = await import('../app/attendance-db.ts');
  const cycle = await import('../app/cycle-db.ts');
  assert.equal(await attendance.setAttendance('A', 'app', 1, 'en_espera'), true);
  let row = sqlite.prepare("SELECT * FROM appointment_times WHERE owner_id = 'A' AND ref_id = 1").get();
  assert.ok(row.arrived_at && !row.in_box_at);
  await attendance.setAttendance('A', 'app', 1, 'ingresada');
  await attendance.setAttendance('A', 'app', 1, 'atendida');
  row = sqlite.prepare("SELECT * FROM appointment_times WHERE owner_id = 'A' AND ref_id = 1").get();
  assert.ok(row.arrived_at && row.in_box_at && row.done_at);
  // Otro espacio no puede marcar la cita de A (ni crear horas).
  assert.equal(await attendance.setAttendance('B', 'app', 1, 'en_espera'), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_times WHERE owner_id = 'B'").get().n, 0);
  const times = await cycle.loadCycleTimes('A');
  assert.ok(times.get('app:1').doneAt);
  assert.equal((await cycle.loadCycleTimes('B')).size, 0);
  // Lista de espera aislada por espacio.
  const added = await cycle.addToWaitlist('A', { patientId: 1, preference: 'manana', note: 'solo martes' }, 'recepcion@example.com');
  assert.ok(added.ok); assert.equal(added.entry.name, 'Paciente Sintético Uno');
  assert.equal((await cycle.addToWaitlist('A', { patientId: 1 }, 'x')).ok, false, 'sin duplicados');
  assert.equal((await cycle.addToWaitlist('B', { patientId: 1 }, 'x')).ok, false, 'paciente de otro espacio');
  assert.ok((await cycle.addToWaitlist('A', { name: 'Persona Nueva Sintética', phone: '912345678' }, 'x')).ok);
  assert.equal((await cycle.listWaitlist('A')).length, 2);
  assert.equal((await cycle.listWaitlist('B')).length, 0);
  assert.equal(await cycle.removeFromWaitlist('B', added.entry.id), false);
  assert.equal(await cycle.removeFromWaitlist('A', added.entry.id), true);
  assert.equal((await cycle.listWaitlist('A')).length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM waitlist_entries').get().n, 2, 'quitar no borra la fila');
});
