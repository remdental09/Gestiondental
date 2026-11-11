import test from "node:test";
import assert from "node:assert/strict";
import { abbreviateName, buildSnapshot, changeCount, diffSnapshots, digestDays, digestEmail } from "../lib/agenda-digest.ts";

const ev = (id, startAt, title = "Cita", extra = {}) => ({ id, title, startAt, endAt: new Date(Date.parse(startAt) + 45 * 60000).toISOString(), status: "confirmed", allDay: false, patientId: null, ...extra });
const patients = [{ id: 1, name: "Olga Cea Zúñiga" }, { id: 2, name: "Katherinne Saravia" }];
const days = digestDays("2026-11-11");

test("la ventana son 7 días que incluyen hoy, en hora de Chile", () => {
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-11-11");
  assert.equal(days[6], "2026-11-17");
});

test("la foto toma solo citas confirmadas de la ventana, ordenadas, con nombre abreviable", () => {
  const events = [
    ev(3, "2026-11-12T18:00:00Z", "Katherinne Saravia control"),
    ev(1, "2026-11-12T13:00:00Z", "Olga Cea Zúñiga"),
    ev(9, "2026-11-12T14:00:00Z", "Cancelada", { status: "cancelled" }),
    ev(8, "2026-11-30T14:00:00Z", "Fuera de la semana"),
  ];
  const snap = buildSnapshot({ events, patients, days });
  assert.deepEqual(snap.map((e) => [e.id, e.label]), [[1, "Olga Cea Zúñiga"], [3, "Katherinne Saravia"]]);
  // Las citas de hoy también salen, aunque ya hayan pasado.
  assert.deepEqual(buildSnapshot({ events: [ev(7, "2026-11-11T13:00:00Z", "Violeta Concha")], patients, days }).map((e) => e.id), [7]);
  assert.equal(buildSnapshot({ events, patients, days, abbreviate: true })[0].label, "Olga C. Z.");
  assert.equal(abbreviateName("Luis Paul Rodríguez"), "Luis P. R.");
});

test("el cambio: cita nueva, cambiada de hora y de día, cancelada; lo que pasó o entró por el final no cuenta", () => {
  const prev = buildSnapshot({ events: [ev(1, "2026-11-12T13:00:00Z", "Olga Cea Zúñiga"), ev(2, "2026-11-13T13:00:00Z", "Katherinne Saravia"), ev(3, "2026-11-14T13:00:00Z", "Cita tres"), ev(4, "2026-11-10T13:00:00Z", "Ya pasó")], patients, days: digestDays("2026-11-09") });
  const nextEvents = [ev(1, "2026-11-12T15:00:00Z", "Olga Cea Zúñiga"), ev(5, "2026-11-15T13:00:00Z", "Cita nueva"), ev(2, "2026-11-25T13:00:00Z", "Katherinne Saravia"), ev(6, "2026-11-17T13:00:00Z", "Entra por el final")];
  const next = buildSnapshot({ events: nextEvents, patients, days });
  const known = new Map(nextEvents.map((e) => [e.id, e.startAt]));
  const changes = diffSnapshots(prev, next, known, { from: days[0], previousEnd: "2026-11-15" });
  assert.deepEqual(changes.added.map((e) => e.id), [5]);
  assert.deepEqual(changes.moved.map((m) => m.entry.id).sort(), [1, 2]);
  assert.deepEqual(changes.cancelled.map((e) => e.id), [3]);
  assert.equal(changeCount(changes), 4);
  // La primera vez no hay con qué comparar.
  assert.equal(changeCount(diffSnapshots(null, next, known, { from: days[0], previousEnd: null })), 0);
});

test("el correo destaca cambios, lista cada día y no lleva datos clínicos ni etiquetas HTML sueltas", () => {
  const events = [ev(1, "2026-11-12T13:00:00Z", "Control <b>x</b>"), ev(5, "2026-11-15T13:00:00Z", "Cita nueva")];
  const entries = buildSnapshot({ events, patients, days });
  const changes = { added: [entries[1]], moved: [{ entry: entries[0], fromStartAt: "2026-11-12T12:00:00Z" }], cancelled: [{ id: 3, startAt: "2026-11-14T13:00:00Z", endAt: "2026-11-14T13:45:00Z", allDay: false, label: "Cita tres" }] };
  const mail = digestEmail({ clinicName: "Clínica Prueba", days, entries, changes, first: false });
  assert.match(mail.subject, /2 citas · 3 cambios · Clínica Prueba/);
  assert.match(mail.text, /NUEVA: .*Cita nueva/);
  assert.match(mail.text, /CAMBIÓ: .* de .* a /);
  assert.match(mail.text, /CANCELADA: .*Cita tres/);
  assert.match(mail.text, /Sin citas/);
  assert.ok(!mail.html.includes("<b>x</b>"));
  assert.match(mail.html, /&lt;b&gt;x&lt;\/b&gt;/);
  const first = digestEmail({ days, entries, changes: { added: [], moved: [], cancelled: [] }, first: true, test: true });
  assert.match(first.subject, /^\[Prueba\] /);
  assert.match(first.text, /hoy y los 6 días siguientes/);
  assert.match(digestEmail({ days, entries, changes: { added: [], moved: [], cancelled: [] }, first: false }).text, /No hubo cambios/);
});

import { digestWhatsApp } from "../lib/agenda-digest.ts";
import { whatsappLink } from "../lib/today-agenda.ts";

test("WhatsApp: texto con negritas, cambios y días; el número chileno arma el enlace y uno inválido no", () => {
  const entries = buildSnapshot({ events: [ev(1, "2026-11-12T13:00:00Z", "Olga Cea Zúñiga"), ev(5, "2026-11-15T13:00:00Z", "Cita nueva")], patients, days });
  const text = digestWhatsApp({ clinicName: "Clínica Prueba", days, entries, first: false, changes: { added: [entries[1]], moved: [], cancelled: [] } });
  assert.match(text, /^\*Agenda de la semana\* · Clínica Prueba/);
  assert.match(text, /\*Cambios desde el último envío:\*\n🆕 NUEVA: .*Cita nueva/);
  assert.match(text, /\*Jueves 12 de noviembre\*\n10:00 \(45 min\) · Olga Cea Zúñiga/);
  assert.match(text, /Sin citas/);
  assert.match(digestWhatsApp({ days, entries, first: false, changes: { added: [], moved: [], cancelled: [] } }), /Sin cambios desde el último envío\./);
  const link = whatsappLink("9 1234 5678", text);
  assert.ok(link.startsWith("https://wa.me/56912345678?text="));
  assert.equal(whatsappLink("12345", text), null);
});

test('el aviso de cambios corre cada 15 minutos y está conectado al cron', async () => {
  const { readFileSync } = await import('node:fs');
  const cron = readFileSync('app/scheduled.ts', 'utf8');
  assert.match(cron, /AGENDA_CHANGES_CRON = "\*\/15 \* \* \* \*"/);
  assert.match(cron, /cron === AGENDA_CHANGES_CRON[\s\S]*runAgendaChangeAlerts/);
  assert.match(readFileSync('app/agenda-digest.ts', 'utf8'), /export async function runAgendaChangeAlerts[\s\S]*changeCount\(built\.changes\) === 0/);
});

test('se puede agendar un paciente nuevo sin ficha directamente en la agenda', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.match(page, /data-testid="agenda-nuevo-paciente"/);
  assert.match(page, /\(newAppt\.name\.trim\(\)\|\|"Paciente nuevo"\)/);
  assert.match(page, /action:"createEvent"/);
  const route = readFileSync('app/api/calendar/route.ts', 'utf8');
  assert.match(route, /body\?\.action === "createEvent"[\s\S]*createAgendaEvent/);
  assert.match(readFileSync('app/drive-oauth.ts', 'utf8'), /export async function createAgendaEvent[\s\S]*can_write/);
});

test('la ficha muestra también las citas de Google Calendar reconocidas para ese paciente', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.match(page, /calendarUpcomingFor=\(patientId:number\)/);
  assert.match(page, /patientForEvent\(e,patients\)\?\.id===patientId/);
  assert.match(page, /data-testid="ficha-cita-calendar"/);
});
