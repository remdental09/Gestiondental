import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// esbuild is a transitive dependency of vite (not a direct one).
const viteRequire = createRequire(createRequire(import.meta.url).resolve('vite'));
const { buildSync } = viteRequire('esbuild');
const out = join(mkdtempSync(join(tmpdir(), 'gd-ics-')), 'bundle.mjs');
writeFileSync(out, buildSync({
  stdin: { contents: "export * from './app/calendar-ics.ts'; export * from './app/calendar-sync.ts'; export * from './app/scheduled.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'neutral', write: false, external: ['./drive-oauth', './appointment-mail', './audit-notes'], mainFields: ['module', 'main'],
}).outputFiles[0].text);
const m = await import(pathToFileURL(out).href);

const TZ = `BEGIN:VTIMEZONE
TZID:America/Santiago
BEGIN:STANDARD
TZOFFSETFROM:-0300
TZOFFSETTO:-0400
TZNAME:-04
DTSTART:19700405T000000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
TZOFFSETFROM:-0400
TZOFFSETTO:-0300
TZNAME:-03
DTSTART:19700906T000000
RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=1SU
END:DAYLIGHT
END:VTIMEZONE`;
const ev = lines => `BEGIN:VEVENT\n${lines.join('\n')}\nEND:VEVENT`;
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:lpaulr@gmail.com', 'X-WR-TIMEZONE:America/Santiago', TZ,
  ev(['DTSTART;TZID=America/Santiago:20261104T180000', 'DTEND;TZID=America/Santiago:20261104T183000', 'UID:single1@google.com', 'SUMMARY:Control Paciente Ejemplo', 'LAST-MODIFIED:20261101T120000Z']),
  ev(['DTSTART;TZID=America/Santiago:20261102T090000', 'DTEND;TZID=America/Santiago:20261102T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=America/Santiago:20261104T090000', 'UID:rec1@google.com', 'SUMMARY:Bloque recurrente']),
  ev(['DTSTART;TZID=America/Santiago:20261111T150000', 'DTEND;TZID=America/Santiago:20261111T160000', 'RECURRENCE-ID;TZID=America/Santiago:20261111T090000', 'UID:rec1@google.com', 'SUMMARY:Bloque movido']),
  ev(['DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'UID:allday@google.com', 'SUMMARY:Congreso']),
  ev(['DTSTART:20200101T120000Z', 'DTEND:20200101T130000Z', 'UID:old@google.com', 'SUMMARY:Antiguo']),
  ev(['DTSTART:20200101T120000Z', 'DTEND:20200101T130000Z', 'RRULE:FREQ=DAILY;UNTIL=20200110T000000Z', 'UID:oldrec@google.com', 'SUMMARY:Antiguo rec']),
  ev(['DTSTART;TZID=America/Santiago:20261106T100000', 'DTEND;TZID=America/Santiago:20261106T110000', 'UID:canc@google.com', 'STATUS:CANCELLED', 'SUMMARY:Cancelada']),
  'END:VCALENDAR', '',
].join('\r\n').replace(/\n(?!\r)/g, '\r\n');

const now = new Date('2026-11-04T16:30:00Z'); // Wed 13:30 Chile

test('window is Monday of the Santiago week + 14 days', () => {
  const w = m.syncWindow(now);
  assert.equal(w.from, '2026-11-02'); assert.equal(w.to, '2026-11-16');
  assert.equal(w.fromIso, '2026-11-02T03:00:00.000Z');
});

test('expands recurrences with Google-style instance ids, EXDATE and moved instance', () => {
  const w = m.syncWindow(now);
  const { rows, scanned, parsed, calName } = m.eventsFromIcs(ics, w.fromIso, w.toIso);
  assert.equal(calName, 'lpaulr@gmail.com'); assert.equal(scanned, 7); assert.equal(parsed, 5);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['allday', 'canc', 'rec1_20261102T120000Z', 'rec1_20261109T120000Z', 'rec1_20261111T120000Z', 'single1'].sort());
  assert.equal(byId.single1.startAt, '2026-11-04T21:00:00.000Z');
  assert.equal(byId.single1.updated, '2026-11-01T12:00:00.000Z');
  assert.equal(byId.rec1_20261111T120000Z.title, 'Bloque movido');
  assert.equal(byId.rec1_20261111T120000Z.startAt, '2026-11-11T18:00:00.000Z');
  assert.equal(byId.allday.allDay, true); assert.equal(byId.allday.startAt, '2026-11-05T03:00:00.000Z');
  assert.equal(byId.canc.status, 'cancelled');
});

test('winter time (UTC-4) converts correctly', () => {
  assert.equal(m.zonedToIso('2026-06-10', '09:00:00'), '2026-06-10T13:00:00.000Z');
});

function fakeDb() {
  const calls = [];
  const stmt = sql => ({ sql, args: [], bind(...a) { this.args = a; return this; }, async run() { return {}; } });
  return { calls, prepare: sql => stmt(sql), async batch(s) { calls.push(...s); return s.map((x, i) => ({ meta: { changes: i === s.length - 1 ? 2 : 1 } })); } };
}

test('sync upserts rows and prunes only inside the window, owner and calendar', async () => {
  const DB = fakeDb();
  const r = await m.syncCalendarFromIcs({ DB, GCAL_ICS_URL: 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics', CLINIC_OWNER_ID: 'owner-1', GCAL_CALENDAR_ID: 'lpaulr@gmail.com' }, now,
    async () => new Response(ics));
  assert.equal(r.events, 6); assert.equal(r.cancelled, 2);
  const prune = DB.calls.at(-1);
  assert.match(prune.sql, /^UPDATE calendar_events SET status='cancelled'/);
  assert.deepEqual(prune.args.slice(1, 5), ['owner-1', 'lpaulr@gmail.com', '2026-11-02T03:00:00.000Z', '2026-11-16T03:00:00.000Z']);
  assert.equal(JSON.parse(prune.args[5]).length, 6);
  assert.ok(DB.calls.slice(0, -1).every(s => s.sql.startsWith('INSERT INTO calendar_events') && s.args[0] === 'owner-1'));
});

test('failed or invalid fetch never prunes', async () => {
  const env = { DB: fakeDb(), GCAL_ICS_URL: 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics', CLINIC_OWNER_ID: 'o' };
  await assert.rejects(m.syncCalendarFromIcs(env, now, async () => new Response('no', { status: 404 })));
  await assert.rejects(m.syncCalendarFromIcs(env, now, async () => new Response('<html>login</html>')));
  assert.equal(env.DB.calls.length, 0);
  await assert.rejects(m.syncCalendarFromIcs({ ...env, GCAL_ICS_URL: 'https://evil.example/x.ics' }, now, async () => new Response(ics)));
  assert.deepEqual(await m.syncCalendarFromIcs({ ...env, GCAL_ICS_URL: '' }, now), { skipped: 'GCAL_ICS_URL no configurado' });
});

test('cron strings match wrangler config', async () => {
  const { readFileSync } = await import('node:fs');
  const cfg = readFileSync(new URL('../wrangler.cloudflare.jsonc', import.meta.url), 'utf8');
  assert.ok(cfg.includes(`"${m.CALENDAR_CRON}"`) && cfg.includes(`"${m.BACKUP_CRON}"`) && cfg.includes(`"${m.HOURLY_BACKUP_CRON}"`));
});

test('worker exports scheduled() that hands the cron to app/scheduled', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
  assert.match(src, /async scheduled\(controller: ScheduledController[\s\S]*import\("\.\/app\/scheduled"\)[\s\S]*waitUntil\(runScheduled\(controller\.cron/);
});
