// Parse a Google Calendar "secret address in iCal format" feed into calendar_events rows
// for a window. Pure functions (no I/O) so they can be unit-tested.
import ICAL from "ical.js";

export const CALENDAR_TIME_ZONE = "America/Santiago";

export type CalendarRow = {
  id: string; title: string; startAt: string; endAt: string; allDay: boolean;
  status: "confirmed" | "cancelled"; updated: string | null;
};

function offsetMinutes(timeZone: string, at: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at).find(p => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

/** Wall-clock date/time in `timeZone` -> UTC ISO (same algorithm as gd-calendar-sync/sync.mjs). */
export function zonedToIso(date: string, time = "00:00:00", timeZone = CALENDAR_TIME_ZONE) {
  const base = new Date(`${date}T${time}Z`).getTime();
  let guess = base;
  for (let i = 0; i < 2; i++) guess = base - offsetMinutes(timeZone, new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

/** Monday of the current Santiago week .. +14 days (Santiago dates, `to` exclusive). */
export function syncWindow(now = new Date(), days = 14) {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${local}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const from = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + days);
  const to = d.toISOString().slice(0, 10);
  return { from, to, fromIso: zonedToIso(from), toIso: zonedToIso(to) };
}

const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
const compact = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

/**
 * Cheap text pre-filter so big multi-year feeds stay within the Workers CPU budget: keep
 * VTIMEZONEs, recurring masters still active, and single events / exceptions near the window.
 */
export function prefilterIcs(text: string, fromIso: string, toIso: string) {
  const src = unfold(text);
  if (!/BEGIN:VCALENDAR/.test(src)) throw new Error("El enlace iCal no devolvió un calendario.");
  const lo = Number(compact(new Date(Date.parse(fromIso) - 2 * 86400000).toISOString()));
  const hi = Number(compact(new Date(Date.parse(toIso) + 2 * 86400000).toISOString()));
  const head = src.slice(0, src.indexOf("BEGIN:VEVENT") >= 0 ? src.indexOf("BEGIN:VEVENT") : src.indexOf("END:VCALENDAR"));
  const kept: string[] = [];
  const re = /BEGIN:VEVENT\n[\s\S]*?\nEND:VEVENT/g;
  let total = 0;
  for (const m of src.matchAll(re)) {
    total++;
    const block = m[0];
    const date = (prop: string) => {
      const v = block.match(new RegExp(`\\n${prop}[^:\\n]*:(\\d{8})`));
      return v ? Number(v[1]) : null;
    };
    const rrule = block.match(/\nRRULE:([^\n]*)/);
    let keep: boolean;
    if (rrule) {
      const until = rrule[1].match(/UNTIL=(\d{8})/);
      const start = date("DTSTART");
      keep = !(until && Number(until[1]) < lo) && !(start !== null && start > hi);
    } else {
      const start = date("DTSTART"), rid = date("RECURRENCE-ID");
      keep = [start, rid].some(v => v !== null && v >= lo && v <= hi);
    }
    if (keep) kept.push(block);
  }
  const calName = head.match(/\nX-WR-CALNAME:([^\n]*)/)?.[1]?.trim() || null;
  return { text: `${head.trimEnd()}\n${kept.join("\n")}\nEND:VCALENDAR\n`, total, kept: kept.length, calName };
}

function googleId(uid: string) {
  return uid.replace(/@google\.com$/i, "");
}

function instanceSuffix(t: ICAL.Time) {
  if (t.isDate) return t.toString().replace(/-/g, "");
  return t.toJSDate().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function timeToIso(t: ICAL.Time) {
  if (t.isDate) return zonedToIso(t.toString());
  return t.toJSDate().toISOString();
}

/** Expand events (incl. RRULE/EXDATE/RECURRENCE-ID) whose start falls in [fromIso, toIso). */
export function eventsFromIcs(text: string, fromIso: string, toIso: string, maxInstances = 2000) {
  const filtered = prefilterIcs(text, fromIso, toIso);
  const root = new ICAL.Component(ICAL.parse(filtered.text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const comp of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(comp);
    if (!ev.uid || !ev.startDate) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev); else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const rows = new Map<string, CalendarRow>();
  const push = (id: string, item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    const startAt = timeToIso(start);
    const t = Date.parse(startAt);
    if (t < from || t >= to) return;
    const status = String(item.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed";
    const updated = item.component.getFirstPropertyValue("last-modified") as ICAL.Time | null;
    rows.set(id, {
      id: id.slice(0, 512), title: (item.summary || "(sin título)").slice(0, 500), startAt,
      endAt: end ? timeToIso(end) : startAt, allDay: start.isDate, status,
      updated: updated && typeof updated.toJSDate === "function" ? updated.toJSDate().toISOString() : null,
    });
  };

  for (const ev of masters.values()) {
    const base = googleId(ev.uid);
    if (!ev.isRecurring()) { push(base, ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < maxInstances; i++, next = it.next()) {
      if (!next.isDate && next.toJSDate().getTime() >= to + 86400000) break;
      if (next.isDate && Date.parse(zonedToIso(next.toString())) >= to) break;
      const d = ev.getOccurrenceDetails(next);
      push(`${base}_${instanceSuffix(d.recurrenceId)}`, d.item, d.startDate, d.endDate);
    }
  }
  // Exceptions whose master was filtered out or missing (still carry their own data).
  for (const ex of exceptions) {
    if (masters.has(ex.uid)) continue;
    push(`${googleId(ex.uid)}_${instanceSuffix(ex.recurrenceId)}`, ex, ex.startDate, ex.endDate);
  }
  return { rows: [...rows.values()], scanned: filtered.total, parsed: filtered.kept, calName: filtered.calName };
}
