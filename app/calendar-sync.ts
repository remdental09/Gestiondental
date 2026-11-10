// Scheduled Google Calendar -> D1 calendar_events sync (port of /workspace/gd-calendar-sync/sync.mjs).
// Read-only towards Google: fetches the calendar's secret iCal address. Never touches `appointments`.
import { CALENDAR_TIME_ZONE, eventsFromIcs, syncWindow } from "./calendar-ics.ts";

type Stmt = { bind(...v: unknown[]): Stmt; run(): Promise<{ meta?: { changes?: number } }>; first<T = unknown>(): Promise<T | null> };
export type CalendarDb = { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<Array<{ meta?: { changes?: number } }>> };
export type CalendarSyncEnv = {
  DB: CalendarDb;
  GCAL_ICS_URL?: string;
  GCAL_CALENDAR_ID?: string;
  GCAL_OWNER_ID?: string;
  CLINIC_OWNER_ID?: string;
};

const UPSERT = "INSERT INTO calendar_events (owner_id,calendar_id,google_event_id,title,start_at,end_at,source_time_zone,html_link,status,all_day,imported_at,source_updated_at) " +
  "VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(owner_id,calendar_id,google_event_id) DO UPDATE SET " +
  "title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,all_day=excluded.all_day," +
  "imported_at=excluded.imported_at,source_updated_at=COALESCE(excluded.source_updated_at,calendar_events.source_updated_at)";
const PRUNE = "UPDATE calendar_events SET status='cancelled', imported_at=? WHERE owner_id=? AND calendar_id=? AND start_at>=? AND start_at<? " +
  "AND status!='cancelled' AND google_event_id NOT IN (SELECT value FROM json_each(?))";

/** Dirección secreta iCal de Google Calendar (de cualquier cuenta). */
export function isGoogleIcsUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && parsed.hostname === "calendar.google.com" && /^\/calendar\/ical\/[^/]+\/(?:private-[^/]+|public)\/basic\.ics$/.test(parsed.pathname);
  } catch { return false; }
}

export async function syncCalendarFromIcs(env: CalendarSyncEnv, now = new Date(), fetcher: typeof fetch = fetch) {
  const url = env.GCAL_ICS_URL?.trim();
  if (!url) return { skipped: "GCAL_ICS_URL no configurado" };
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "calendar.google.com") throw new Error("GCAL_ICS_URL debe ser la dirección secreta iCal de calendar.google.com");
  const owner = env.GCAL_OWNER_ID?.trim() || env.CLINIC_OWNER_ID?.trim();
  if (!owner) throw new Error("Falta GCAL_OWNER_ID / CLINIC_OWNER_ID");
  return syncIcsSource(env.DB, url, owner, env.GCAL_CALENDAR_ID?.trim() || null, now, fetcher);
}

/** Importa un calendario iCal para un profesional. Solo lectura hacia Google; si la lectura falla, no borra nada. */
export async function syncIcsSource(db: CalendarDb, url: string, owner: string, fixedCalendarId: string | null, now = new Date(), fetcher: typeof fetch = fetch) {
  const res = await fetcher(url, { headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(`iCal HTTP ${res.status}`); // never prune on a failed read
  const text = await res.text();
  const win = syncWindow(now);
  const { rows, scanned, parsed: kept, calName } = eventsFromIcs(text, win.fromIso, win.toIso);
  const calendarId = fixedCalendarId || calName;
  if (!calendarId) throw new Error("No se pudo determinar el calendario (GCAL_CALENDAR_ID)");

  const stamp = now.toISOString();
  const stmts = rows.map(r => db.prepare(UPSERT).bind(owner, calendarId, r.id, r.title, r.startAt, r.endAt,
    CALENDAR_TIME_ZONE, r.status, r.allDay ? 1 : 0, stamp, r.updated));
  stmts.push(db.prepare(PRUNE).bind(stamp, owner, calendarId, win.fromIso, win.toIso, JSON.stringify(rows.map(r => r.id))));
  const results = await db.batch(stmts);
  const cancelled = results[results.length - 1]?.meta?.changes ?? 0;
  return { calendarId, calName: calName || null, window: `${win.from}..${win.to}`, scanned, parsed: kept, events: rows.length, cancelled };
}
