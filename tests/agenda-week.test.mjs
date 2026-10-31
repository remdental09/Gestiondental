import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaWeekDays, mondayOfAgendaWeek, santiagoDateISO, shiftAgendaWeek } from '../app/agenda-week.ts';

test('viernes abre la semana en curso y sábado o domingo la siguiente', () => {
  assert.equal(mondayOfAgendaWeek('2026-10-30'), '2026-10-26');
  assert.equal(mondayOfAgendaWeek('2026-10-31'), '2026-11-02');
  assert.equal(mondayOfAgendaWeek('2026-11-01'), '2026-11-02');
  assert.equal(mondayOfAgendaWeek('2026-10-26'), '2026-10-26');
  assert.equal(mondayOfAgendaWeek('2026-11-02'), '2026-11-02');
});

test('la medianoche del sábado en Santiago no usa la fecha UTC', () => {
  const saturdayAfterMidnight = new Date('2026-10-31T03:13:00.000Z');
  assert.equal(santiagoDateISO(saturdayAfterMidnight), '2026-10-31');
  assert.equal(mondayOfAgendaWeek(santiagoDateISO(saturdayAfterMidnight)), '2026-11-02');
  const fridayEvening = new Date('2026-10-31T02:59:00.000Z');
  assert.equal(santiagoDateISO(fridayEvening), '2026-10-30');
  assert.equal(mondayOfAgendaWeek(santiagoDateISO(fridayEvening)), '2026-10-26');
});

test('la semana mostrada corre de lunes a domingo en Santiago', () => {
  const days = agendaWeekDays('2026-11-02');
  assert.deepEqual(days.map((day) => day.key), [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
  ]);
  assert.equal(shiftAgendaWeek('2026-10-26', 1), '2026-11-02');
  assert.equal(shiftAgendaWeek('2026-11-02', -1), '2026-10-26');
});
