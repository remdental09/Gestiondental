import test from "node:test";
import assert from "node:assert/strict";
import { reminderEmail, buildRawMessage, selectReminders, isSendWindow, isValidEmail } from "../lib/appointment-mail.ts";

const ev = (id, start, extra = {}) => ({ id, title: "Cita", startAt: start, endAt: start, status: "confirmed", allDay: false, patientId: null, ...extra });
const decode = raw => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

test("el correo lleva fecha y hora de Chile, los dos enlaces y nada clínico", () => {
  const mail = reminderEmail({ patientName: "Ana María Pérez", startAt: "2026-11-11T18:30:00Z", clinicName: "Clínica Sonrisa", confirmUrl: "https://x.cl/api/confirmar?t=abc&a=si", declineUrl: "https://x.cl/api/confirmar?t=abc&a=no" });
  assert.match(mail.subject, /miércoles 11 de noviembre/);
  assert.match(mail.text, /Estimado\(a\) Ana:/);
  assert.match(mail.text, /a las 15:30 en Clínica Sonrisa/);
  assert.ok(mail.html.includes('href="https://x.cl/api/confirmar?t=abc&amp;a=si"'));
  assert.ok(mail.text.includes("https://x.cl/api/confirmar?t=abc&a=no"));
});

test("el HTML escapa el nombre y la clínica", () => {
  const mail = reminderEmail({ patientName: '<b>Ana</b>', startAt: "2026-11-11T18:30:00Z", clinicName: 'Clínica "X" <script>', confirmUrl: "https://x.cl/a", declineUrl: "https://x.cl/b" });
  assert.ok(!mail.html.includes("<script>") && !mail.html.includes("<b>Ana"));
});

test("el mensaje RFC 822 es válido, UTF-8 y resiste inyección de encabezados", () => {
  const mail = reminderEmail({ patientName: "Ana", startAt: "2026-11-11T18:30:00Z", clinicName: "Clínica", confirmUrl: "https://x.cl/a", declineUrl: "https://x.cl/b" });
  const raw = decode(buildRawMessage({ from: "tecnica@gmail.com", fromName: "Clínica\r\nBcc: espia@x.cl", to: "ana@correo.cl", subject: mail.subject + "\r\nBcc: otro@x.cl", text: mail.text, html: mail.html }));
  assert.match(raw, /^From: =\?UTF-8\?B\?[^?]+\?= <tecnica@gmail.com>\r\nTo: <ana@correo.cl>\r\nSubject: =\?UTF-8\?B\?/);
  assert.ok(!/^Bcc:/mi.test(raw));
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.throws(() => buildRawMessage({ from: "tecnica@gmail.com", to: "no-es-correo", subject: "x", text: "x", html: "x" }));
});

test("solo se recuerda a pacientes reconocidos, con correo válido, sin confirmar y sin envío previo", () => {
  const patients = [
    { id: 1, name: "Ana Pérez Soto", email: "ana@correo.cl" },
    { id: 2, name: "Juan Rojas Díaz", email: "malo" },
    { id: 3, name: "Luis Mora Vega", email: "luis@correo.cl" },
    { id: 4, name: "Eva Lara Paz", email: "eva@correo.cl" },
  ];
  const events = [
    ev(1, "2026-11-11T15:00:00Z", { title: "Ana Pérez" }),
    ev(2, "2026-11-11T16:00:00Z", { title: "Juan Rojas" }),
    ev(3, "2026-11-11T17:00:00Z", { title: "Luis Mora" }),
    ev(4, "2026-11-11T18:00:00Z", { title: "Eva Lara" }),
    ev(5, "2026-11-11T19:00:00Z", { title: "Alguien sin ficha" }),
    ev(6, "2026-11-12T19:00:00Z", { title: "Ana Pérez" }),
  ];
  const out = selectReminders({ events, patients, day: "2026-11-11", confirmedEventIds: new Set([3]), alreadySent: new Set(["4|2026-11-11T18:00:00Z"]) });
  assert.deepEqual(out.map(o => o.event.id), [1]);
});

test("se envía desde la hora elegida y hasta las 20:00 de Chile", () => {
  // 2026-11-10 12:00 UTC = 09:00 en Chile (verano)
  assert.equal(isSendWindow(new Date("2026-11-10T12:00:00Z"), 9), true);
  assert.equal(isSendWindow(new Date("2026-11-10T11:59:00Z"), 9), false);
  assert.equal(isSendWindow(new Date("2026-11-11T00:30:00Z"), 9), false); // 21:30 en Chile
});

test("validación de correo", () => {
  assert.ok(isValidEmail("ana@correo.cl"));
  assert.ok(!isValidEmail("ana@"));
  assert.ok(!isValidEmail("a b@c.cl"));
  assert.ok(!isValidEmail(""));
});

test("el mensaje o firma del clínico sale en el correo, escapado y acotado", async () => {
  const { reminderEmail, cleanMessage } = await import("../lib/appointment-mail.ts");
  const base = { patientName: "Ana Pérez", startAt: "2026-11-11T18:00:00.000Z", clinicName: "Clínica", confirmUrl: "https://x/y?t=1&a=si", declineUrl: "https://x/y?t=1&a=no" };
  const mail = reminderEmail({ ...base, message: "Responda este correo.\n<b>Dr. Rodríguez</b>" });
  assert.match(mail.text, /Responda este correo\.\n<b>Dr\. Rodríguez<\/b>/);
  assert.match(mail.html, /Responda este correo\.<br>&lt;b&gt;Dr\. Rodríguez&lt;\/b&gt;/);
  assert.doesNotMatch(reminderEmail(base).text, /undefined/);
  assert.equal(cleanMessage("x".repeat(900)).length, 600);
});
