import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { foldName, matchProfessional, checkProfessional, nextColor, PROFESSIONAL_COLORS, PROFESSIONALS_DDL, PROFESSIONAL_COLUMNS_DDL } from '../lib/professionals.ts';
import { freeSlots } from '../lib/agenda-box.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('nombres: sin tildes ni «Dr.», y coincidencia con la lista', () => {
  assert.equal(foldName('Dr. Luis Rodríguez'), 'luis rodriguez');
  assert.equal(foldName('Dra.  Camila  Soto'), 'camila soto');
  const list = [{ id: 1, name: 'Luis Rodríguez' }, { id: 2, name: 'Camila Soto Pérez' }];
  assert.equal(matchProfessional(list, 'Dr. Luis Rodriguez'), 1);
  assert.equal(matchProfessional(list, 'Camila Soto'), 2, 'todas las palabras contenidas');
  assert.equal(matchProfessional(list, 'Pedro'), null);
  assert.equal(matchProfessional([...list, { id: 3, name: 'Camila Soto Díaz' }], 'Camila Soto'), null, 'ambiguo → no adivina');
  assert.equal(matchProfessional(list, ''), null);
});

test('validación: nombre, duplicado, RUT y color', () => {
  const list = [{ id: 1, name: 'Luis Rodríguez' }];
  assert.equal(checkProfessional({ name: 'Al' }, list).ok, false);
  assert.equal(checkProfessional({ name: 'dr luis rodriguez' }, list).ok, false, 'duplicado');
  assert.equal(checkProfessional({ name: 'Luis Rodríguez', specialty: 'Rehabilitación' }, list, 1).ok, true, 'el mismo al editarse');
  assert.equal(checkProfessional({ name: 'Camila Soto', rut: 'abc' }, list).ok, false);
  const ok = checkProfessional({ name: ' Camila   Soto ', rut: '12.345.678-k', color: '#1e88e5', specialty: 'Endodoncia' }, list);
  assert.deepEqual(ok, { ok: true, name: 'Camila Soto', specialty: 'Endodoncia', rut: '12.345.678-K', color: '#1e88e5' });
  assert.equal(checkProfessional({ name: 'Camila Soto', color: 'rojo' }, list).color, null);
  assert.equal(nextColor([PROFESSIONAL_COLORS[0]]), PROFESSIONAL_COLORS[1]);
});

test('cupos libres llevan el profesional del horario', () => {
  const schedules = [{ id: 1, boxId: 1, professional: 'Camila Soto', professionalId: 7, weekdays: [5], start: '09:00', end: '10:00', validFrom: null, validTo: null, blockMinutes: 30 }];
  const slots = freeSlots(schedules, 1, '2026-11-20', [], []);
  assert.deepEqual(slots.map(s => [s.start, s.professionalId, s.professional]), [['09:00', 7, 'Camila Soto'], ['09:30', 7, 'Camila Soto']]);
});

test('migración aditiva, aislamiento y Google con el profesional', () => {
  for (const sql of [...PROFESSIONALS_DDL, ...PROFESSIONAL_COLUMNS_DDL]) assert.match(sql, /^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN)/);
  const db = src('app/professionals-db.ts');
  for (const m of db.matchAll(/"((?:SELECT|UPDATE|DELETE)[^"]+)"/g)) if (!m[1].startsWith('SELECT owner_id FROM professionals_seeded')) assert.match(m[1], /owner_id = \?/, m[1].slice(0, 80));
  assert.match(db, /desactívalo en vez de borrarlo/);
  const oauth = src('app/drive-oauth.ts');
  assert.match(oauth, /"Profesional: " \+ professional/);
  assert.match(oauth, /LEFT JOIN professionals pr ON pr\.id = a\.professional_id AND pr\.owner_id = a\.owner_id/);
  assert.match(src('app/calendar-two-way.ts'), /PROFESSIONAL_COLUMNS_DDL/);
  const route = src('app/api/profesionales/route.ts');
  assert.ok(route.includes('request.headers.get("origin")') && route.includes('user.userId'));
  assert.ok(src('app/page.tsx').includes('<ProfessionalsPanel/>'));
  const day = src('components/agenda-box-day.tsx');
  assert.ok(day.includes('professional-filter') && day.includes('professional-chip') && day.includes('slot-professional'));
});

const canRun = typeof nodeModule.registerHooks === 'function' && await import('node:sqlite').then(() => true, () => false);
test('con base real: siembra con el dueño, migra nombres escritos, agrega, edita, desactiva y no borra si se usó', { skip: !canRun && 'node:sqlite o registerHooks no disponibles' }, async () => {
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
    INSERT INTO patients (id, owner_id, name) VALUES (1, 'A', 'Ana Pérez');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  globalThis.__gdTestEnv = { DB: { prepare: (sql) => statement(sql) } };
  const boxDb = await import('../app/box-db.ts');
  const ab = await import('../app/agenda-box-db.ts');
  const pros = await import('../app/professionals-db.ts');
  const seed = { name: 'Luis Rodríguez', specialty: 'Rehabilitación oral', rut: '' };
  const boxes = await boxDb.listBoxes('A');

  // Horarios y citas de antes (PR #345) con el profesional en texto.
  await pros.database();
  sqlite.exec(`INSERT INTO box_schedules (owner_id, box_id, professional, weekdays, start_time, end_time, block_minutes, created_at) VALUES ('A', ${boxes[0].id}, 'Dr. Luis Rodriguez', '1,2,3', '09:00', '13:00', 30, 'x'), ('A', ${boxes[1].id}, 'Camila Soto', '5', '15:00', '19:00', 30, 'x');
    INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at, professional) VALUES ('A', 1, '2026-11-20', '10:00', 'Control', 'x', 'Camila Soto');`);

  let list = await pros.listProfessionals('A', seed);
  assert.deepEqual(list.map(p => [p.name, p.isOwner, p.active]), [['Luis Rodríguez', true, true], ['Camila Soto', false, true]], 'dueño sembrado + profesional creado desde el texto');
  assert.equal(list[0].specialty, 'Rehabilitación oral');
  const luis = list[0].id, camila = list[1].id;
  assert.deepEqual(sqlite.prepare('SELECT professional_id FROM box_schedules ORDER BY id').all().map(r => r.professional_id), [luis, camila], 'nombre escrito → mismo profesional');
  assert.equal(sqlite.prepare('SELECT professional_id FROM appointments').get().professional_id, camila);
  assert.equal((await pros.listProfessionals('A', seed)).length, 2, 'no se vuelve a sembrar ni duplica');
  assert.deepEqual((await pros.listProfessionals('B', { name: 'Otra Dueña' })).map(p => p.name), ['Otra Dueña'], 'cada espacio con su lista');

  // Agregar, editar (el texto de horarios sigue el nombre), desactivar.
  let r = await pros.saveProfessional('A', seed, { name: 'Pedro Muñoz', specialty: 'Endodoncia', rut: '12.345.678-5' });
  assert.ok(r.ok);
  const pedro = r.professionals.find(p => p.name === 'Pedro Muñoz');
  assert.notEqual(pedro.color, r.professionals.find(p => p.id === luis).color);
  r = await pros.saveProfessional('A', seed, { id: camila, name: 'Camila Soto Díaz' });
  assert.ok(r.ok);
  assert.equal(sqlite.prepare('SELECT professional FROM box_schedules WHERE professional_id = ?').get(camila).professional, 'Camila Soto Díaz');
  assert.equal((await pros.saveProfessional('B', seed, { id: camila, active: false })).ok, false, 'otro espacio no lo toca');
  assert.ok((await pros.saveProfessional('A', seed, { id: camila, active: false })).ok);
  assert.equal((await pros.getProfessional('A', camila)).active, false);

  // Borrar: solo si nunca se usó; el principal nunca.
  assert.equal((await pros.deleteProfessional('A', seed, camila)).ok, false);
  assert.match((await pros.deleteProfessional('A', seed, camila)).error, /desactívalo/);
  assert.equal((await pros.deleteProfessional('A', seed, luis)).ok, false);
  assert.ok((await pros.deleteProfessional('A', seed, pedro.id)).ok);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM professionals WHERE id = ?').get(camila).n, 1, 'Camila sigue (inactiva)');

  // Horario con profesional de la lista; no se puede elegir uno inactivo ni de otro espacio.
  r = await ab.saveSchedule('A', { boxId: boxes[2].id, professionalId: luis, weekdays: [4], start: '09:00', end: '12:00' }, seed);
  assert.ok(r.ok);
  assert.equal(r.schedules.find(s => s.boxId === boxes[2].id).professionalId, luis);
  assert.equal(r.schedules.find(s => s.boxId === boxes[1].id).professional, 'Camila Soto Díaz', 'el nombre viene de la lista');
  assert.equal((await ab.saveSchedule('A', { boxId: boxes[2].id, professionalId: camila, weekdays: [4], start: '13:00', end: '14:00' }, seed)).ok, false, 'inactiva');
  const otherPro = (await pros.listProfessionals('B', { name: 'Otra Dueña' }))[0].id;
  assert.equal((await ab.saveSchedule('A', { boxId: boxes[2].id, professionalId: otherPro, weekdays: [4], start: '13:00', end: '14:00' }, seed)).ok, false, 'de otro espacio');

  // Cita: profesional elegido o, si no, el principal; se ve con su color.
  const re = await pros.saveProfessional('A', seed, { id: camila, active: true });
  assert.ok(re.ok);
  let c = await ab.createBoxAppointment('A', { patientId: 1, day: '2026-11-20', time: '15:00', boxId: boxes[1].id, professionalId: camila }, seed);
  assert.ok(c.ok); assert.equal(c.appointment.professionalId, camila); assert.equal(c.appointment.professional, 'Camila Soto Díaz');
  c = await ab.createBoxAppointment('A', { patientId: 1, day: '2026-11-20', time: '16:00', boxId: boxes[1].id }, seed);
  assert.ok(c.ok); assert.equal(c.appointment.professionalId, luis, 'por defecto el principal');
  assert.equal((await ab.createBoxAppointment('A', { patientId: 1, day: '2026-11-20', time: '17:00', professionalId: otherPro }, seed)).ok, false);
  const day = await ab.loadBoxAppointments('A', '2026-11-16', '2026-11-22');
  const first = day.find(a => a.start === '15:00');
  assert.equal(first.professionalColor, re.professionals.find(p => p.id === camila).color);
  // Cambiar el profesional de una cita.
  assert.deepEqual(await ab.updateBoxAppointment('A', first.id, { professionalId: luis }), { ok: true });
  assert.equal((await ab.loadBoxAppointments('A', '2026-11-16', '2026-11-22')).find(a => a.id === first.id).professional, 'Luis Rodríguez');
  assert.equal((await ab.updateBoxAppointment('A', first.id, { professionalId: otherPro })).ok, false);
});
