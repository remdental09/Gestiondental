import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGoogleIcsUrl, syncIcsSource } from "../app/calendar-sync.ts";

test("acepta solo la dirección secreta iCal de Google Calendar, de cualquier cuenta", () => {
  assert.ok(isGoogleIcsUrl("https://calendar.google.com/calendar/ical/otra.cuenta%40gmail.com/private-abc123/basic.ics"));
  assert.ok(isGoogleIcsUrl("https://calendar.google.com/calendar/ical/c_123%40group.calendar.google.com/private-x/basic.ics"));
  assert.ok(!isGoogleIcsUrl("https://calendar.google.com/calendar/u/0/r"));
  assert.ok(!isGoogleIcsUrl("http://calendar.google.com/calendar/ical/a%40gmail.com/private-x/basic.ics"));
  assert.ok(!isGoogleIcsUrl("https://evil.example/calendar/ical/a/private-x/basic.ics"));
});

test("importa un calendario de otra cuenta para el profesional, con su propio identificador", async () => {
  const ics = ["BEGIN:VCALENDAR", "X-WR-CALNAME:Consulta Providencia", "BEGIN:VEVENT", "UID:e1@google.com", "DTSTART:20261111T130000Z", "DTEND:20261111T140000Z", "SUMMARY:Control", "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const calls = [];
  const stmt = (sql) => ({ sql, args: [], bind(...v) { this.args = v; return this; }, async run() { return {}; }, async first() { return null; } });
  const db = { prepare: (sql) => stmt(sql), async batch(list) { calls.push(...list); return list.map(() => ({ meta: { changes: 0 } })); } };
  const r = await syncIcsSource(db, "https://calendar.google.com/calendar/ical/x%40gmail.com/private-y/basic.ics", "owner-1", "src:abc", new Date("2026-11-10T08:00:00Z"), async () => new Response(ics));
  assert.equal(r.calendarId, "src:abc");
  assert.equal(r.calName, "Consulta Providencia");
  const upsert = calls.find((c) => c.sql.startsWith("INSERT INTO calendar_events"));
  assert.equal(upsert.args[0], "owner-1");
  assert.equal(upsert.args[1], "src:abc");
  await assert.rejects(syncIcsSource(db, "https://calendar.google.com/x", "o", "src:1", new Date(), async () => new Response("", { status: 404 })), /HTTP 404/);
});

test("la agenda conecta Google Calendar con un botón (sin direcciones iCal) y se actualiza cada hora", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/calendar-sources.tsx", import.meta.url), "utf8");
  const sched = readFileSync(new URL("../app/scheduled.ts", import.meta.url), "utf8");
  const oauth = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  assert.match(page, /<CalendarSources onChanged=/);
  assert.match(panel, /href="\/api\/drive\/connect\?calendar=1"/);
  assert.doesNotMatch(panel, /iCal/);
  assert.match(oauth, /CALENDAR_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/calendar\.readonly"/);
  assert.match(oauth, /=== "calendar"\) \{\n\s+if \(!\(tokens\.scope/);
  assert.equal(sched.split("syncGoogleCalendars()").length - 1, 2);
});
