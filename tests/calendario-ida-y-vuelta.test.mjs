import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { decideGoogleChange, chileDayTime, latestIso, shouldSyncNow, minutesBetween } from '../lib/calendar-two-way.ts';
import { isClinicalCandidate, inImportWindow, matchPatientByTitle, reasonFromTitle, isControlTitle, controlReasonFrom } from '../lib/calendar-import.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const appt = { day: '2026-12-19', time: '09:00', minutes: 30, title: 'Control: Conexión' };
const ev = (over = {}) => ({ id: 'e1', status: 'confirmed', updated: '2026-11-20T12:00:00.000Z', start: { dateTime: '2026-12-21T10:30:00-03:00' }, end: { dateTime: '2026-12-21T11:00:00-03:00' }, ...over });
const fresh = { googleUpdated: null, appChangedAt: null };

test('hora de Chile y duración de un evento de Google', () => {
  assert.deepEqual(chileDayTime('2026-12-21T13:30:00Z'), { day: '2026-12-21', time: '10:30' });
  assert.deepEqual(chileDayTime('2026-12-22T02:30:00Z'), { day: '2026-12-21', time: '23:30' });
  assert.equal(chileDayTime('nada'), null);
  assert.equal(minutesBetween('2026-12-21T13:30:00Z', '2026-12-21T14:15:00Z'), 45);
  assert.equal(minutesBetween('2026-12-21T13:30:00Z', undefined), 30);
  assert.equal(minutesBetween('2026-12-21T13:30:00Z', '2026-12-22T13:30:00Z'), 480);
});

test('movido, otra duración u otro título en Google → se actualiza la cita', () => {
  assert.deepEqual(decideGoogleChange(ev(), { googleUpdated: '2026-11-19T12:00:00Z', appChangedAt: '2026-11-19T12:00:00Z' }, appt), { kind: 'update', day: '2026-12-21', time: '10:30', minutes: 30, title: null, restore: false });
  const longer = decideGoogleChange(ev({ start: { dateTime: '2026-12-19T09:00:00-03:00' }, end: { dateTime: '2026-12-19T10:00:00-03:00' } }), fresh, appt);
  assert.equal(longer.kind, 'update'); assert.equal(longer.minutes, 60);
  const renamed = decideGoogleChange(ev({ start: { dateTime: '2026-12-19T09:00:00-03:00' }, end: { dateTime: '2026-12-19T09:30:00-03:00' }, summary: 'Ana Pérez · Control: limpieza' }), fresh, appt, (t) => reasonFromTitle(t, 'Ana Pérez'));
  assert.equal(renamed.kind, 'update'); assert.equal(renamed.title, 'Ana Pérez · Control: limpieza');
  // Mismo motivo con el nombre del paciente: no es un cambio.
  assert.deepEqual(decideGoogleChange(ev({ start: { dateTime: '2026-12-19T09:00:00-03:00' }, end: { dateTime: '2026-12-19T09:30:00-03:00' }, summary: 'Ana Pérez · Control: Conexión' }), fresh, appt, (t) => reasonFromTitle(t, 'Ana Pérez')), { kind: 'ignore', why: 'sin-cambio' });
  // Pasado a «todo el día»: se toma la fecha y se mantiene la hora.
  assert.equal(decideGoogleChange(ev({ start: { date: '2026-12-20' }, end: undefined }), fresh, appt).day, '2026-12-20');
});

test('borrado → cancelar; restaurado de la papelera → vuelve a agendada', () => {
  assert.deepEqual(decideGoogleChange(ev({ status: 'cancelled', start: undefined }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: null }, appt), { kind: 'cancel' });
  assert.deepEqual(decideGoogleChange(ev({ status: 'cancelled' }), { ...fresh, cancelled: true }, appt), { kind: 'ignore', why: 'sin-cambio' });
  const restored = decideGoogleChange(ev({ start: { dateTime: '2026-12-19T09:00:00-03:00' }, end: { dateTime: '2026-12-19T09:30:00-03:00' } }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: null, cancelled: true }, appt);
  assert.equal(restored.kind, 'update'); assert.equal(restored.restore, true);
});

test('sin rebotes y gana el cambio más reciente', () => {
  assert.deepEqual(decideGoogleChange(ev(), { googleUpdated: '2026-11-20T12:00:00.000Z', appChangedAt: '2026-11-20T11:59:59Z' }, appt), { kind: 'ignore', why: 'eco' });
  assert.deepEqual(decideGoogleChange(ev(), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: '2026-11-20T12:05:00Z' }, appt), { kind: 'ignore', why: 'app-mas-reciente' });
  assert.equal(decideGoogleChange(ev({ status: 'cancelled' }), { googleUpdated: null, appChangedAt: '2026-11-20T13:00:00Z' }, appt).kind, 'ignore');
  assert.equal(decideGoogleChange(ev({ updated: '2026-11-20T12:10:00Z' }), { googleUpdated: '2026-11-19T00:00:00Z', appChangedAt: '2026-11-20T12:05:00Z' }, appt).kind, 'update');
  assert.deepEqual(decideGoogleChange(ev(), fresh, null), { kind: 'ignore', why: 'sin-cita' });
});

test('importar: solo citas con hora y clínicas, en la ventana', () => {
  assert.equal(isClinicalCandidate({ status: 'confirmed', summary: 'Ana Pérez control', start: { dateTime: '2026-12-01T10:00:00-03:00' } }), true);
  assert.equal(isClinicalCandidate({ status: 'confirmed', summary: 'Ana Pérez', start: { date: '2026-12-01' } }), false, 'todo el día');
  assert.equal(isClinicalCandidate({ status: 'confirmed', summary: 'Cumpleaños de Pedro', start: { dateTime: '2026-12-01T10:00:00-03:00' } }), false);
  assert.equal(isClinicalCandidate({ status: 'confirmed', summary: 'Feriado', start: { dateTime: '2026-12-01T10:00:00-03:00' } }), false);
  assert.equal(isClinicalCandidate({ status: 'cancelled', summary: 'Ana', start: { dateTime: '2026-12-01T10:00:00-03:00' } }), false);
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(inImportWindow('2026-11-20T10:00:00Z', now), true);
  assert.equal(inImportWindow('2026-10-01T10:00:00Z', now), false);
  assert.equal(inImportWindow('2028-01-01T10:00:00Z', now), false);
});

test('reconocer paciente por el título (sin tildes, una letra de diferencia, nunca ambiguo)', () => {
  const patients = [{ id: 1, name: 'Ana María Pérez Soto' }, { id: 2, name: 'Juan Carlos Muñoz' }, { id: 3, name: 'Juan Pablo Muñoz' }, { id: 4, name: 'Valentina Gonzalez' }];
  assert.equal(matchPatientByTitle('Control ana perez', patients)?.id, 1);
  assert.equal(matchPatientByTitle('Valentina González - limpieza', patients)?.id, 4);
  assert.equal(matchPatientByTitle('Valentna Gonzalez', patients)?.id, 4, 'una letra de diferencia');
  assert.equal(matchPatientByTitle('Juan Muñoz', patients), null, 'ambiguo');
  assert.equal(matchPatientByTitle('Juan Carlos Muñoz', patients)?.id, 2);
  assert.equal(matchPatientByTitle('Reunión equipo', patients), null);
});

test('motivo desde el título y controles', () => {
  assert.equal(reasonFromTitle('Ana María Pérez Soto · Control: Conexión', 'Ana María Pérez Soto'), 'Control: Conexión');
  assert.equal(reasonFromTitle('Control Ana Pérez', 'Ana María Pérez Soto'), 'Control');
  assert.equal(reasonFromTitle('Valentina González - limpieza', 'Valentina Gonzalez'), 'limpieza');
  assert.equal(reasonFromTitle('Ana Pérez', 'Ana Pérez'), 'Cita');
  assert.equal(isControlTitle('Ana Pérez - CONTROL 6 meses'), true);
  assert.equal(isControlTitle('Ana Pérez - limpieza'), false);
  assert.equal(controlReasonFrom('Control: Conexión'), 'Conexión');
  assert.equal(controlReasonFrom('Control'), 'Control');
});

test('utilidades: el más nuevo y el límite a pedido (2 minutos)', () => {
  assert.equal(latestIso('2026-11-20T12:00:00Z', '2026-11-20T11:00:00Z'), '2026-11-20T12:00:00Z');
  assert.equal(latestIso(null, null), null);
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(shouldSyncNow(null, now), true);
  assert.equal(shouldSyncNow('2026-11-20T11:59:00Z', now), false);
});

test('cableado: todos los calendarios con token propio, 410, cola de pendientes, cron y a pedido', () => {
  const google = src('app/drive-oauth.ts');
  assert.match(google, /calendarList\?minAccessRole=writer/);
  assert.match(google, /showDeleted: "true"/);
  assert.match(google, /params\.set\("syncToken", syncToken\)/);
  assert.match(google, /response\.status === 410/);
  assert.match(google, /writeCursor\(row\.owner_id, row\.google_sub, item\.calendarId, item\.cursor\)/);
  assert.match(google, /noteAppWrite\(ownerId, appointment\.id, created\.updated, created\.iCalUID\)/);
  assert.match(google, /enqueueGoogleWrite\(ownerId, appointmentId, "delete"/);
  assert.match(google, /export async function processPendingWrites/);
  const cron = src('app/scheduled.ts');
  assert.match(cron, /AGENDA_CHANGES_CRON[\s\S]*processPendingWrites\(\)[\s\S]*syncAppEventsFromGoogle\(\)/);
  assert.match(src('wrangler.cloudflare.jsonc'), /"\*\/15 \* \* \* \*"/);
  assert.match(src('app/api/calendar/route.ts'), /action === "assignPatient"/);
  const page = src('app/page.tsx');
  assert.match(page, /pendiente de sincronizar/);
  assert.match(page, /Sin paciente – asignar/);
  const twoWay = src('app/calendar-two-way.ts');
  assert.doesNotMatch(twoWay, /DROP |DELETE FROM appointments|DELETE FROM patient_controls/);
  for (const sql of twoWay.match(/ALTER TABLE[^"]*/g)) assert.match(sql, /ADD COLUMN/);
  assert.doesNotMatch(google.slice(google.indexOf('export async function processPendingWrites')), /console\.log/);
});

const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: importar, mover, título, borrar, restaurar, cambio de calendario, asignar y cola', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
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
  sqlite.exec(`CREATE TABLE patients (id INTEGER PRIMARY KEY, owner_id TEXT, name TEXT, phone TEXT DEFAULT '', email TEXT DEFAULT '');
    CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, patient_id INTEGER NOT NULL, day TEXT, time TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, calendar_id TEXT, google_event_id TEXT, title TEXT, start_at TEXT, end_at TEXT, source_time_zone TEXT, html_link TEXT, status TEXT, all_day INTEGER, patient_id INTEGER, imported_at TEXT, source_updated_at TEXT, UNIQUE(owner_id, calendar_id, google_event_id));
    INSERT INTO patients (id, owner_id, name) VALUES (1, 'A', 'Ana María Pérez Soto'), (2, 'A', 'Valentina Gonzalez'), (3, 'B', 'Ana María Pérez Soto');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const followup = await import('../app/followup-db.ts');
  await followup.ensureFollowup();
  const tw = await import('../app/calendar-two-way.ts');
  await tw.ensureTwoWay();
  const at = new Date('2026-11-20T12:00:00Z');
  const P = 'g:s1:dr@x', OTHER = 'g:s1:otro@group';
  const g = (id, over = {}) => ({ id, status: 'confirmed', updated: '2026-11-20T12:00:00.000Z', iCalUID: id + '@google.com', start: { dateTime: '2026-12-02T10:00:00-03:00' }, end: { dateTime: '2026-12-02T10:45:00-03:00' }, ...over });
  const appt = (id) => ({ ...sqlite.prepare('SELECT day, time, minutes, reason, patient_id FROM appointments WHERE id = ?').get(id) });

  // 1) Citas creadas directo en Google → citas de la app (con control si el título lo dice); sin paciente → «Sin paciente – asignar».
  let r = await tw.applyGoogleEvents('A', 's1', [
    { calendarKey: P, importable: true, event: g('n1', { summary: 'Control Ana Pérez' }) },
    { calendarKey: P, importable: true, event: g('n2', { summary: 'Paciente nuevo sin ficha' }) },
    { calendarKey: P, importable: true, event: g('n3', { summary: 'Cumpleaños mamá' }) },
    { calendarKey: P, importable: true, event: g('n4', { summary: 'Valentina González', start: { date: '2026-12-03' }, end: { date: '2026-12-04' } }) },
    { calendarKey: OTHER, importable: false, event: g('n5', { summary: 'Valentina González' }) },
  ], at);
  assert.deepEqual({ imported: r.imported, unassigned: r.unassigned }, { imported: 1, unassigned: 1 });
  const link1 = sqlite.prepare("SELECT appointment_id FROM appointment_google_events WHERE event_id = 'n1'").get();
  const a1 = link1.appointment_id;
  assert.deepEqual(appt(a1), { day: '2026-12-02', time: '10:00', minutes: 45, reason: 'Control', patient_id: 1 });
  const ctl = sqlite.prepare('SELECT status, due_on, reason, appointment_id FROM patient_controls WHERE appointment_id = ?').get(a1);
  assert.deepEqual({ ...ctl }, { status: 'agendado', due_on: '2026-12-02', reason: 'Control', appointment_id: a1 });
  assert.equal(sqlite.prepare("SELECT needs_patient FROM calendar_events WHERE google_event_id = 'n2'").get().needs_patient, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM calendar_events WHERE google_event_id IN ('n3','n4','n5')").get().n, 0);
  // Repetir la lectura no duplica.
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n1', { summary: 'Control Ana Pérez' }) }], at);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n, 1);

  // 2) Movido, más largo y con otro título en Google → cita y control siguen; el paciente no cambia.
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n1', { updated: '2026-11-20T13:00:00Z', summary: 'Control Ana Pérez - revisar puente', start: { dateTime: '2026-12-05T11:00:00-03:00' }, end: { dateTime: '2026-12-05T12:00:00-03:00' } }) }], at);
  assert.equal(r.moved, 1);
  assert.deepEqual(appt(a1), { day: '2026-12-05', time: '11:00', minutes: 60, reason: 'Control - revisar puente', patient_id: 1 });
  assert.equal(sqlite.prepare('SELECT due_on FROM patient_controls WHERE appointment_id = ?').get(a1).due_on, '2026-12-05');

  // 3) Eco de la propia app: no rebota.
  await tw.noteAppWrite('A', a1, '2026-11-20T14:00:00.000Z');
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n1', { updated: '2026-11-20T14:00:00.000Z', start: { dateTime: '2026-12-09T09:00:00-03:00' } }) }], at);
  assert.equal(r.moved, 0);

  // 4) Movido a otro calendario: la cancelación del calendario viejo no cuenta, la copia nueva manda.
  r = await tw.applyGoogleEvents('A', 's1', [
    { calendarKey: P, importable: true, event: { id: 'n1', status: 'cancelled', updated: '2026-11-20T15:00:00Z' } },
    { calendarKey: OTHER, importable: false, event: g('n1', { updated: '2026-11-20T15:00:00Z', summary: 'Control Ana Pérez - revisar puente', start: { dateTime: '2026-12-05T11:00:00-03:00' }, end: { dateTime: '2026-12-05T12:00:00-03:00' } }) },
  ], at);
  assert.equal(r.cancelled, 0);
  assert.equal(sqlite.prepare('SELECT calendar_id FROM appointment_google_events WHERE appointment_id = ?').get(a1).calendar_id, OTHER);
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: { id: 'n1', status: 'cancelled', updated: '2026-11-20T15:30:00Z' } }], at);
  assert.equal(r.cancelled, 0, 'cancelación tardía del calendario anterior');

  // 5) Borrado en Google → «Cancelada» y control descartado (sin borrar nada); restaurado → vuelve.
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: OTHER, importable: false, event: { id: 'n1', status: 'cancelled', updated: '2026-11-20T16:00:00Z' } }], at);
  assert.equal(r.cancelled, 1);
  assert.ok(sqlite.prepare('SELECT id FROM appointments WHERE id = ?').get(a1));
  assert.equal(sqlite.prepare("SELECT status FROM appointment_attendance WHERE source = 'app' AND ref_id = ?").get(a1).status, 'cancelada');
  assert.equal(sqlite.prepare('SELECT status FROM patient_controls WHERE appointment_id = ?').get(a1).status, 'descartado');
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: OTHER, importable: false, event: g('n1', { updated: '2026-11-20T17:00:00Z', summary: 'Control Ana Pérez - revisar puente', start: { dateTime: '2026-12-05T11:00:00-03:00' }, end: { dateTime: '2026-12-05T12:00:00-03:00' } }) }], at);
  assert.equal(r.restored, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM appointment_attendance WHERE source = 'app' AND ref_id = ?").get(a1).n, 0, 'vuelve a «Agendada»');
  assert.equal(sqlite.prepare('SELECT status FROM patient_controls WHERE appointment_id = ?').get(a1).status, 'agendado');

  // 6) Borrado + creado con el mismo iCalUID → mismo enlace, sin duplicar.
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n1b', { iCalUID: 'n1@google.com', updated: '2026-11-20T18:00:00Z', summary: 'Control Ana Pérez - revisar puente', start: { dateTime: '2026-12-06T11:00:00-03:00' }, end: { dateTime: '2026-12-06T12:00:00-03:00' } }) }], at);
  assert.equal(sqlite.prepare('SELECT event_id FROM appointment_google_events WHERE appointment_id = ?').get(a1).event_id, 'n1b');
  assert.equal(appt(a1).day, '2026-12-06');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n, 1);

  // 7) Asignar paciente a la cita «Sin paciente».
  const n2 = sqlite.prepare("SELECT id FROM calendar_events WHERE google_event_id = 'n2'").get().id;
  assert.equal((await tw.assignPatientToCalendarEvent('B', n2, 3)).ok, false, 'otro dueño no puede');
  const assigned = await tw.assignPatientToCalendarEvent('A', n2, 2);
  assert.equal(assigned.ok, true);
  assert.equal(appt(assigned.appointmentId).patient_id, 2);
  assert.equal(sqlite.prepare('SELECT needs_patient FROM calendar_events WHERE id = ?').get(n2).needs_patient, 0);

  // 8) Otro dueño nunca ve ni toca estos eventos.
  r = await tw.applyGoogleEvents('B', 's1', [{ calendarKey: P, importable: true, event: { id: 'n1b', status: 'cancelled', updated: '2026-11-21T00:00:00Z' } }], at);
  assert.equal(r.cancelled, 0);

  // 9) Cola de escrituras pendientes.
  await tw.enqueuePending('A', a1, 'upsert', 'HTTP 500');
  assert.deepEqual(await tw.pendingAppointmentIds('A'), [a1]);
  assert.deepEqual(await tw.pendingAppointmentIds('B'), []);
  const flags = await tw.agendaSyncFlags('A');
  assert.deepEqual(flags.pendingAppointments, [a1]);
  assert.equal(flags.pendingEvents.length, 1);
  assert.equal(flags.minutes[a1], 60);
  await tw.finishPending('A', a1, 'upsert', 'HTTP 500 otra vez');
  assert.equal((await tw.listPending('A'))[0].attempts, 1);
  await tw.noteAppWrite('A', a1, '2026-11-20T19:00:00Z');
  assert.deepEqual(await tw.pendingAppointmentIds('A'), [], 'se limpia cuando Google confirma');

  // 10) Muchas citas nuevas a la vez: por tandas (no se guarda el token hasta terminar).
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n9', { summary: 'Valentina Gonzalez' }) }], at, 0);
  assert.equal(r.deferred, true);
  assert.equal(r.imported, 0);
  r = await tw.applyGoogleEvents('A', 's1', [{ calendarKey: P, importable: true, event: g('n9', { summary: 'Valentina Gonzalez' }) }], at);
  assert.deepEqual({ imported: r.imported, deferred: r.deferred }, { imported: 1, deferred: false });
});
