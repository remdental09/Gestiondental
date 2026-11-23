import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("agendar una cita de un paciente envía la duración elegida y el servidor la guarda y la manda a Google", () => {
  const page = read("app/page.tsx");
  assert.match(page, /action:"addAppointment",patientId:newAppt\.patientId,day:newAppt\.day,time:newAppt\.time,minutes:newAppt\.minutes/);
  const route = read("app/api/clinical/route.ts");
  const add = route.slice(route.indexOf('action === "addAppointment"'), route.indexOf('action === "addPayment"'));
  assert.match(add, /rawMinutes % 15 === 0/);
  assert.match(add, /UPDATE appointments SET minutes = \?/);
  assert.match(add, /pushAppointmentToGoogle\(ownerId, \{ id: a\.id, day, time, reason, \.\.\.\(minutes \? \{ minutes \} : \{\}\)/);
});
