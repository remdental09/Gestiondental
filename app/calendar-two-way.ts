import { env } from "cloudflare:workers";
import { decideGoogleChange, latestIso, minutesBetween, chileDayTime, type GoogleChange, type IncomingGoogleEvent } from "@/lib/calendar-two-way";
import { controlReasonFrom, inImportWindow, isClinicalCandidate, isControlTitle, matchPatientByTitle, reasonFromTitle } from "@/lib/calendar-import";

/**
 * Ida y vuelta con Google Calendar (todo filtra por owner_id):
 * - Cambios en Google a eventos enlazados a citas de la app (mover, duración, título, borrar, restaurar, cambiar de calendario).
 * - Citas nuevas creadas directo en Google → citas de la app (o «Sin paciente – asignar» si no se reconoce al paciente).
 * - Cola de escrituras pendientes cuando Google falló al escribir.
 * Nada clínico se borra: una cita borrada en Google queda «Cancelada» y su control «descartado» (reversible).
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };
const now = () => new Date().toISOString();

export const TWO_WAY_DDL = [
  "CREATE TABLE IF NOT EXISTS google_calendar_sync (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, sync_token TEXT, page_token TEXT, last_run_at TEXT, last_result TEXT, PRIMARY KEY (owner_id, google_sub))",
  "CREATE TABLE IF NOT EXISTS google_calendar_cursor (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, calendar_id TEXT NOT NULL, sync_token TEXT, page_token TEXT, updated_at TEXT, PRIMARY KEY (owner_id, google_sub, calendar_id))",
  "CREATE TABLE IF NOT EXISTS google_pending_writes (owner_id TEXT NOT NULL, appointment_id INTEGER NOT NULL, op TEXT NOT NULL, google_sub TEXT, calendar_id TEXT, event_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, appointment_id, op))",
];
export const TWO_WAY_COLUMNS = [
  "ALTER TABLE appointment_google_events ADD COLUMN google_updated TEXT",
  "ALTER TABLE appointment_google_events ADD COLUMN app_changed_at TEXT",
  "ALTER TABLE appointment_google_events ADD COLUMN google_status TEXT",
  "ALTER TABLE appointment_google_events ADD COLUMN control_cancelled INTEGER",
  "ALTER TABLE appointment_google_events ADD COLUMN ical_uid TEXT",
  "ALTER TABLE appointments ADD COLUMN minutes INTEGER",
  "ALTER TABLE calendar_events ADD COLUMN needs_patient INTEGER",
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
export async function noteAppWrite(ownerId: string, appointmentId: number, googleUpdated: string | null | undefined, iCalUID?: string | null) {
  const db = await ensureTwoWay();
  await db.prepare("UPDATE appointment_google_events SET google_updated = ?, app_changed_at = COALESCE(app_changed_at, ?), google_status = 'confirmed', ical_uid = COALESCE(?, ical_uid) WHERE owner_id = ? AND appointment_id = ?").bind(googleUpdated ?? null, now(), iCalUID ?? null, ownerId, appointmentId).run();
  await db.prepare("DELETE FROM google_pending_writes WHERE owner_id = ? AND appointment_id = ? AND op = 'upsert'").bind(ownerId, appointmentId).run();
}

// ——— Cola de escrituras pendientes ———
export type PendingWrite = { appointment_id: number; op: "upsert" | "delete"; google_sub: string | null; calendar_id: string | null; event_id: string | null; attempts: number };
export async function enqueuePending(ownerId: string, appointmentId: number, op: "upsert" | "delete", error: string, target?: { googleSub: string; calendarId: string; eventId: string }) {
  const db = await ensureTwoWay();
  const stamp = now();
  await db.prepare("INSERT INTO google_pending_writes (owner_id, appointment_id, op, google_sub, calendar_id, event_id, attempts, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(owner_id, appointment_id, op) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at, google_sub = COALESCE(excluded.google_sub, google_pending_writes.google_sub), calendar_id = COALESCE(excluded.calendar_id, google_pending_writes.calendar_id), event_id = COALESCE(excluded.event_id, google_pending_writes.event_id)")
    .bind(ownerId, appointmentId, op, target?.googleSub ?? null, target?.calendarId ?? null, target?.eventId ?? null, error.slice(0, 200), stamp, stamp).run();
  if (op === "delete") await db.prepare("DELETE FROM google_pending_writes WHERE owner_id = ? AND appointment_id = ? AND op = 'upsert'").bind(ownerId, appointmentId).run();
}
export async function listPending(ownerId: string, limit = 20): Promise<PendingWrite[]> {
  const db = await ensureTwoWay();
  return (await db.prepare("SELECT appointment_id, op, google_sub, calendar_id, event_id, attempts FROM google_pending_writes WHERE owner_id = ? AND attempts < 50 ORDER BY updated_at LIMIT ?").bind(ownerId, limit).all<PendingWrite>()).results;
}
export async function pendingOwners(): Promise<string[]> {
  const db = await ensureTwoWay();
  return (await db.prepare("SELECT DISTINCT owner_id FROM google_pending_writes WHERE attempts < 50 LIMIT 20").bind().all<{ owner_id: string }>()).results.map(row => row.owner_id);
}
export async function finishPending(ownerId: string, appointmentId: number, op: string, error?: string) {
  const db = await ensureTwoWay();
  if (!error) await db.prepare("DELETE FROM google_pending_writes WHERE owner_id = ? AND appointment_id = ? AND op = ?").bind(ownerId, appointmentId, op).run();
  else await db.prepare("UPDATE google_pending_writes SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE owner_id = ? AND appointment_id = ? AND op = ?").bind(error.slice(0, 200), now(), ownerId, appointmentId, op).run();
}
/** Citas con algo pendiente de escribir en Google (para la marca «pendiente de sincronizar»). */
export async function pendingAppointmentIds(ownerId: string): Promise<number[]> {
  const db = await ensureTwoWay();
  return (await db.prepare("SELECT DISTINCT appointment_id FROM google_pending_writes WHERE owner_id = ?").bind(ownerId).all<{ appointment_id: number }>()).results.map(row => row.appointment_id);
}

// ——— Estado de lectura ———
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
/** Token de sincronización de cada calendario (uno por calendario). */
export async function readCursor(ownerId: string, googleSub: string, calendarId: string) {
  const db = await ensureTwoWay();
  return (await db.prepare("SELECT sync_token, page_token FROM google_calendar_cursor WHERE owner_id = ? AND google_sub = ? AND calendar_id = ?").bind(ownerId, googleSub, calendarId).first<{ sync_token: string | null; page_token: string | null }>()) ?? { sync_token: null, page_token: null };
}
export async function writeCursor(ownerId: string, googleSub: string, calendarId: string, cursor: { sync_token: string | null; page_token: string | null }) {
  const db = await ensureTwoWay();
  await db.prepare("INSERT INTO google_calendar_cursor (owner_id, google_sub, calendar_id, sync_token, page_token, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, google_sub, calendar_id) DO UPDATE SET sync_token = excluded.sync_token, page_token = excluded.page_token, updated_at = excluded.updated_at")
    .bind(ownerId, googleSub, calendarId, cursor.sync_token, cursor.page_token, now()).run();
}

// ——— Aplicar lo que llegó de Google ———
type LinkRow = { appointment_id: number; calendar_id: string; event_id: string; google_updated: string | null; app_changed_at: string | null; google_status: string | null; control_cancelled: number | null; ical_uid: string | null };
export type SeenEvent = { calendarKey: string; importable: boolean; event: IncomingGoogleEvent };
export type ApplyResult = { moved: number; cancelled: number; restored: number; imported: number; unassigned: number; ignored: number; deferred: boolean };
const UPSERT_EVENT = "INSERT INTO calendar_events (owner_id,calendar_id,google_event_id,title,start_at,end_at,source_time_zone,html_link,status,all_day,imported_at,source_updated_at) " +
  "VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(owner_id,calendar_id,google_event_id) DO UPDATE SET " +
  "title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,all_day=excluded.all_day," +
  "imported_at=excluded.imported_at,source_updated_at=COALESCE(excluded.source_updated_at,calendar_events.source_updated_at)";

/** Un mismo evento puede llegar de dos calendarios (se movió): manda la copia confirmada. */
export function mergeSeen(items: SeenEvent[]): SeenEvent[] {
  const byId = new Map<string, SeenEvent>();
  for (const item of items) {
    const prev = byId.get(item.event.id);
    if (!prev || (prev.event.status === "cancelled" && item.event.status !== "cancelled")) byId.set(item.event.id, item);
  }
  return [...byId.values()];
}

async function upsertCalendarRow(db: Db, ownerId: string, calendarKey: string, event: IncomingGoogleEvent, patientId: number | null, needsPatient: boolean) {
  if (!event.start?.dateTime) return;
  const startAt = new Date(event.start.dateTime).toISOString();
  const endAt = event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : new Date(Date.parse(startAt) + 30 * 60000).toISOString();
  await db.prepare(UPSERT_EVENT).bind(ownerId, calendarKey, event.id, (event.summary || "(sin título)").slice(0, 300), startAt, endAt, "America/Santiago", event.status === "cancelled" ? "cancelled" : "confirmed", 0, now(), event.updated ?? null).run();
  await db.prepare("UPDATE calendar_events SET patient_id = COALESCE(?, patient_id), needs_patient = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(patientId, needsPatient ? 1 : 0, ownerId, calendarKey, event.id).run();
}

/** Crea la cita de la app para un evento de Google ya reconocido (y su próximo control si el título dice «Control»). */
export async function createAppointmentFromGoogle(ownerId: string, googleSub: string, calendarKey: string, event: IncomingGoogleEvent, patient: { id: number; name: string }) {
  const db = await ensureTwoWay();
  const when = event.start?.dateTime ? chileDayTime(event.start.dateTime) : null;
  if (!when) return null;
  const minutes = minutesBetween(event.start?.dateTime, event.end?.dateTime);
  const reason = reasonFromTitle(event.summary ?? "", patient.name);
  // Si ya existe la misma cita en la app (mismo paciente, día y hora) sin enlace, se enlaza en vez de duplicar.
  const same = await db.prepare("SELECT a.id FROM appointments a LEFT JOIN appointment_google_events l ON l.owner_id = a.owner_id AND l.appointment_id = a.id WHERE a.owner_id = ? AND a.patient_id = ? AND a.day = ? AND a.time = ? AND l.appointment_id IS NULL").bind(ownerId, patient.id, when.day, when.time).first<{ id: number }>();
  const appointmentId = same?.id ?? (await db.prepare("INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at, minutes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(ownerId, patient.id, when.day, when.time, reason, now(), minutes).first<{ id: number }>())?.id;
  if (!appointmentId) return null;
  await db.prepare("INSERT OR REPLACE INTO appointment_google_events (owner_id, appointment_id, google_sub, calendar_id, event_id, google_updated, app_changed_at, google_status, control_cancelled, ical_uid) VALUES (?, ?, ?, ?, ?, ?, NULL, 'confirmed', NULL, ?)")
    .bind(ownerId, appointmentId, googleSub, calendarKey, event.id, event.updated ?? null, event.iCalUID ?? null).run();
  await upsertCalendarRow(db, ownerId, calendarKey, event, patient.id, false);
  if (isControlTitle(event.summary ?? "")) {
    const { ensureFollowup } = await import("@/app/followup-db");
    await ensureFollowup();
    const linked = await db.prepare("SELECT id FROM patient_controls WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, appointmentId).first<{ id: number }>();
    if (!linked) {
      const stamp = now();
      await db.prepare("INSERT INTO patient_controls (owner_id, patient_id, due_on, reason, note, status, evolution_id, created_by, created_at, updated_at, appointment_id) VALUES (?, ?, ?, ?, '', 'agendado', NULL, 'Google Calendar', ?, ?, ?)")
        .bind(ownerId, patient.id, when.day, controlReasonFrom(reason), stamp, stamp, appointmentId).run();
    }
  }
  return appointmentId;
}

/** Aplica a la app lo leído de Google (todos los calendarios de una cuenta en una pasada). */
export async function applyGoogleEvents(ownerId: string, googleSub: string, seen: SeenEvent[], at: Date = new Date(), maxNew = 40): Promise<ApplyResult> {
  const out: ApplyResult = { moved: 0, cancelled: 0, restored: 0, imported: 0, unassigned: 0, ignored: 0, deferred: false };
  if (!seen.length) return out;
  const db = await ensureTwoWay();
  const { results } = await db.prepare("SELECT appointment_id, calendar_id, event_id, google_updated, app_changed_at, google_status, control_cancelled, ical_uid FROM appointment_google_events WHERE owner_id = ? AND google_sub = ?").bind(ownerId, googleSub).all<LinkRow>();
  const byId = new Map(results.map(row => [row.event_id, row]));
  const byUid = new Map(results.filter(row => row.ical_uid).map(row => [row.ical_uid as string, row]));
  let patients: Array<{ id: number; name: string; phone?: string; email?: string }> | null = null;
  for (const { calendarKey, importable, event } of mergeSeen(seen)) {
    let link = byId.get(event.id);
    // Borrado + creado de nuevo con el mismo iCalUID (p. ej. se copió a otro calendario y se borró el original): mismo enlace.
    if (!link && event.status !== "cancelled" && event.iCalUID) {
      const sameUid = byUid.get(event.iCalUID);
      if (sameUid && sameUid.event_id !== event.id) {
        await db.prepare("UPDATE appointment_google_events SET event_id = ?, calendar_id = ? WHERE owner_id = ? AND appointment_id = ?").bind(event.id, calendarKey, ownerId, sameUid.appointment_id).run();
        await db.prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(now(), ownerId, sameUid.calendar_id, sameUid.event_id).run();
        byId.delete(sameUid.event_id);
        link = { ...sameUid, event_id: event.id, calendar_id: calendarKey, google_updated: null, google_status: sameUid.google_status };
        byId.set(event.id, link);
      }
    }
    if (link) {
      // Una cancelación que llega del calendario anterior de un evento que se movió de calendario no cuenta.
      if (event.status === "cancelled" && link.calendar_id !== calendarKey) { out.ignored++; continue; }
      if (event.status !== "cancelled" && link.calendar_id !== calendarKey) {
        await db.prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(now(), ownerId, link.calendar_id, link.event_id).run();
        await db.prepare("UPDATE appointment_google_events SET calendar_id = ? WHERE owner_id = ? AND appointment_id = ?").bind(calendarKey, ownerId, link.appointment_id).run();
        link = { ...link, calendar_id: calendarKey };
        const patient = await db.prepare("SELECT patient_id FROM appointments WHERE id = ? AND owner_id = ?").bind(link.appointment_id, ownerId).first<{ patient_id: number }>();
        await upsertCalendarRow(db, ownerId, calendarKey, event, patient?.patient_id ?? null, false);
      }
      const appointment = await db.prepare("SELECT a.day, a.time, a.minutes, a.patient_id, a.reason, p.name FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id AND p.owner_id = a.owner_id WHERE a.id = ? AND a.owner_id = ?")
        .bind(link.appointment_id, ownerId).first<{ day: string; time: string; minutes: number | null; patient_id: number; reason: string; name: string | null }>();
      // El título que escribe la app puede llevar el box al final («Nombre · motivo · Box 2»): eso no es un cambio de motivo.
      const reasonOf = (title: string) => { const derived = reasonFromTitle(title, appointment?.name ?? ""); return appointment && derived.startsWith(appointment.reason + " · ") ? appointment.reason : derived; };
      const change: GoogleChange = decideGoogleChange(event, { googleUpdated: link.google_updated, appChangedAt: link.app_changed_at, cancelled: link.google_status === "cancelled" }, appointment ? { day: appointment.day, time: appointment.time, minutes: appointment.minutes, title: appointment.reason } : null, reasonOf);
      const seenAt = latestIso(link.google_updated, event.updated);
      if (change.kind === "update" && appointment) {
        let reasonPatch = "";
        const values: unknown[] = [change.day, change.time, change.minutes];
        if (change.title) { reasonPatch = ", reason = ?"; values.push(reasonOf(change.title)); }
        await db.prepare(`UPDATE appointments SET day = ?, time = ?, minutes = ?${reasonPatch} WHERE id = ? AND owner_id = ?`).bind(...values, link.appointment_id, ownerId).run();
        const { controlFollowsAppointment } = await import("@/app/followup-db");
        await controlFollowsAppointment(ownerId, link.appointment_id, { day: change.day });
        if (change.title && isControlTitle(change.title)) await db.prepare("UPDATE patient_controls SET reason = ?, updated_at = ? WHERE owner_id = ? AND appointment_id = ? AND status NOT IN ('realizado', 'descartado')").bind(controlReasonFrom(reasonOf(change.title)), now(), ownerId, link.appointment_id).run();
        if (change.restore) {
          const { setAttendance } = await import("@/app/attendance-db");
          await setAttendance(ownerId, "app", link.appointment_id, "agendada").catch(() => false);
          if (link.control_cancelled) await db.prepare("UPDATE patient_controls SET status = 'agendado', updated_at = ? WHERE owner_id = ? AND appointment_id = ? AND status = 'descartado'").bind(now(), ownerId, link.appointment_id).run();
          out.restored++;
        } else out.moved++;
        await upsertCalendarRow(db, ownerId, link.calendar_id, event, appointment.patient_id, false);
        await db.prepare("UPDATE appointment_google_events SET google_updated = ?, google_status = 'confirmed', control_cancelled = NULL, ical_uid = COALESCE(?, ical_uid) WHERE owner_id = ? AND appointment_id = ?").bind(seenAt, event.iCalUID ?? null, ownerId, link.appointment_id).run();
      } else if (change.kind === "cancel") {
        const { setAttendance } = await import("@/app/attendance-db");
        await setAttendance(ownerId, "app", link.appointment_id, "cancelada").catch(() => false);
        const stamp = now();
        const control = await db.prepare("SELECT id FROM patient_controls WHERE owner_id = ? AND appointment_id = ? AND status NOT IN ('realizado', 'descartado')").bind(ownerId, link.appointment_id).first<{ id: number }>().catch(() => null);
        if (control) await db.prepare("UPDATE patient_controls SET status = 'descartado', updated_at = ? WHERE owner_id = ? AND id = ?").bind(stamp, ownerId, control.id).run();
        await db.prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(stamp, ownerId, link.calendar_id, link.event_id).run();
        // El enlace se conserva (marcado cancelado): si el evento se restaura de la papelera, la cita vuelve.
        await db.prepare("UPDATE appointment_google_events SET google_status = 'cancelled', control_cancelled = ?, google_updated = ? WHERE owner_id = ? AND appointment_id = ?").bind(control ? 1 : 0, seenAt, ownerId, link.appointment_id).run();
        out.cancelled++;
      } else {
        if (seenAt !== link.google_updated && !(change.kind === "ignore" && change.why === "sin-cita")) await db.prepare("UPDATE appointment_google_events SET google_updated = ? WHERE owner_id = ? AND appointment_id = ?").bind(seenAt, ownerId, link.appointment_id).run();
        out.ignored++;
      }
      continue;
    }
    // Evento nuevo de Google (no lo creó la app): solo de los calendarios de la agenda, con hora y que parezca clínico.
    if (!importable || !isClinicalCandidate(event) || !inImportWindow(event.start!.dateTime!, at)) { out.ignored++; continue; }
    const known = await db.prepare("SELECT needs_patient, source_updated_at FROM calendar_events WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(ownerId, calendarKey, event.id).first<{ needs_patient: number | null; source_updated_at: string | null }>();
    // Ya marcada «Sin paciente» y sin cambios en Google: nada que hacer.
    if (known?.needs_patient && known.source_updated_at && event.updated && known.source_updated_at >= event.updated) { out.ignored++; continue; }
    // Muchas citas nuevas a la vez (primera lectura): se hacen por tandas; el resto en la próxima pasada.
    if (out.imported + out.unassigned >= maxNew) { out.deferred = true; continue; }
    patients ??= (await db.prepare("SELECT id, name, phone, email FROM patients WHERE owner_id = ?").bind(ownerId).all<{ id: number; name: string; phone?: string; email?: string }>()).results;
    const patient = matchPatientByTitle(event.summary ?? "", patients);
    if (patient) {
      const id = await createAppointmentFromGoogle(ownerId, googleSub, calendarKey, event, patient);
      if (id) { out.imported++; byId.set(event.id, { appointment_id: id, calendar_id: calendarKey, event_id: event.id, google_updated: event.updated ?? null, app_changed_at: null, google_status: "confirmed", control_cancelled: null, ical_uid: event.iCalUID ?? null }); continue; }
    }
    await upsertCalendarRow(db, ownerId, calendarKey, event, null, true);
    if (!known?.needs_patient) out.unassigned++;
  }
  return out;
}

/** Desde la agenda: asignar paciente a una cita de Google que quedó «Sin paciente – asignar». */
export async function assignPatientToCalendarEvent(ownerId: string, calendarEventId: number, patientId: number) {
  const db = await ensureTwoWay();
  const row = await db.prepare("SELECT calendar_id, google_event_id, title, start_at, end_at, source_updated_at FROM calendar_events WHERE id = ? AND owner_id = ? AND status <> 'cancelled'").bind(calendarEventId, ownerId).first<{ calendar_id: string; google_event_id: string; title: string; start_at: string; end_at: string; source_updated_at: string | null }>();
  const patient = await db.prepare("SELECT id, name FROM patients WHERE id = ? AND owner_id = ?").bind(patientId, ownerId).first<{ id: number; name: string }>();
  if (!row || !patient) return { ok: false as const, error: "Cita o paciente no encontrado." };
  const googleSub = row.calendar_id.startsWith("g:") ? row.calendar_id.split(":")[1] : "";
  const event: IncomingGoogleEvent = { id: row.google_event_id, status: "confirmed", summary: row.title, updated: row.source_updated_at ?? undefined, start: { dateTime: row.start_at }, end: { dateTime: row.end_at } };
  if (googleSub) {
    const linked = await db.prepare("SELECT appointment_id FROM appointment_google_events WHERE owner_id = ? AND event_id = ?").bind(ownerId, row.google_event_id).first<{ appointment_id: number }>();
    if (linked) {
      await db.prepare("UPDATE appointments SET patient_id = ? WHERE id = ? AND owner_id = ?").bind(patient.id, linked.appointment_id, ownerId).run();
      await db.prepare("UPDATE calendar_events SET patient_id = ?, needs_patient = 0 WHERE id = ? AND owner_id = ?").bind(patient.id, calendarEventId, ownerId).run();
      return { ok: true as const, appointmentId: linked.appointment_id };
    }
    const id = await createAppointmentFromGoogle(ownerId, googleSub, row.calendar_id, event, patient);
    return id ? { ok: true as const, appointmentId: id } : { ok: false as const, error: "No se pudo crear la cita." };
  }
  // Calendario iCal (sin Google): solo se reconoce al paciente en la agenda.
  await db.prepare("UPDATE calendar_events SET patient_id = ?, needs_patient = 0 WHERE id = ? AND owner_id = ?").bind(patient.id, calendarEventId, ownerId).run();
  return { ok: true as const, appointmentId: null };
}

/** Para la agenda: duración de cada cita, citas de Google sin paciente y lo pendiente de sincronizar. */
export async function agendaSyncFlags(ownerId: string) {
  const db = await ensureTwoWay();
  const minutes: Record<number, number> = Object.fromEntries((await db.prepare("SELECT id, minutes FROM appointments WHERE owner_id = ? AND minutes IS NOT NULL").bind(ownerId).all<{ id: number; minutes: number }>()).results.map(row => [row.id, row.minutes]));
  const needsPatient = (await db.prepare("SELECT id FROM calendar_events WHERE owner_id = ? AND needs_patient = 1 AND patient_id IS NULL AND status <> 'cancelled'").bind(ownerId).all<{ id: number }>()).results.map(row => row.id);
  const pendingAppointments = await pendingAppointmentIds(ownerId);
  const pendingEvents = pendingAppointments.length
    ? (await db.prepare("SELECT e.id FROM google_pending_writes w JOIN appointment_google_events l ON l.owner_id = w.owner_id AND l.appointment_id = w.appointment_id JOIN calendar_events e ON e.owner_id = l.owner_id AND e.calendar_id = l.calendar_id AND e.google_event_id = l.event_id WHERE w.owner_id = ?").bind(ownerId).all<{ id: number }>()).results.map(row => row.id)
    : [];
  return { minutes, needsPatient, pendingAppointments, pendingEvents };
}
