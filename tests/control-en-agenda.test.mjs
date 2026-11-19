import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { controlAppointmentReason, weekendName, isClockTime, DEFAULT_CONTROL_TIME } from '../lib/next-control.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('motivo de la cita del control: «Control: <motivo>» sin repetir «Control»', () => {
  assert.equal(controlAppointmentReason('Conexión'), 'Control: Conexión');
  assert.equal(controlAppointmentReason('  revisar   cicatrización '), 'Control: revisar cicatrización');
  assert.equal(controlAppointmentReason('Control'), 'Control');
  assert.equal(controlAppointmentReason(''), 'Control');
  assert.equal(controlAppointmentReason('Control de implante 3.6'), 'Control de implante 3.6');
  assert.equal(controlAppointmentReason('control periodontal'), 'control periodontal');
  assert.ok(controlAppointmentReason('x'.repeat(900)).length <= 500);
});

test('fin de semana: se avisa «cae sábado/domingo» y la fecha se mantiene', () => {
  assert.equal(weekendName('2026-12-19'), 'sábado');
  assert.equal(weekendName('2026-12-20'), 'domingo');
  assert.equal(weekendName('2026-12-21'), null);
  assert.equal(weekendName('2026-11-20'), null);
  assert.equal(weekendName('19-12-2026'), null);
  assert.equal(DEFAULT_CONTROL_TIME, '09:00');
  assert.ok(isClockTime('09:00') && isClockTime('23:59') && !isClockTime('24:00') && !isClockTime('9:00') && !isClockTime(null));
});

test('la columna appointment_id es aditiva (ALTER ADD COLUMN, sin borrar datos)', () => {
  const db = src('app/followup-db.ts');
  assert.match(db, /ALTER TABLE patient_controls ADD COLUMN appointment_id INTEGER/);
  assert.doesNotMatch(db, /DROP\s+(TABLE|COLUMN)/i);
  for (const sql of db.match(/prepare\("(UPDATE|SELECT)[^"]*patient_controls[^"]*"\)/g) ?? []) assert.match(sql, /owner_id = \?/, sql);
});

test('el servidor agenda el control al crearlo, lo sigue y hace el backfill', () => {
  const route = src('app/api/controles/route.ts');
  assert.match(route, /scheduleControl\(s\.user\.userId, control\.id, time\)/);
  assert.match(route, /backfillControlAppointments\(user\.userId/);
  assert.match(route, /cancelControlAppointment/);
  assert.match(route, /completeControlAppointment/);
  assert.match(route, /moveControlAppointment/);
  const agenda = src('app/control-agenda.ts');
  assert.match(agenda, /pushAppointmentToGoogle/);
  assert.match(agenda, /rescheduleAppointmentInGoogle/);
  assert.match(agenda, /deleteAppointmentEverywhere/);
  const google = src('app/drive-oauth.ts');
  assert.equal((google.match(/await followControl\(/g) ?? []).length, 5, 'mover/borrar en la agenda actualiza el control');
  assert.match(src('app/api/clinical/route.ts'), /controlFollowsAppointment\(ownerId, a\.id, \{ day: a\.day \}\)/);
});

test('cliente: hora 09:00 editable, aviso de fin de semana, botón para dar permiso de escritura y recarga de agenda', () => {
  const ui = src('components/next-controls.tsx');
  assert.match(ui, /type="time"/);
  assert.match(ui, /Conectar Google Calendar para escribir controles/);
  assert.match(ui, /\/api\/drive\/connect\?calendar=1/);
  assert.match(ui, /cae \{name\}/);
  assert.match(src('app/page.tsx'), /addEventListener\("gd-controls-changed"/);
  assert.match(src('components/clinical-dictation.tsx'), /<WeekendHint day=\{controlItem\.dueOn\}/);
});

// Prueba con SQLite real: las consultas de followup-db y control-agenda contra el mismo esquema que D1.
const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: agenda una vez, mueve, cierra y respeta owner_id', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
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
    INSERT INTO patients VALUES (1, 'A', 'Paciente Uno', ''), (2, 'B', 'Paciente Dos', '');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const db = await import('../app/followup-db.ts');
  const google = [];
  // Google sin conexión: la cita queda solo en la agenda de la app.
  const fake = { pushAppointmentToGoogle: async (...args) => { google.push(args); return 'sin-conexion'; } };
  const scheduleWith = async (owner, id, time) => {
    if (!(await db.claimControlForAgenda(owner, id))) return null;
    const control = await db.getControl(owner, id);
    const row = sqlite.prepare('INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').get(owner, control.patientId, control.dueOn, time, 'Control: ' + control.reason, 'x');
    await db.linkControlAppointment(owner, id, row.id);
    await fake.pushAppointmentToGoogle(owner, row.id);
    return row.id;
  };
  const c = await db.addControl('A', { patientId: 1, dueOn: '2026-12-19', reason: 'Conexión', note: '', evolutionId: null, createdBy: '' });
  assert.equal(c.appointmentId, null);
  assert.deepEqual(await db.controlsMissingAppointment('A', '2026-11-19'), [c.id]);
  assert.deepEqual(await db.controlsMissingAppointment('B', '2026-11-19'), [], 'otro dueño no ve el control');
  const appointmentId = await scheduleWith('A', c.id, '09:00');
  assert.ok(appointmentId > 0);
  assert.equal(await scheduleWith('A', c.id, '09:00'), null, 'no se duplica la cita');
  assert.equal(await db.claimControlForAgenda('B', c.id), false, 'otro dueño no puede agendarlo');
  let saved = await db.getControl('A', c.id);
  assert.equal(saved.status, 'agendado');
  assert.equal(saved.appointmentId, appointmentId);
  assert.equal(saved.appointmentTime, '09:00');
  assert.deepEqual(await db.controlsMissingAppointment('A', '2026-11-19'), []);
  // Mover la cita en la agenda mueve el control (y otro dueño no puede).
  await db.controlFollowsAppointment('B', appointmentId, { day: '2027-01-04' });
  assert.equal((await db.getControl('A', c.id)).dueOn, '2026-12-19');
  await db.controlFollowsAppointment('A', appointmentId, { day: '04-01-2027' });
  assert.equal((await db.getControl('A', c.id)).dueOn, '2027-01-04');
  // Borrar la cita: el control vuelve a pendiente y no se recrea en el backfill.
  await db.controlFollowsAppointment('A', appointmentId, { deleted: true });
  saved = await db.getControl('A', c.id);
  assert.equal(saved.status, 'pendiente');
  assert.equal(saved.appointmentId, null);
  assert.deepEqual(await db.controlsMissingAppointment('A', '2026-11-19'), []);
  // Volver a agendarlo explícitamente sí se permite.
  await db.allowReschedule('A', c.id);
  assert.ok(await scheduleWith('A', c.id, '10:30'));
  assert.equal((await db.getControl('A', c.id)).appointmentTime, '10:30');
  // Un control descartado no sigue los cambios de fecha de la cita.
  const d = await db.addControl('A', { patientId: 1, dueOn: '2026-12-01', reason: 'Control', note: '', evolutionId: null, createdBy: '' });
  const dAppointment = await scheduleWith('A', d.id, '09:00');
  await db.updateControl('A', d.id, { status: 'descartado' });
  await db.controlFollowsAppointment('A', dAppointment, { day: '2026-12-09' });
  await db.controlFollowsAppointment('A', dAppointment, { deleted: true });
  saved = await db.getControl('A', d.id);
  assert.equal(saved.dueOn, '2026-12-01');
  assert.equal(saved.status, 'descartado');
  // Controles vencidos no se agendan en el backfill.
  await db.addControl('A', { patientId: 1, dueOn: '2026-10-01', reason: 'Control', note: '', evolutionId: null, createdBy: '' });
  assert.deepEqual(await db.controlsMissingAppointment('A', '2026-11-19'), []);
  assert.equal(google.length, 3);
});
