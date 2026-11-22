import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  confirmationText, confirmationLink, statusAfterAsking, canMarkConfirmed, confirmationSummary, longDayLabel,
} from '../lib/confirmacion-whatsapp.ts';
import { statusDenied } from '../lib/role-policy.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const base = { patientName: 'Ana María Pérez Soto', day: '2026-11-24', start: '10:30', clinicName: 'Clínica Demo' };

test('el mensaje lleva solo nombre de pila, día, hora y clínica (sin datos clínicos)', () => {
  const text = confirmationText(base);
  assert.match(text, /^Hola Ana, le escribimos de Clínica Demo/);
  assert.match(text, /martes 24 de noviembre a las 10:30/);
  assert.doesNotMatch(text, /Pérez|Soto|María/);
  assert.match(text, /confirma su asistencia/);
});

test('sin clínica ni nombre el mensaje sigue siendo válido', () => {
  const text = confirmationText({ patientName: '  ', day: '2026-11-24', start: '09:00' });
  assert.match(text, /^Hola, le escribimos para recordarle su cita el martes 24 de noviembre a las 09:00/);
  assert.equal(longDayLabel('no-es-fecha'), 'no-es-fecha');
});

test('el enlace usa un celular chileno válido y trae el mensaje codificado; sin celular no hay enlace', () => {
  const link = confirmationLink('+56 9 1234 5678', base);
  assert.ok(link.startsWith('https://wa.me/56912345678?text='));
  assert.equal(decodeURIComponent(link.split('?text=')[1]), confirmationText(base));
  assert.equal(confirmationLink('22345678', base), null, 'teléfono fijo: no es WhatsApp');
  assert.equal(confirmationLink('', base), null);
  assert.equal(confirmationLink(null, base), null);
});

test('al pedir confirmación solo una cita «agendada» pasa a «notificada por WhatsApp»', () => {
  assert.equal(statusAfterAsking('agendada'), 'notificada_whatsapp');
  for (const status of ['notificada_whatsapp', 'notificada_email', 'confirmada', 'confirmada_whatsapp', 'en_espera', 'ingresada', 'atendida', 'cancelada', 'inasistida', 'reagendada'])
    assert.equal(statusAfterAsking(status), null, `${status} no cambia al abrir el chat`);
});

test('«Ya confirmó» solo mientras la cita siga pendiente', () => {
  for (const status of ['agendada', 'notificada_whatsapp', 'notificada_email']) assert.equal(canMarkConfirmed(status), true);
  for (const status of ['confirmada', 'confirmada_email', 'confirmada_whatsapp', 'en_espera', 'ingresada', 'atendida', 'cancelada', 'inasistida', 'reagendada']) assert.equal(canMarkConfirmed(status), false);
});

test('porcentaje de confirmación: no cuenta canceladas, reagendadas ni inasistidas; llegó/atendida cuentan como confirmadas', () => {
  const list = [
    'agendada', 'notificada_whatsapp', 'notificada_email', 'confirmada_whatsapp', 'confirmada', 'en_espera', 'ingresada', 'atendida',
    'cancelada', 'reagendada', 'inasistida',
  ].map(status => ({ status }));
  const s = confirmationSummary(list);
  assert.deepEqual(s, { total: 8, confirmed: 5, waiting: 2, unnotified: 1, percent: 63 });
  assert.equal(s.confirmed + s.waiting + s.unnotified, s.total);
});

test('día sin citas: no hay porcentaje (no se muestra 0 %)', () => {
  assert.deepEqual(confirmationSummary([]), { total: 0, confirmed: 0, waiting: 0, unnotified: 0, percent: null });
  assert.equal(confirmationSummary([{ status: 'cancelada' }]).percent, null);
});

test('la asistente no puede marcar estados de confirmación (el servidor los rechaza); recepción sí', () => {
  assert.ok(statusDenied('asistente', 'notificada_whatsapp'));
  assert.ok(statusDenied('asistente', 'confirmada_whatsapp'));
  assert.equal(statusDenied('recepcion', 'notificada_whatsapp'), null);
  assert.equal(statusDenied('recepcion', 'confirmada_whatsapp'), null);
  assert.equal(statusDenied('dentista', 'confirmada_whatsapp'), null);
});

test('la agenda por box ofrece pedir confirmación, «Ya confirmó» y el porcentaje, y la página le pasa el nombre de la clínica', () => {
  const day = src('components/agenda-box-day.tsx');
  assert.match(day, /data-testid="ask-confirm"/);
  assert.match(day, /data-testid="mark-confirmed"/);
  assert.match(day, /data-testid="confirm-rate"/);
  assert.match(day, /confirmationSummary\(todays\)/);
  assert.match(day, /statusAfterAsking/);
  assert.match(day, /selectableStatuses\(spaceRole, \["confirmada_whatsapp"\]/, 'la asistente no ve estos botones');
  assert.match(src('app/page.tsx'), /<AgendaBoxDay spaceRole=\{spaceRole\} clinicName=\{clinicName\}/);
});
