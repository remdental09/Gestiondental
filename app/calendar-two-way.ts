import { env } from "cloudflare:workers";
import { decideGoogleChange, latestIso, type GoogleChange, type IncomingGoogleEvent } from "@/lib/calendar-two-way";

/**
 * Vuelta desde Google Calendar: cambios hechos directamente en Google a eventos que la app creó
 * (citas de la ficha y de próximos controles) se aplican a la app. Todo filtra por owner_id.
 * Borrado en Google → la cita queda «Cancelada» y su control «descartado» (no se borra nada: se puede revertir).
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };
const now = () => new Date().toISOString();

export const TWO_WAY_DDL = [
  "CREATE TABLE IF NOT EXISTS google_calendar_sync (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, sync_token TEXT, page_token TEXT, last_run_at TEXT, last_result TEXT, PRIMARY KEY (owner_id, google_sub))",
];
export const TWO_WAY_COLUMNS = [
  "ALTER TABLE appointment_google_events ADD COLUMN google_updated TEXT",
  "ALTER TABLE appointment_google_events ADD COLUMN app_changed_at TEXT",
];
let ready: Promise<void> | null = null;
export async function ensureTwoWay() {
  const db = database();
  ready ??= (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS appointment_google_events (owner_id TEXT NOT NULL, appointment_id INTEGER NOT NULL, google_sub TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY (owner_id, appointment_id))").run();
    for (const sql of TWO_WAY_DDL) await db.prepare(sql).run();
    for (const sql of TWO_WAY_COLUMNS) { try { await db.prepare(sql).run(); } catch { /* la columna ya existe */ } }
  })().catch(cause => { ready = null; throw cause; });
  await ready;
  return db;
}

/** La app va a cambiar esta cita (antes de escribir en Google): si Google tiene algo más viejo, gana la app. */
export async function markAppChanged(ownerId: string, appointmentId: number) {
  const db = await ensureTwoWay();
  await db.prepare("UPDATE appointment_google_events SET app_changed_at = ? WHERE owner_id = ? AND appointment_id = ?").bind(now(), ownerId, appointmentId).run();
}
/** Google confirmó lo que escribió la app: ese «updated» es nuestro eco y no debe volver a la app. */
export async function noteAppWrite(ownerId: string, appointmentId: number, googleUpdated: string | null | undefined) {
  const db = await ensureTwoWay();
  await db.prepare("UPDATE appointment_google_events SET google_updated = ?, app_changed_at = COALESCE(app_changed_at, ?) WHERE owner_id = ? AND appointment_id = ?").bind(googleUpdated ?? null, now(), ownerId, appointmentId).run();
}

export type SyncState = { sync_token: string | null; page_token: string | null; last_run_at: string | null };
export async function readSyncState(ownerId: string, googleSub: string): Promise<SyncState> {
  const db = await ensureTwoWay();
  return (await db.prepare("SELECT sync_token, page_token, last_run_at FROM google_calendar_sync WHERE owner_id = ? AND google_sub = ?").bind(ownerId, googleSub).first<SyncState>()) ?? { sync_token: null, page_token: null, last_run_at: null };
}
export async function writeSyncState(ownerId: string, googleSub: string, patch: Partial<{ sync_token: string | null; page_token: string | null; last_run_at: string; last_result: string }>) {
  const db = await ensureTwoWay();
  await db.prepare("INSERT INTO google_calendar_sync (owner_id, google_sub) VALUES (?, ?) ON CONFLICT(owner_id, google_sub) DO NOTHING").bind(ownerId, googleSub).run();
  for (const [key, value] of Object.entries(patch)) {
    if (!["sync_token", "page_token", "last_run_at", "last_result"].includes(key)) continue;
    await db.prepare(`UPDATE google_calendar_sync SET ${key} = ? WHERE owner_id = ? AND google_sub = ?`).bind(value ?? null, ownerId, googleSub).run();
  }
}

type LinkRow = { appointment_id: number; calendar_id: string; event_id: string; google_updated: string | null; app_changed_at: string | null };
export type ApplyResult = { moved: number; cancelled: number; ignored: number };

/** Aplica a la app los eventos de Google que corresponden a citas creadas por la app (el resto se ignora). */
export async function applyGoogleEvents(ownerId: string, googleSub: string, events: Array<IncomingGoogleEvent & { end?: { dateTime?: string; date?: string } }>): Promise<ApplyResult> {
  const out: ApplyResult = { moved: 0, cancelled: 0, ignored: 0 };
  if (!events.length) return out;
  const db = await ensureTwoWay();
  const { results } = await db.prepare("SELECT appointment_id, calendar_id, event_id, google_updated, app_changed_at FROM appointment_google_events WHERE owner_id = ? AND google_sub = ?").bind(ownerId, googleSub).all<LinkRow>();
  const links = new Map(results.map(row => [row.event_id, row]));
  for (const event of events) {
    const link = event.id ? links.get(event.id) : undefined;
    if (!link) continue;
    const appointment = await db.prepare("SELECT day, time FROM appointments WHERE id = ? AND owner_id = ?").bind(link.appointment_id, ownerId).first<{ day: string; time: string }>();
    const change: GoogleChange = decideGoogleChange(event, { googleUpdated: link.google_updated, appChangedAt: link.app_changed_at }, appointment);
    const seen = latestIso(link.google_updated, event.updated);
    if (change.kind === "move") {
      await db.prepare("UPDATE appointments SET day = ?, time = ? WHERE id = ? AND owner_id = ?").bind(change.day, change.time, link.appointment_id, ownerId).run();
      const { controlFollowsAppointment } = await import("@/app/followup-db");
      await controlFollowsAppointment(ownerId, link.appointment_id, { day: change.day });
      if (event.start?.dateTime) {
        const startAt = new Date(event.start.dateTime).toISOString();
        const endAt = event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : new Date(Date.parse(startAt) + 30 * 60000).toISOString();
        await db.prepare("UPDATE calendar_events SET start_at = ?, end_at = ?, status = 'confirmed', all_day = 0, imported_at = ?, source_updated_at = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(startAt, endAt, now(), event.updated ?? null, ownerId, link.calendar_id, link.event_id).run();
      }
      await db.prepare("UPDATE appointment_google_events SET google_updated = ? WHERE owner_id = ? AND appointment_id = ?").bind(seen, ownerId, link.appointment_id).run();
      out.moved++;
    } else if (change.kind === "cancel") {
      const { setAttendance } = await import("@/app/attendance-db");
      await setAttendance(ownerId, "app", link.appointment_id, "cancelada").catch(() => false);
      const stamp = now();
      await db.prepare("UPDATE patient_controls SET status = 'descartado', updated_at = ? WHERE owner_id = ? AND appointment_id = ? AND status NOT IN ('realizado', 'descartado')").bind(stamp, ownerId, link.appointment_id).run().catch(() => undefined);
      await db.prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(stamp, ownerId, link.calendar_id, link.event_id).run();
      // El evento ya no existe en Google: se suelta el enlace (si se reabre el control, se vuelve a crear allá).
      await db.prepare("DELETE FROM appointment_google_events WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, link.appointment_id).run();
      out.cancelled++;
    } else {
      if (seen !== link.google_updated && change.why !== "sin-cita") await db.prepare("UPDATE appointment_google_events SET google_updated = ? WHERE owner_id = ? AND appointment_id = ?").bind(seen, ownerId, link.appointment_id).run();
      out.ignored++;
    }
  }
  return out;
}
