import test from "node:test";
import assert from "node:assert/strict";
import { chileLocalToIso, appointmentsAsEvents } from "../lib/appointment-events.ts";
test("hora de Chile a UTC (verano, UTC-3)", () => assert.equal(chileLocalToIso("12-11-2026", "15:00"), "2026-11-12T18:00:00.000Z"));
test("hora de Chile a UTC (invierno, UTC-4)", () => assert.equal(chileLocalToIso("2026-07-10", "09:30"), "2026-07-10T13:30:00.000Z"));
test("cita de la ficha aparece como evento y no se duplica con Google", () => {
  const a = [{ id: 7, patientId: 10, day: "12-11-2026", time: "15:00", reason: "control" }];
  const [e] = appointmentsAsEvents(a, () => "Ana Pérez", []);
  assert.equal(e.title, "Ana Pérez · control"); assert.equal(e.patientId, 10);
  assert.equal(appointmentsAsEvents(a, () => "Ana", [{ ...e, id: 99 }]).length, 0);
});
test("la cita ya escrita en Google (mismo título y hora) no se duplica aunque no tenga paciente asociado", () => {
  const a = [{ id: 7, patientId: 10, day: "12-11-2026", time: "15:00", reason: "control" }];
  const google = { id: 5, title: "Ana Pérez · control", startAt: "2026-11-12T18:00:00.000Z", endAt: "2026-11-12T18:30:00.000Z", sourceTimeZone: "America/Santiago", htmlLink: null, status: "confirmed", allDay: false, patientId: null };
  assert.equal(appointmentsAsEvents(a, () => "Ana Pérez", [google]).length, 0);
});
