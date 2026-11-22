import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCallLists, agoLabel, daysSince, recentlyContacted, callMessage, isCallList, CALL_LISTS, INACTIVE_MONTHS } from '../lib/call-lists.ts';
import { apiDenied } from '../lib/role-policy.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const today = '2026-11-22';
const item = (over = {}) => ({ label: 'Prestación', amount: 10000, ...over });
const patient = (id, name, over = {}) => ({ id, name, phone: '+56 9 1234 5678', createdAt: '2025-01-10T12:00:00.000Z', ...over });
const rows = (over = {}) => ({
  today, validityDays: 90, patients: [], visits: [], withFutureAppointment: new Set(), budgets: [], payments: [], contacts: [], ...over,
});

test('sin cita futura: vino hace poco y no tiene cita; con tratamiento a medias va primero', () => {
  const lists = buildCallLists(rows({
    patients: [patient(1, 'Ana Pérez'), patient(2, 'Bruno Soto'), patient(3, 'Carla Díaz'), patient(4, 'Diego Rojas')],
    visits: [{ patientId: 1, day: '2026-09-01' }, { patientId: 2, day: '2026-05-01' }, { patientId: 3, day: '2026-10-20' }, { patientId: 4, day: '2026-11-01' }],
    withFutureAppointment: new Set([4]),
    budgets: [{ id: 10, patientId: 3, status: '', createdOn: '2026-09-01', isAlternative: false, items: [item({ doneOn: '2026-10-20' }), item()] }],
  }));
  assert.deepEqual(lists.sinCita.map(e => e.name), ['Carla Díaz', 'Bruno Soto', 'Ana Pérez']);
  assert.equal(lists.sinCita[0].inTreatment, true);
  assert.match(lists.sinCita[0].detail, /tratamiento a medias/);
  assert.equal(lists.inactivos.length, 0);
});

test('inactivos: más de N meses sin venir (o nunca vino y la ficha es antigua); los más recientes primero', () => {
  const base = rows({
    patients: [patient(1, 'Ana'), patient(2, 'Bruno'), patient(3, 'Carla', { createdAt: '2026-11-01T12:00:00.000Z' }), patient(4, 'Diego')],
    visits: [{ patientId: 1, day: '2025-02-01' }, { patientId: 2, day: '2025-09-01' }],
  });
  const year = buildCallLists(base, { inactiveMonths: 12 });
  assert.deepEqual(year.inactivos.map(e => e.name), ['Bruno', 'Ana', 'Diego'], 'Carla es nueva: no es inactiva; Diego nunca vino y va al final');
  assert.match(year.inactivos[2].detail, /Sin visitas registradas/);
  const six = buildCallLists(base, { inactiveMonths: 6 });
  assert.ok(six.inactivos.some(e => e.name === 'Bruno'));
  assert.equal(six.sinCita.length, 0);
  const long = buildCallLists(base, { inactiveMonths: 24 });
  assert.deepEqual(long.sinCita.map(e => e.name), ['Ana', 'Bruno'], 'con 24 meses ambos cuentan como del último período (el que lleva más tiempo sin volver, primero)');
});

test('una cita futura saca a la persona de «sin cita» e «inactivos»', () => {
  const lists = buildCallLists(rows({
    patients: [patient(1, 'Ana'), patient(2, 'Bruno')],
    visits: [{ patientId: 1, day: '2026-10-01' }, { patientId: 2, day: '2024-01-01' }],
    withFutureAppointment: new Set([1, 2]),
  }));
  assert.equal(lists.sinCita.length, 0);
  assert.equal(lists.inactivos.length, 0);
});

test('las visitas futuras no cuentan como «última visita»', () => {
  const lists = buildCallLists(rows({ patients: [patient(1, 'Ana')], visits: [{ patientId: 1, day: '2026-12-15' }, { patientId: 1, day: '2026-10-01' }] }));
  assert.match(lists.sinCita[0].detail, /hace 1 mes|hace 52 días|hace 2 meses/);
});

test('presupuestos sin iniciar: solo principales sin nada realizado y sin cita futura; vigentes primero, vencidos al final', () => {
  const lists = buildCallLists(rows({
    patients: [patient(1, 'Ana'), patient(2, 'Bruno'), patient(3, 'Carla'), patient(4, 'Diego'), patient(5, 'Eva')],
    budgets: [
      { id: 1, patientId: 1, status: '', createdOn: '2026-11-10', isAlternative: false, items: [item(), item()] },       // vigente
      { id: 2, patientId: 2, status: '', createdOn: '2026-06-01', isAlternative: false, items: [item()] },                 // vencido
      { id: 3, patientId: 3, status: '', createdOn: '2026-11-01', isAlternative: true, items: [item()] },                 // alternativa
      { id: 4, patientId: 4, status: '', createdOn: '2026-11-05', isAlternative: false, items: [item({ doneOn: '2026-11-06' })] }, // ya iniciado
      { id: 5, patientId: 5, status: '', createdOn: '2026-11-15', isAlternative: false, items: [item()] },                 // con cita futura
      { id: 6, patientId: 1, status: '', createdOn: '2026-11-12', isAlternative: false, items: [] },                       // vacío
    ],
    withFutureAppointment: new Set([5]),
  }));
  assert.deepEqual(lists.presupuestos.map(e => [e.name, e.expired]), [['Ana', false], ['Bruno', true]]);
  assert.match(lists.presupuestos[0].detail, /\$ 20\.000/);
  assert.match(lists.presupuestos[1].detail, /vencido/);
  assert.match(lists.presupuestos[0].message, /presupuesto que le entregamos el 10 de noviembre de 2026/);
});

test('morosos: lo realizado menos lo pagado, por paciente, de mayor a menor; lo no iniciado no cuenta', () => {
  const lists = buildCallLists(rows({
    patients: [patient(1, 'Ana'), patient(2, 'Bruno'), patient(3, 'Carla')],
    budgets: [
      { id: 1, patientId: 1, status: '', createdOn: '2026-09-01', isAlternative: false, items: [item({ doneOn: '2026-09-10', amount: 50000 }), item({ amount: 90000 })] },
      { id: 2, patientId: 1, status: '', createdOn: '2026-10-01', isAlternative: false, items: [item({ doneOn: '2026-10-10', amount: 30000 })] },
      { id: 3, patientId: 2, status: '', createdOn: '2026-10-01', isAlternative: false, items: [item({ doneOn: '2026-10-10', amount: 100000 })] },
      { id: 4, patientId: 3, status: '', createdOn: '2026-10-01', isAlternative: false, items: [item({ doneOn: '2026-10-10', amount: 20000 })] },
    ],
    payments: [{ budgetId: 1, amount: 20000, paidOn: '2026-10-01' }, { budgetId: 3, amount: 100000, paidOn: '2026-11-02' }],
  }));
  assert.deepEqual(lists.morosos.map(e => [e.name, e.owed]), [['Ana', 60000], ['Carla', 20000]]);
  assert.match(lists.morosos[0].detail, /Debe \$ 60\.000 · último pago/);
  assert.match(lists.morosos[1].detail, /sin pagos registrados/);
  assert.match(lists.morosos[0].message, /saldo pendiente de \$ 60\.000/);
});

test('contactos: el último contacto por lista queda en la fila y se oculta por 14 días', () => {
  const lists = buildCallLists(rows({
    patients: [patient(1, 'Ana')], visits: [{ patientId: 1, day: '2026-10-01' }],
    contacts: [{ patientId: 1, list: 'sinCita', day: '2026-11-10' }, { patientId: 1, list: 'sinCita', day: '2026-11-20' }, { patientId: 1, list: 'morosos', day: '2026-11-21' }],
  }));
  assert.equal(lists.sinCita[0].contactedOn, '2026-11-20');
  assert.equal(recentlyContacted('2026-11-20', today), true);
  assert.equal(recentlyContacted('2026-11-08', today), false);
  assert.equal(recentlyContacted(null, today), false);
});

test('WhatsApp: celular chileno válido arma el enlace con el mensaje; sin celular no hay enlace; sin datos clínicos', () => {
  const lists = buildCallLists(rows({ patients: [patient(1, 'Ana María Pérez', { phone: '912345678' }), patient(2, 'Bruno', { phone: '22345678' })], visits: [{ patientId: 1, day: '2026-10-01' }, { patientId: 2, day: '2026-10-01' }] }), { clinicName: 'Clínica Demo' });
  const [ana, bruno] = lists.sinCita;
  assert.ok(ana.whatsapp.startsWith('https://wa.me/56912345678?text='));
  assert.equal(decodeURIComponent(ana.whatsapp.split('?text=')[1]), ana.message);
  assert.match(ana.message, /^Hola Ana, le escribimos de Clínica Demo\./);
  assert.doesNotMatch(ana.message, /Pérez|María/);
  assert.equal(bruno.whatsapp, null);
  assert.match(callMessage.inactivos('Luis Gómez'), /^Hola Luis, le escribimos\./);
});

test('etiquetas de tiempo', () => {
  assert.equal(agoLabel(0), 'hoy');
  assert.equal(agoLabel(1), 'hace 1 día');
  assert.equal(agoLabel(12), 'hace 12 días');
  assert.equal(agoLabel(152), 'hace 5 meses');
  assert.equal(agoLabel(430), 'hace 1 año y 2 meses');
  assert.equal(agoLabel(730), 'hace 2 años');
  assert.equal(agoLabel(-3), '');
  assert.equal(daysSince('2026-11-01', '2026-11-22'), 21);
  assert.ok(Number.isNaN(daysSince('x', today)));
});

test('listas válidas y períodos de inactividad', () => {
  assert.deepEqual([...CALL_LISTS], ['sinCita', 'inactivos', 'presupuestos', 'morosos']);
  assert.ok(isCallList('morosos'));
  assert.equal(isCallList('otra'), false);
  assert.deepEqual([...INACTIVE_MONTHS], [6, 12, 18, 24]);
});

test('permisos: recepción usa /api/llamar; la asistente no (ni leer ni marcar)', () => {
  assert.equal(apiDenied('recepcion', 'GET', '/api/llamar'), null);
  assert.equal(apiDenied('recepcion', 'POST', '/api/llamar'), null);
  assert.ok(apiDenied('asistente', 'GET', '/api/llamar'));
  assert.ok(apiDenied('asistente', 'POST', '/api/llamar'));
  assert.equal(apiDenied('dentista', 'GET', '/api/llamar'), null);
  const route = src('app/api/llamar/route.ts');
  assert.match(route, /spaceRoleOf\(user\) === "asistente"/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /ownedPatient\(user\.userId, body\.patientId\)/);
  assert.match(route, /WHERE owner_id = \?/);
});

test('tabla aditiva: migración 0019 con el mismo DDL que la app y entrada en el diario', () => {
  const sql = src('drizzle/0019_call_contacts.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `call_contacts`/);
  assert.doesNotMatch(sql, /DROP|DELETE|ALTER/i);
  const journal = JSON.parse(src('drizzle/meta/_journal.json'));
  const at = journal.entries.findIndex(entry => entry.tag === '0019_call_contacts');
  assert.ok(at > 0, 'la migración 0019 sigue en el diario');
  const last = journal.entries[at];
  assert.equal(last.idx, at);
  assert.ok(last.when > journal.entries[at - 1].when);
  assert.match(src('app/call-lists-db.ts'), /CREATE TABLE IF NOT EXISTS call_contacts/);
});

test('la sección Controles ofrece «A quién llamar» salvo a la asistente', () => {
  const section = src('components/controls-section.tsx');
  assert.match(section, /role !== "asistente"/);
  assert.match(section, /A quién llamar/);
  assert.match(src('app/page.tsx'), /<ControlsSection key=/);
  const ui = src('components/call-lists.tsx');
  for (const id of ['call-whatsapp', 'call-phone', 'call-done', 'call-undo', 'call-unassigned']) assert.match(ui, new RegExp(`data-testid="${id}"`));
});
