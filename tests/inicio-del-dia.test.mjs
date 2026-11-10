import test from "node:test";
import assert from "node:assert/strict";
import { todayAgenda, pendingBalances, quickSearch, patientForEvent } from "../lib/today-agenda.ts";

const patients = [
  { id: 1, name: "Ana María Pérez Soto", rut: "12.345.678-5" },
  { id: 2, name: "Juan Pérez Rojas", rut: "9.876.543-K" },
  { id: 3, name: "Juan Pérez Rojas", rut: "11.111.111-1" },
];
const ev = (id, start, end, extra = {}) => ({ id, title: "Cita", startAt: start, endAt: end, status: "confirmed", allDay: false, patientId: null, ...extra });

test("la agenda de hoy usa la hora de Chile y marca ahora/siguiente", () => {
  // 2026-11-10 15:00 UTC = 12:00 en Chile (verano, UTC-3)
  const now = new Date("2026-11-10T15:00:00Z");
  const items = todayAgenda([
    ev(1, "2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z"),
    ev(2, "2026-11-10T14:30:00Z", "2026-11-10T15:30:00Z"),
    ev(3, "2026-11-10T16:00:00Z", "2026-11-10T17:00:00Z"),
    ev(4, "2026-11-10T18:00:00Z", "2026-11-10T19:00:00Z"),
    ev(5, "2026-11-11T12:00:00Z", "2026-11-11T13:00:00Z"),
    ev(6, "2026-11-10T16:00:00Z", "2026-11-10T17:00:00Z", { status: "cancelled" }),
  ], patients, now);
  assert.deepEqual(items.map(i => [i.event.id, i.state]), [[1, "pasada"], [2, "ahora"], [3, "siguiente"], [4, "luego"]]);
});

test("una cita a las 22:00 de Chile sigue siendo de hoy aunque en UTC ya sea mañana", () => {
  const now = new Date("2026-11-10T20:00:00Z");
  const items = todayAgenda([ev(1, "2026-11-11T01:00:00Z", "2026-11-11T02:00:00Z")], patients, now);
  assert.equal(items.length, 1);
});

test("el paciente de la cita se reconoce por vínculo o por nombre completo, sin adivinar ambiguos", () => {
  assert.equal(patientForEvent(ev(1, "", "", { patientId: 1 }), patients)?.id, 1);
  assert.equal(patientForEvent(ev(1, "", "", { title: "Control Ana Pérez" }), patients)?.id, 1);
  assert.equal(patientForEvent(ev(1, "", "", { title: "Juan Pérez Rojas" }), patients), null);
  assert.equal(patientForEvent(ev(1, "", "", { title: "Ana" }), patients), null);
});

test("saldos pendientes: presupuestos principales menos abonos, de mayor a menor", () => {
  const out = pendingBalances(patients, [
    { id: 1, patientId: 1, total: 500000, isAlternative: false },
    { id: 2, patientId: 1, total: 900000, isAlternative: true },
    { id: 3, patientId: 2, total: 100000, isAlternative: false },
  ], [{ patientId: 1, amount: 200000 }, { patientId: 2, amount: 100000 }]);
  assert.deepEqual(out.map(o => [o.patient.id, o.owed]), [[1, 300000]]);
});

test("búsqueda rápida por nombre en cualquier orden, sin tildes, o por RUT", () => {
  assert.deepEqual(quickSearch(patients, "perez ana").map(p => p.id), [1]);
  assert.deepEqual(quickSearch(patients, "maria").map(p => p.id), [1]);
  assert.deepEqual(quickSearch(patients, "9876543k").map(p => p.id), [2]);
  assert.deepEqual(quickSearch(patients, "a"), []);
});

import { agendaForDay, nextDay, whatsappNumber, whatsappLink, confirmationMessage } from "../lib/today-agenda.ts";

test("teléfonos chilenos: solo celulares válidos, en formato internacional", () => {
  assert.equal(whatsappNumber("+56 9 8765 4321"), "56987654321");
  assert.equal(whatsappNumber("9 8765 4321"), "56987654321");
  assert.equal(whatsappNumber("56987654321"), "56987654321");
  assert.equal(whatsappNumber("22 123 4567"), null); // fijo
  assert.equal(whatsappNumber(""), null);
  assert.equal(whatsappNumber(undefined), null);
});

test("el mensaje usa el nombre, el día y la hora de Chile y el enlace va codificado", () => {
  // 2026-11-11 18:30 UTC = 15:30 en Chile (UTC-3)
  const msg = confirmationMessage({ patientName: "Ana María Pérez", startAt: "2026-11-11T18:30:00Z", clinicName: "Clínica Sonrisa" });
  assert.match(msg, /^Hola Ana, le recuerdo su cita el miércoles 11 de noviembre a las 15:30 en Clínica Sonrisa\./);
  const link = whatsappLink("987654321", msg);
  assert.ok(link.startsWith("https://wa.me/56987654321?text=Hola%20Ana"));
  assert.equal(whatsappLink("221234567", msg), null);
});

test("las citas de mañana se calculan por día de Chile", () => {
  assert.equal(nextDay("2026-11-30"), "2026-12-01");
  const items = agendaForDay([
    ev(1, "2026-11-11T12:00:00Z", "2026-11-11T13:00:00Z"),
    ev(2, "2026-11-12T01:30:00Z", "2026-11-12T02:30:00Z"), // 22:30 del 11 en Chile
    ev(3, "2026-11-12T12:00:00Z", "2026-11-12T13:00:00Z"),
  ], patients, "2026-11-11");
  assert.deepEqual(items.map(i => i.event.id), [1, 2]);
});
