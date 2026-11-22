import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmationByWeek, confirmationPending, percentOf, weekMonday } from '../lib/dashboard.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const today = '2026-11-22'; // domingo

test('la semana va de lunes a domingo', () => {
  assert.equal(weekMonday('2026-11-22'), '2026-11-16');
  assert.equal(weekMonday('2026-11-23'), '2026-11-23');
  assert.equal(weekMonday('2026-12-01'), '2026-11-30');
  assert.equal(weekMonday('2026-03-01'), '2026-02-23');
});

test('porcentaje: entero redondeado; sin citas no hay porcentaje', () => {
  assert.equal(percentOf(5, 8), 63);
  assert.equal(percentOf(0, 4), 0);
  assert.equal(percentOf(0, 0), null);
});

test('confirmación por semana: usa el criterio del Dashboard (canceladas fuera; atendida y llegó cuentan)', () => {
  const list = [
    { day: '2026-11-03', patientId: 1, label: 'x', status: 'confirmada_whatsapp' },
    { day: '2026-11-04', patientId: 2, label: 'x', status: 'agendada' },
    { day: '2026-11-05', patientId: 3, label: 'x', status: 'cancelada' },
    { day: '2026-11-10', patientId: 4, label: 'x', status: 'atendida' },
    { day: '2026-11-12', patientId: 5, label: 'x', confirmed: true },
    { day: '2026-11-13', patientId: 6, label: 'x', cancelledAtSource: true },
    { day: '2026-12-01', patientId: 7, label: 'x', status: 'notificada_email' },
  ];
  assert.deepEqual(confirmationByWeek(list, new Set(), today), [
    { from: '2026-11-02', label: '2 nov – 8 nov', scheduled: 2, confirmed: 1, percent: 50 },
    { from: '2026-11-09', label: '9 nov – 15 nov', scheduled: 2, confirmed: 2, percent: 100 },
    { from: '2026-11-30', label: '30 nov – 6 dic', scheduled: 1, confirmed: 0, percent: 0 },
  ]);
});

test('una semana solo con canceladas no aparece', () => {
  assert.deepEqual(confirmationByWeek([{ day: '2026-11-03', patientId: 1, label: 'x', status: 'cancelada' }], new Set(), today), []);
});

test('próximas citas por confirmar: esperando respuesta vs sin avisar; no cuenta pasadas, confirmadas ni canceladas', () => {
  const list = [
    { day: '2026-11-21', patientId: 1, label: 'x', status: 'agendada' },              // pasada
    { day: '2026-11-23', patientId: 2, label: 'x', status: 'notificada_whatsapp' },   // esperando
    { day: '2026-11-24', patientId: 3, label: 'x', status: 'notificada_email' },      // esperando
    { day: '2026-11-25', patientId: 4, label: 'x', status: 'agendada' },              // sin avisar
    { day: '2026-11-25', patientId: 5, label: 'x' },                                  // sin estado: sin avisar
    { day: '2026-11-26', patientId: 6, label: 'x', confirmed: true },                 // confirmó por correo
    { day: '2026-11-27', patientId: 7, label: 'x', status: 'confirmada_whatsapp' },
    { day: '2026-11-28', patientId: 8, label: 'x', declined: true },
    { day: '2026-11-29', patientId: 9, label: 'x', cancelledAtSource: true },
    { day: '2026-11-30', patientId: 10, label: 'x', status: 'cancelada' },
    { day: '2026-11-22', patientId: 11, label: 'x', status: 'agendada' },              // hoy cuenta
  ];
  assert.deepEqual(confirmationPending(list, today), { awaiting: 2, unnotified: 3 });
});

test('el panel muestra la tarjeta «Tasa de confirmación» con el porcentaje, las semanas y lo pendiente', () => {
  const panel = src('components/dashboard-panel.tsx');
  assert.match(panel, /title="Tasa de confirmación"/);
  assert.match(panel, /data-testid="confirmation-rate-value"/);
  assert.match(panel, /data-testid="confirmation-week"/);
  assert.match(panel, /data-testid="confirmation-pending"/);
  const lib = src('lib/dashboard.ts');
  assert.match(lib, /confirmationRate: percentOf\(stats\.confirmed, stats\.scheduled\)/);
  assert.match(lib, /confirmationWeeks: confirmationByWeek\(list, evolutionDays, o\.today\)/);
  assert.match(lib, /confirmationPending: confirmationPending\(list, o\.today\)/);
});
