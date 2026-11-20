import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import {
  STATUS_COLOR, LEGEND, QUICK_STATUS, BLOCK_COLOR, freeSlots, blockOccursOn, blocksOn, checkBlock, checkSchedule, columnsFor, columnOf, cardBox, clockAt,
  dayRange, weekOf, weekdayOf, whatsappNumber, textOn, BOX_SCHEMA_DDL, BOX_COLUMNS_DDL, statusOf,
} from '../lib/agenda-box.ts';
import { ATTENDANCE_STATUSES, ATTENDANCE_LABEL, baseAttendance, appointmentStats, isAttendanceStatus } from '../lib/dashboard.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('estados de Dentalsoft con su color, y equivalencia con los del Dashboard', () => {
  assert.equal(STATUS_COLOR.agendada, '#a5bbc7');
  assert.equal(STATUS_COLOR.en_espera, '#f49f33');
  assert.equal(STATUS_COLOR.confirmada, '#4a97c6');
  assert.equal(STATUS_COLOR.ingresada, '#64b873');
  assert.equal(STATUS_COLOR.cancelada, '#92a2a8');
  assert.equal(STATUS_COLOR.atendida, '#9575cd');
  assert.equal(STATUS_COLOR.notificada_email, '#80cbc4');
  assert.equal(STATUS_COLOR.confirmada_email, '#4db6ac');
  assert.equal(STATUS_COLOR.notificada_whatsapp, '#e8c73f');
  assert.equal(STATUS_COLOR.confirmada_whatsapp, '#9ccc65');
  assert.match(BLOCK_COLOR, /^#e5/);
  for (const s of ATTENDANCE_STATUSES) { assert.ok(STATUS_COLOR[s], s); assert.ok(ATTENDANCE_LABEL[s], s); }
  assert.equal(LEGEND.length, ATTENDANCE_STATUSES.length);
  assert.deepEqual(QUICK_STATUS.map(q => q.status), ['confirmada', 'en_espera', 'ingresada', 'atendida']);
  assert.equal(ATTENDANCE_LABEL.en_espera, 'En lista de espera');
  assert.equal(ATTENDANCE_LABEL.ingresada, 'Ingresada a box');
  // Los 5 de siempre siguen válidos (PR #339) y los nuevos cuentan como uno de ellos en el Dashboard.
  for (const s of ['agendada', 'confirmada', 'atendida', 'inasistida', 'cancelada']) { assert.ok(isAttendanceStatus(s)); assert.equal(baseAttendance(s), s); }
  assert.equal(baseAttendance('confirmada_whatsapp'), 'confirmada');
  assert.equal(baseAttendance('ingresada'), 'confirmada');
  assert.equal(baseAttendance('notificada_email'), 'agendada');
  assert.equal(baseAttendance('raro'), null);
  assert.equal(statusOf('raro'), 'agendada');
  const stats = appointmentStats([
    { day: '2026-11-10', patientId: 1, label: 'a', status: 'confirmada_email' },
    { day: '2026-11-10', patientId: 2, label: 'b', status: 'notificada_whatsapp' },
    { day: '2026-11-10', patientId: 3, label: 'c', status: 'cancelada' },
  ], new Set(), '2026-11-20');
  assert.equal(stats.scheduled, 2); assert.equal(stats.confirmed, 1); assert.equal(stats.cancelled, 1);
  assert.equal(textOn('#a5bbc7'), '#1f2430'); assert.equal(textOn('#473a6d'), '#ffffff');
});

test('semana, días y grilla de 15 minutos', () => {
  assert.deepEqual(weekOf('2026-11-20'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.equal(weekOf('2026-11-22')[0], '2026-11-16', 'domingo cae en la semana que empezó el lunes');
  assert.equal(weekdayOf('2026-11-21'), 6);
  assert.deepEqual(cardBox('09:30', 45, 8 * 60, 26), { top: 6 * 26, height: 3 * 26 }, 'alto proporcional a la duración');
  assert.equal(clockAt(26 * 5 + 3, 8 * 60, 26), '09:15');
  assert.deepEqual(dayRange([], '2026-11-20', []), { from: 480, to: 1200 });
  assert.deepEqual(dayRange([], '2026-11-20', [{ start: '07:15', minutes: 30 }, { start: '20:30', minutes: 60 }]), { from: 420, to: 1320 });
});

test('cupos libres desde horarios: sin choques con citas ni bloqueos, y con vigencia', () => {
  const schedules = [{ id: 1, boxId: 1, professional: 'Dr. Luis', weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '11:00', validFrom: '2026-11-01', validTo: '2026-12-31', blockMinutes: 30 }];
  const busy = [{ boxId: 1, start: '09:30', minutes: 45 }, { boxId: 2, start: '10:30', minutes: 30 }];
  const blocks = [{ id: 1, boxId: null, day: '2026-11-20', start: '10:45', end: '11:00', repeat: 'none', until: null, reason: 'x', note: '' }];
  assert.deepEqual(freeSlots(schedules, 1, '2026-11-20', busy, blocks).map(s => s.start), ['09:00'], '09:30-10:15 cita; 10:30 choca con bloqueo de todos los box');
  assert.deepEqual(freeSlots(schedules, 1, '2026-11-19', [], []).map(s => s.start), ['09:00', '09:30', '10:00', '10:30']);
  assert.equal(freeSlots(schedules, 1, '2026-11-19', [], [])[0].professional, 'Dr. Luis');
  assert.deepEqual(freeSlots(schedules, 1, '2026-11-21', [], []), [], 'sábado no está en el horario');
  assert.deepEqual(freeSlots(schedules, 1, '2027-01-04', [], []), [], 'fuera de vigencia');
  assert.deepEqual(freeSlots(schedules, 2, '2026-11-19', [], []), [], 'otro box');
});

test('bloqueos: solo ese día, cada mismo día de la semana o todos los días, hasta una fecha', () => {
  const b = (repeat, until = '2026-12-31') => ({ id: 1, boxId: 1, day: '2026-11-20', start: '13:00', end: '14:00', repeat, until, reason: 'Almuerzo', note: '' });
  assert.equal(blockOccursOn(b('none', null), '2026-11-20'), true);
  assert.equal(blockOccursOn(b('none', null), '2026-11-27'), false);
  assert.equal(blockOccursOn(b('weekly'), '2026-11-27'), true);
  assert.equal(blockOccursOn(b('weekly'), '2026-11-26'), false);
  assert.equal(blockOccursOn(b('daily'), '2026-11-26'), true);
  assert.equal(blockOccursOn(b('daily'), '2027-01-01'), false, 'después de «hasta»');
  assert.equal(blockOccursOn(b('daily'), '2026-11-19'), false, 'antes de empezar');
  assert.equal(blocksOn([b('weekly'), b('none', null)], '2026-12-04').length, 1);
  assert.equal(checkBlock({ day: '2026-11-20', start: '13:00', end: '12:00' }).ok, false);
  assert.equal(checkBlock({ day: '2026-11-20', start: '13:00', end: '14:00', repeat: 'weekly' }).ok, false, 'repetición sin «hasta»');
  assert.equal(checkBlock({ day: '2026-11-20', start: '13:00', end: '14:00', repeat: 'daily', until: '2028-01-01' }).ok, false, 'máximo un año');
  assert.deepEqual(checkBlock({ day: '2026-11-20', start: '13:00', end: '14:00', repeat: 'weekly', until: '2026-12-31' }), { ok: true, day: '2026-11-20', start: '13:00', end: '14:00', repeat: 'weekly', until: '2026-12-31' });
  assert.equal(checkSchedule({ weekdays: [], start: '09:00', end: '10:00' }).ok, false);
  assert.equal(checkSchedule({ weekdays: [1], start: '10:00', end: '09:00' }).ok, false);
  assert.equal(checkSchedule({ weekdays: [5, 1, 1], start: '09:00', end: '13:00', blockMinutes: 45 }).weekdays.join(), '1,5');
});

test('columnas: box habilitados y «Sin box» para citas sin box o de un box deshabilitado', () => {
  const boxes = [{ id: 1, enabled: true }, { id: 2, enabled: false }, { id: 3, enabled: true }];
  assert.deepEqual(columnsFor(boxes, [{ boxId: 1 }]), [{ id: 1 }, { id: 3 }]);
  assert.deepEqual(columnsFor(boxes, [{ boxId: null }]), [{ id: 1 }, { id: 3 }, { id: null }]);
  assert.deepEqual(columnsFor(boxes, [{ boxId: 2 }]).at(-1), { id: null });
  assert.equal(columnOf(new Set([1, 3]), 2), null);
  assert.equal(columnOf(new Set([1, 3]), 3), 3);
});

test('WhatsApp con números chilenos', () => {
  assert.equal(whatsappNumber('+56 9 8765 4321'), '56987654321');
  assert.equal(whatsappNumber('987654321'), '56987654321');
  assert.equal(whatsappNumber('22 345 678'), null);
  assert.equal(whatsappNumber(''), null);
});

test('migraciones solo aditivas y todo por owner_id', () => {
  for (const sql of [...BOX_SCHEMA_DDL, ...BOX_COLUMNS_DDL]) assert.match(sql, /^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN)/);
  const db = src('app/agenda-box-db.ts');
  assert.doesNotMatch(db, /DROP |DELETE FROM appointments|DELETE FROM agenda_blocks/);
  for (const m of db.matchAll(/"((?:SELECT|UPDATE|DELETE)[^"]+)"/g)) assert.match(m[1], /owner_id = \?/, m[1].slice(0, 80));
  const route = src('app/api/agenda-box/route.ts');
  assert.ok(route.includes('request.headers.get("origin")'));
  assert.ok(route.includes('owner_id = ?'));
  // Google: el box va en «location» y en la descripción del evento, también en la cola de reintentos.
  const oauth = src('app/drive-oauth.ts');
  assert.match(oauth, /location: box, description: "Box: "/);
  assert.match(oauth, /LEFT JOIN treatment_boxes b ON b\.id = a\.box_id AND b\.owner_id = a\.owner_id/);
  assert.match(src('app/calendar-two-way.ts'), /BOX_COLUMNS_DDL/);
  // La vista sigue teniendo la agenda semanal de siempre.
  const page = src('app/page.tsx');
  assert.ok(page.includes('<AgendaBoxDay') && page.includes('<WeeklyAgendaMosaic'));
  assert.ok(page.includes('"Día por box"'));
});

const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: horarios, bloqueos, cita en box (paciente nuevo), mover de box, estados y aislamiento', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
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
  sqlite.exec(`CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, rut TEXT, phone TEXT NOT NULL DEFAULT '', email TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
    CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, patient_id INTEGER NOT NULL, day TEXT, time TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, calendar_id TEXT, google_event_id TEXT, title TEXT, start_at TEXT, end_at TEXT, source_time_zone TEXT, html_link TEXT, status TEXT, all_day INTEGER, patient_id INTEGER, imported_at TEXT, source_updated_at TEXT, UNIQUE(owner_id, calendar_id, google_event_id));
    INSERT INTO patients (id, owner_id, name, phone) VALUES (1, 'A', 'Ana Pérez', '+56 9 1111 2222'), (2, 'B', 'Otro Dueño', '');
    INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at) VALUES ('A', 1, '2026-11-20', '10:00', 'Control', 'x');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const boxDb = await import('../app/box-db.ts');
  const ab = await import('../app/agenda-box-db.ts');
  const boxes = await boxDb.listBoxes('A');
  assert.deepEqual(boxes.map(b => [b.name, b.kind]), [['Box 1', 'odontologia'], ['Box 2', 'odontologia'], ['Vitacura', 'odontologia']]);
  const saved = await boxDb.saveBox('A', { id: boxes[1].id, kind: 'pabellon', color: '#64b873' });
  assert.equal(saved.ok && saved.boxes[1].kind, 'pabellon');
  assert.equal(saved.ok && saved.boxes[1].color, '#64b873');

  // Horario (profesional por defecto = dueño).
  let r = await ab.saveSchedule('A', { boxId: boxes[0].id, weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '13:00', blockMinutes: 30 }, 'Dr. Luis Rodríguez');
  assert.ok(r.ok); assert.equal(r.schedules[0].professional, 'Dr. Luis Rodríguez');
  assert.equal((await ab.saveSchedule('A', { boxId: 999, weekdays: [1], start: '09:00', end: '10:00' }, 'x')).ok, false, 'box de otro espacio');
  assert.equal((await ab.listSchedules('B')).length, 0, 'aislamiento');

  // Cita existente sin box → «Sin box».
  let list = await ab.loadBoxAppointments('A', '2026-11-16', '2026-11-22');
  assert.equal(list.length, 1); assert.equal(list[0].boxId, null); assert.equal(list[0].status, 'agendada'); assert.equal(list[0].minutes, 30);

  // Nueva cita en un box con paciente nuevo (sin Google conectado no falla).
  const created = await ab.createBoxAppointment('A', { newPatient: { name: 'Pedro Nuevo', phone: '987654321' }, day: '2026-11-20', time: '09:00', minutes: 45, boxId: boxes[0].id, reason: 'Evaluación' }, 'Dr. Luis');
  assert.ok(created.ok, created.error);
  assert.equal(created.appointment.boxId, boxes[0].id); assert.equal(created.appointment.minutes, 45); assert.equal(created.appointment.professional, 'Dr. Luis');
  assert.equal(sqlite.prepare("SELECT owner_id FROM patients WHERE name = 'Pedro Nuevo'").get().owner_id, 'A');
  assert.equal((await ab.createBoxAppointment('A', { patientId: 2, day: '2026-11-20', time: '09:00' }, 'x')).ok, false, 'paciente de otro dueño');
  assert.equal((await ab.createBoxAppointment('B', { patientId: 2, day: '2026-11-20', time: '09:00', boxId: boxes[0].id }, 'x')).ok, false, 'box de otro dueño');

  // Mover la cita antigua al Box 2 y cambiar su duración.
  const old = list[0].id;
  assert.deepEqual(await ab.updateBoxAppointment('A', old, { boxId: boxes[1].id, minutes: 60 }), { ok: true });
  assert.equal((await ab.updateBoxAppointment('B', old, { boxId: null })).ok, false, 'otro dueño no la mueve');
  list = await ab.loadBoxAppointments('A', '2026-11-16', '2026-11-22');
  const moved = list.find(a => a.id === old);
  assert.equal(moved.boxId, boxes[1].id); assert.equal(moved.minutes, 60);

  // Estados nuevos desde la tarjeta.
  assert.equal(await ab.setBoxStatus('A', 'app', old, 'ingresada'), true);
  assert.equal(await ab.setBoxStatus('B', 'app', old, 'atendida'), false);
  list = await ab.loadBoxAppointments('A', '2026-11-16', '2026-11-22');
  assert.equal(list.find(a => a.id === old).status, 'ingresada');
  assert.equal((await ab.loadBoxAppointments('B', '2026-11-16', '2026-11-22')).length, 0);

  // Bloqueo repetido cada viernes, y quitarlo (queda marcado, no se borra).
  const block = await ab.addBlock('A', { boxId: boxes[0].id, day: '2026-11-20', start: '13:00', end: '14:00', repeat: 'weekly', until: '2026-12-31', reason: 'Almuerzo' });
  assert.ok(block.ok);
  assert.equal((await ab.listBlocks('A', '2026-12-07', '2026-12-13')).length, 1);
  assert.equal((await ab.listBlocks('A', '2027-01-04', '2027-01-10')).length, 0);
  assert.equal((await ab.listBlocks('B', '2026-11-16', '2026-11-22')).length, 0);
  assert.equal(await ab.removeBlock('B', block.block.id), false);
  assert.equal(await ab.removeBlock('A', block.block.id), true);
  assert.equal((await ab.listBlocks('A', '2026-11-16', '2026-11-22')).length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM agenda_blocks').get().n, 1);
});
