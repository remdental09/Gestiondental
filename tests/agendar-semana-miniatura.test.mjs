import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocksByDay, conflictsWith, freeSummary, proposedBlock, weekMonday, timeAtOffset, gridHours } from "../lib/appointment-week.ts";

const ev = (id, start, end, extra = {}) => ({ id, title: `Cita ${id}`, startAt: start, endAt: end, ...extra });

test("weekMonday no salta de semana en fin de semana", () => {
  assert.equal(weekMonday("2026-11-21"), "2026-11-16");
  assert.equal(weekMonday("2026-11-22"), "2026-11-16");
  assert.equal(weekMonday("2026-11-16"), "2026-11-16");
});

test("blocksByDay usa hora de Chile y omite canceladas y todo el día", () => {
  // 2026-11-17 13:00Z = 10:00 Chile (UTC-3 en verano)
  const out = blocksByDay([ev(1, "2026-11-17T13:00:00Z", "2026-11-17T14:00:00Z"), ev(2, "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z", { status: "cancelled" }), ev(3, "2026-11-17T00:00:00Z", "2026-11-18T00:00:00Z", { allDay: true })], "2026-11-16");
  assert.deepEqual(out["2026-11-17"].map(b => [b.id, b.start, b.end]), [[1, 600, 660]]);
});

test("conflictos y tiempo libre", () => {
  const blocks = [{ id: 1, title: "A", start: 600, end: 660 }, { id: 2, title: "B", start: 660, end: 720 }];
  assert.equal(conflictsWith(blocks, proposedBlock("2026-11-17", "10:30", 30)).length, 1);
  assert.equal(conflictsWith(blocks, proposedBlock("2026-11-17", "12:00", 30)).length, 0);
  assert.equal(conflictsWith(blocks, proposedBlock("2026-11-17", "09:30", 30)).length, 0);
  const free = freeSummary(blocks);
  assert.equal(free.freeMinutes, 600 - 120);
  assert.deepEqual(free.largest, { start: 720, end: 1140 });
});

test("grilla se amplía y el toque se redondea a 15 min", () => {
  assert.deepEqual(gridHours({}, { day: "2026-11-17", start: 420, end: 450 }), { startHour: 7, endHour: 20 });
  assert.equal(timeAtOffset(14, 18, 8, 20), "08:45");
  assert.equal(timeAtOffset(-5, 18, 8, 20), "08:00");
});

test("el diálogo Agendar cita incluye la miniatura conectada a la fecha y hora", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<AppointmentWeekMini events=\{agendaEvents\}[^>]*onPick=\{\(day,time\)=>setNewAppt\(/);
});

test("la vista vuelve a la semana del día elegido y el diálogo hace scroll", () => {
  const comp = readFileSync(new URL("../components/appointment-week-mini.tsx", import.meta.url), "utf8");
  assert.match(comp, /nav\.anchor === day \? nav\.offset : 0/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /open=\{!!newAppt\}[^]*?<DialogContent data-testid="appt-dialog" className=\{"max-h-\[94dvh\] overflow-y-auto"/);
});

test("los nombres de las citas se leen: en los bloques y en la lista del día", () => {
  const comp = readFileSync(new URL("../components/appointment-week-mini.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(comp, /expanded \? block\.title : ""/);
  assert.match(comp, /aria-label="Citas de ese día"/);
});

test("«Ampliar» ensancha el diálogo de Agendar cita y agranda la semana (con domingo y horas legibles)", () => {
  const mini = readFileSync(new URL("../components/appointment-week-mini.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(mini, /onExpandedChange\?\.\(value\)/);
  assert.match(mini, /expanded \|\| index < 6/, "ampliada muestra la semana completa");
  assert.match(page, /apptWeekWide\?" sm:max-w-\[min\(80rem,96vw\)\]"/, "el diálogo se ensancha al ampliar");
  assert.match(page, /expanded=\{apptWeekWide\} onExpandedChange=\{setApptWeekWide\}/);
  assert.match(page, /if\(!open\)\{setNewAppt\(null\);setApptWeekWide\(false\)\}/, "al cerrar vuelve al tamaño normal");
});
