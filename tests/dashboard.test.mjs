import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appointmentStats, appointmentType, ageGroup, ageOn, budgetBuckets, buildDashboard, clp, isoDay, monthRange, sumBy } from '../lib/dashboard.ts';

const today = '2026-11-19';

test('rango del mes y fechas', () => {
  assert.deepEqual(monthRange(2026, 11), { from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(monthRange(2026, 12), { from: '2026-12-01', to: '2027-01-01' });
  assert.equal(isoDay('05-11-2026'), '2026-11-05');
  assert.equal(isoDay('2026-11-05T10:00:00Z'), '2026-11-05');
  assert.equal(clp(8638425), '$ 8.638.425');
});

test('efectividad: asistida por marca o por evolución; inasistida solo si se marcó; sin registro no se inventa', () => {
  const evo = new Set(['1|2026-11-03']);
  const s = appointmentStats([
    { day: '2026-11-03', patientId: 1, label: 'Control' },                          // evolución ese día → efectiva
    { day: '2026-11-04', patientId: 2, label: 'x', status: 'atendida' },            // marcada atendida
    { day: '2026-11-05', patientId: 3, label: 'x', status: 'inasistida' },          // marcada inasistida
    { day: '2026-11-06', patientId: 4, label: 'x' },                                // pasada sin registro
    { day: '2026-11-25', patientId: 5, label: 'x', confirmed: true },               // futura confirmada
    { day: '2026-11-07', patientId: 6, label: 'x', cancelledAtSource: true },       // cancelada en Calendar
    { day: '2026-11-08', patientId: 7, label: 'x', status: 'cancelada' },           // cancelada a mano
    { day: '2026-11-09', patientId: 8, label: 'x', declined: true },                // avisó que no viene
  ], evo, today);
  assert.equal(s.scheduled, 5);
  assert.equal(s.effective, 2);
  assert.equal(s.noShow, 1);
  assert.equal(s.noRecord, 1);
  assert.equal(s.upcoming, 1);
  assert.equal(s.cancelled, 3);
  assert.equal(s.confirmed, 2); // atendida cuenta como confirmada + la futura confirmada
  assert.equal(s.unconfirmed, 3);
  assert.equal(s.attendanceMarked, 3);
});

test('tipo de atención por motivo', () => {
  assert.equal(appointmentType('Urgencia dental'), 'Urgencia');
  assert.equal(appointmentType('Control 6 meses'), 'Control');
  assert.equal(appointmentType('Evaluación inicial'), 'Diagnóstico / evaluación');
  assert.equal(appointmentType('Control ortodoncia'), 'Control');
  assert.equal(appointmentType('Instalación brackets'), 'Ortodoncia');
  assert.equal(appointmentType('Exodoncia 3.8'), 'Tratamiento');
  assert.equal(appointmentType('Paciente X'), 'Sin especificar');
});

test('grupos etarios: menor de 17, 17 a 40, mayor de 40', () => {
  assert.equal(ageOn('2010-11-20', today), 15);
  assert.equal(ageGroup('2009-11-20', today), 'Menor de 17'); // cumple 17 mañana
  assert.equal(ageGroup('2009-11-19', today), '17 a 40');
  assert.equal(ageGroup('1986-01-01', today), '17 a 40');     // 40
  assert.equal(ageGroup('1985-11-18', today), 'Mayor de 40'); // 41
  assert.equal(ageGroup('', today), 'Sin fecha de nacimiento');
  assert.equal(ageGroup('20-05-1990', today), '17 a 40');
});

test('presupuestos: pendientes, iniciados y terminados (estado del PR #337)', () => {
  const b = (id, items, extra = {}) => ({ id, patientId: 1, items, status: 'Borrador', createdOn: '2026-11-01', isAlternative: false, authorId: '', ...extra });
  const it = done => ({ label: 'P', amount: 1000, ...(done ? { doneOn: '2026-11-10' } : {}) });
  const r = budgetBuckets([
    b(1, [it(false)]), b(2, [it(true), it(false)]), b(3, [it(true)]), b(4, [it(false)], { status: 'Alta' }),
    b(5, [it(false)], { createdOn: '2026-01-01' }), b(6, [it(true)], { isAlternative: true }),
  ], today, 90);
  assert.deepEqual(r, { pendientes: 2, iniciados: 1, terminados: 2 });
});

test('sumas por grupo ordenadas', () => {
  assert.deepEqual(sumBy([{ k: 'A', v: 10 }, { k: 'B', v: 30 }, { k: 'A', v: 5 }, { k: 'C', v: 0 }], r => r.k, r => r.v), [{ label: 'B', amount: 30 }, { label: 'A', amount: 15 }]);
});

test('dashboard completo: mes, profesional, saldos, acciones y sin inventar inasistencias', () => {
  const rows = {
    patients: [
      { id: 1, name: 'Paciente Uno', birthDate: '2012-01-01', createdAt: '2026-11-02T15:00:00.000Z' },
      { id: 2, name: 'Paciente Dos', birthDate: '1970-01-01', createdAt: '2026-10-02T15:00:00.000Z' },
    ],
    calendar: [
      { id: 10, startDay: '2026-11-03', startMinute: '2026-11-03T10:00', allDay: false, status: 'confirmed', patientId: 1, title: 'Paciente Uno · Control' },
      { id: 11, startDay: '2026-11-04', startMinute: '2026-11-04T10:00', allDay: false, status: 'cancelled', patientId: 2, title: 'Paciente Dos' },
      { id: 12, startDay: '2026-10-04', startMinute: '2026-10-04T10:00', allDay: false, status: 'confirmed', patientId: 2, title: 'fuera de mes' },
    ],
    appointments: [
      { id: 5, patientId: 1, day: '2026-11-03', startMinute: '2026-11-03T10:00', reason: 'Control' }, // misma cita ya en Calendar
      { id: 6, patientId: 2, day: '2026-11-20', startMinute: '2026-11-20T09:00', reason: 'Urgencia' },
    ],
    evolutions: [{ patientId: 1, clinicalDate: '2026-11-03' }],
    budgets: [
      { id: 100, patientId: 1, items: [{ label: 'Resina', amount: 40000, doneOn: '2026-11-03' }, { label: 'Resina', amount: 40000 }], status: 'Borrador', createdOn: '2026-11-03', isAlternative: false, authorId: '', authorName: '' },
      { id: 101, patientId: 2, items: [{ label: 'Corona', amount: 300000, doneOn: '2026-11-05' }], status: 'Borrador', createdOn: '2026-09-01', isAlternative: false, authorId: 'pro-2', authorName: 'Dra. Ejemplo' },
    ],
    payments: [{ budgetId: 100, amount: 10000, method: 'efectivo', paidOn: '2026-11-03' }, { budgetId: 101, amount: 100000, method: 'transferencia', paidOn: '2026-11-05' }],
    profiles: new Map([[2, { insurance: 'Fonasa', agreement: '', branch: '' }]]),
    confirmedEvents: new Set([10]),
    declinedEvents: new Set(),
    attendance: {},
  };
  const opts = { year: 2026, month: 11, today, validityDays: 90, professional: '', titularId: 'owner-1', titularName: 'Titular Ejemplo', clinicName: 'Clínica Ejemplo', methodLabel: m => ({ efectivo: 'Efectivo', transferencia: 'Transferencia' })[m] ?? m };
  const d = buildDashboard(rows, opts);
  assert.equal(d.kpis.patientsCreated, 1);
  assert.equal(d.kpis.scheduled, 2);
  assert.equal(d.kpis.effective, 1);
  assert.equal(d.kpis.cancelled, 1);
  assert.equal(d.kpis.noShow, null); // nada marcado → «Sin datos»
  assert.equal(d.pagos.budgetsCreated, 1);
  assert.equal(d.pagos.incomeTotal, 110000);
  assert.deepEqual(d.pagos.income.map(s => [s.label, s.value]), [['Efectivo', 10000], ['Transferencia', 100000]]);
  assert.deepEqual(d.pagos.balancesByProfessional, [{ label: 'Dra. Ejemplo', amount: 200000 }, { label: 'Titular Ejemplo', amount: 30000 }]);
  assert.deepEqual(d.pagos.balancesByInsurance, [{ label: 'Fonasa', amount: 200000 }, { label: 'Sin previsión registrada', amount: 30000 }]);
  assert.equal(d.acciones.total, 2);
  assert.deepEqual(d.acciones.byAge.map(s => [s.label, s.value]), [['Menor de 17', 1], ['Mayor de 40', 1]]);
  assert.deepEqual(d.acciones.byBranch.map(s => [s.label, s.value]), [['Clínica Ejemplo', 2]]);
  assert.deepEqual(d.professionals.map(p => p.name), ['Titular Ejemplo', 'Dra. Ejemplo']);
  // Filtro por profesional: solo sus planes, pagos y acciones.
  const only = buildDashboard(rows, { ...opts, professional: 'pro-2' });
  assert.equal(only.pagos.incomeTotal, 100000);
  assert.equal(only.acciones.total, 1);
  assert.deepEqual(only.pagos.balancesByProfessional, [{ label: 'Dra. Ejemplo', amount: 200000 }]);
  // Con una marca de asistencia, la inasistencia ya tiene datos.
  const marked = buildDashboard({ ...rows, attendance: { 'app:6': 'inasistida' } }, opts);
  assert.equal(marked.kpis.noShow, 1);
});

test('integración: sección Dashboard, ruta aislada por espacio y estado de citas en la agenda', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /\{name:"Dashboard",icon:BarChart3\}/);
  assert.match(page, /section==="Dashboard"&&<Suspense[\s\S]{0,200}<DashboardPanel\/>/);
  assert.match(page, /statuses=\{attendance\} onStatus=\{setAgendaStatus\}/);
  assert.match(readFileSync(new URL('../lib/app-url.ts', import.meta.url), 'utf8'), /Dashboard: "dashboard"/);
  const route = readFileSync(new URL('../app/api/dashboard/route.ts', import.meta.url), 'utf8');
  for (const sql of route.match(/"SELECT[^"]*"/g)) assert.match(sql, /owner_id = \?/, sql);
  const att = readFileSync(new URL('../app/attendance-db.ts', import.meta.url), 'utf8');
  for (const sql of att.match(/"(SELECT|DELETE|INSERT)[^"]*"/g)) assert.match(sql, /owner_id/, sql);
  assert.doesNotMatch(att, /DROP |ALTER /);
  assert.match(readFileSync(new URL('../app/api/asistencia/route.ts', import.meta.url), 'utf8'), /sameOrigin\(request\)/);
});
