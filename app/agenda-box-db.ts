import { db as boxDatabase, ensureBoxSchema, listBoxes, type TreatmentBox } from "@/app/box-db";
import { ensureAttendance } from "@/app/attendance-db";
import { checkBlock, checkSchedule, isClock, isIsoDay, parseWeekdays, DURATIONS, type AgendaBlock, type BoxSchedule } from "@/lib/agenda-box";
import { isAttendanceStatus, type AttendanceStatus } from "@/lib/dashboard";
import { chileDayTime } from "@/lib/calendar-two-way";

/**
 * Agenda por box (estilo Dentalsoft). Todo filtra por owner_id (espacio). Solo agrega tablas/columnas:
 * box_schedules (horarios por box y profesional), agenda_blocks (bloqueos, se quitan con removed_at),
 * appointments.box_id / appointments.professional. El estado de la cita sigue en appointment_attendance (PR #339).
 */
type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const now = () => new Date().toISOString();
async function database(): Promise<Db> {
  const db = boxDatabase() as Db | undefined;
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureBoxSchema(db as never);
  return db;
}
const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

type ScheduleRow = { id: number; box_id: number; professional: string; weekdays: string; start_time: string; end_time: string; valid_from: string | null; valid_to: string | null; block_minutes: number };
const scheduleOf = (r: ScheduleRow): BoxSchedule => ({ id: r.id, boxId: r.box_id, professional: r.professional, weekdays: parseWeekdays(r.weekdays), start: r.start_time, end: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, blockMinutes: r.block_minutes });

export async function listSchedules(ownerId: string): Promise<BoxSchedule[]> {
  const db = await database();
  const { results } = await db.prepare("SELECT id, box_id, professional, weekdays, start_time, end_time, valid_from, valid_to, block_minutes FROM box_schedules WHERE owner_id = ? ORDER BY box_id, start_time").bind(ownerId).all<ScheduleRow>();
  return results.map(scheduleOf);
}

export async function saveSchedule(ownerId: string, input: Record<string, unknown>, defaultProfessional: string): Promise<{ ok: true; schedules: BoxSchedule[] } | { ok: false; error: string }> {
  const db = await database();
  const boxId = Number(input.boxId);
  const boxes = await listBoxes(ownerId);
  if (!boxes.some(b => b.id === boxId)) return { ok: false, error: "Elige un box." };
  const checked = checkSchedule(input as never);
  if (!checked.ok) return checked;
  const professional = text(input.professional, 80) || defaultProfessional;
  const id = Number(input.id);
  if (Number.isSafeInteger(id) && id > 0) {
    await db.prepare("UPDATE box_schedules SET box_id = ?, professional = ?, weekdays = ?, start_time = ?, end_time = ?, valid_from = ?, valid_to = ?, block_minutes = ? WHERE id = ? AND owner_id = ?")
      .bind(boxId, professional, checked.weekdays.join(","), checked.start, checked.end, checked.validFrom, checked.validTo, checked.blockMinutes, id, ownerId).run();
  } else {
    const count = await db.prepare("SELECT COUNT(*) AS n FROM box_schedules WHERE owner_id = ?").bind(ownerId).first<{ n: number }>();
    if ((count?.n ?? 0) >= 100) return { ok: false, error: "Máximo 100 horarios." };
    await db.prepare("INSERT INTO box_schedules (owner_id, box_id, professional, weekdays, start_time, end_time, valid_from, valid_to, block_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ownerId, boxId, professional, checked.weekdays.join(","), checked.start, checked.end, checked.validFrom, checked.validTo, checked.blockMinutes, now()).run();
  }
  return { ok: true, schedules: await listSchedules(ownerId) };
}

export async function deleteSchedule(ownerId: string, id: number): Promise<BoxSchedule[]> {
  const db = await database();
  await db.prepare("DELETE FROM box_schedules WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  return listSchedules(ownerId);
}

type BlockRow = { id: number; box_id: number | null; day: string; start_time: string; end_time: string; repeat: string; until: string | null; reason: string; note: string };
const blockOf = (r: BlockRow): AgendaBlock => ({ id: r.id, boxId: r.box_id, day: r.day, start: r.start_time, end: r.end_time, repeat: r.repeat === "weekly" || r.repeat === "daily" ? r.repeat : "none", until: r.until, reason: r.reason, note: r.note });

/** Bloqueos que pueden caer entre from y to (los repetidos se expanden en la vista). */
export async function listBlocks(ownerId: string, from: string, to: string): Promise<AgendaBlock[]> {
  const db = await database();
  const { results } = await db.prepare("SELECT id, box_id, day, start_time, end_time, repeat, until, reason, note FROM agenda_blocks WHERE owner_id = ? AND removed_at IS NULL AND day <= ? AND ((repeat = 'none' AND day >= ?) OR (repeat <> 'none' AND (until IS NULL OR until >= ?))) ORDER BY day, start_time LIMIT 500")
    .bind(ownerId, to, from, from).all<BlockRow>();
  return results.map(blockOf);
}

export async function addBlock(ownerId: string, input: Record<string, unknown>): Promise<{ ok: true; block: AgendaBlock } | { ok: false; error: string }> {
  const db = await database();
  const checked = checkBlock(input as { day: unknown; start: unknown; end: unknown; repeat?: unknown; until?: unknown });
  if (!checked.ok) return checked;
  const boxId = input.boxId === null || input.boxId === undefined || input.boxId === "" ? null : Number(input.boxId);
  if (boxId !== null && !(await listBoxes(ownerId)).some(b => b.id === boxId)) return { ok: false, error: "Box no encontrado." };
  const reason = text(input.reason, 120) || "Bloqueado";
  const note = text(input.note, 500);
  const row = await db.prepare("INSERT INTO agenda_blocks (owner_id, box_id, day, start_time, end_time, repeat, until, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, box_id, day, start_time, end_time, repeat, until, reason, note")
    .bind(ownerId, boxId, checked.day, checked.start, checked.end, checked.repeat, checked.until, reason, note, now()).first<BlockRow>();
  return row ? { ok: true, block: blockOf(row) } : { ok: false, error: "No se pudo guardar el bloqueo." };
}

/** Quitar un bloqueo (toda la serie si se repite). Queda marcado, no se borra. */
export async function removeBlock(ownerId: string, id: number): Promise<boolean> {
  const db = await database();
  const found = await db.prepare("SELECT id FROM agenda_blocks WHERE id = ? AND owner_id = ? AND removed_at IS NULL").bind(id, ownerId).first<{ id: number }>();
  if (!found) return false;
  await db.prepare("UPDATE agenda_blocks SET removed_at = ? WHERE id = ? AND owner_id = ?").bind(now(), id, ownerId).run();
  return true;
}

export type BoxAppointment = {
  key: string; source: "app" | "cal"; id: number; patientId: number | null; patientName: string; phone: string; day: string; start: string; minutes: number;
  reason: string; boxId: number | null; professional: string; status: AttendanceStatus; google: boolean; needsPatient: boolean;
};

/** Citas de la app (con su box y estado) y eventos de Google que no son citas de la app (van a «Sin box»), entre from y to. */
export async function loadBoxAppointments(ownerId: string, from: string, to: string): Promise<BoxAppointment[]> {
  const db = await database();
  await ensureAttendance(db as never);
  const statuses = new Map<string, AttendanceStatus>();
  for (const row of (await db.prepare("SELECT source, ref_id, status FROM appointment_attendance WHERE owner_id = ?").bind(ownerId).all<{ source: string; ref_id: number; status: string }>()).results)
    if (isAttendanceStatus(row.status)) statuses.set(`${row.source}:${row.ref_id}`, row.status);
  type AppRow = { id: number; patient_id: number | null; day: string; time: string; reason: string; minutes: number | null; box_id: number | null; professional: string | null; name: string | null; phone: string | null; cal_id: number | null; cal_status: string | null };
  let linked = true;
  let appRows: AppRow[];
  try {
    appRows = (await db.prepare("SELECT a.id, a.patient_id, a.day, a.time, a.reason, a.minutes, a.box_id, a.professional, p.name, p.phone, ce.id AS cal_id, ce.status AS cal_status FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id AND p.owner_id = a.owner_id LEFT JOIN appointment_google_events g ON g.owner_id = a.owner_id AND g.appointment_id = a.id LEFT JOIN calendar_events ce ON ce.owner_id = a.owner_id AND ce.calendar_id = g.calendar_id AND ce.google_event_id = g.event_id WHERE a.owner_id = ? AND a.day >= ? AND a.day <= ? ORDER BY a.day, a.time LIMIT 1000")
      .bind(ownerId, from, to).all<AppRow>()).results;
  } catch { // sin conexión a Google nunca: no existen las tablas de enlace
    linked = false;
    appRows = (await db.prepare("SELECT a.id, a.patient_id, a.day, a.time, a.reason, a.minutes, a.box_id, a.professional, p.name, p.phone, NULL AS cal_id, NULL AS cal_status FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id AND p.owner_id = a.owner_id WHERE a.owner_id = ? AND a.day >= ? AND a.day <= ? ORDER BY a.day, a.time LIMIT 1000")
      .bind(ownerId, from, to).all<AppRow>()).results;
  }
  const out: BoxAppointment[] = [];
  const seen = new Set<string>();
  for (const r of appRows) {
    const status = statuses.get(`app:${r.id}`) ?? (r.cal_id ? statuses.get(`cal:${r.cal_id}`) : undefined) ?? (r.cal_status === "cancelled" ? "cancelada" : "agendada");
    out.push({ key: `app:${r.id}`, source: "app", id: r.id, patientId: r.patient_id, patientName: r.name ?? "Paciente", phone: r.phone ?? "", day: r.day, start: r.time, minutes: r.minutes && r.minutes > 0 ? r.minutes : 30, reason: r.reason, boxId: r.box_id ?? null, professional: r.professional ?? "", status, google: Boolean(r.cal_id), needsPatient: false });
    seen.add(`${r.patient_id}|${r.day}|${r.time}`);
  }
  if (!linked) return out;
  // Eventos de Google sin cita en la app (p. ej. «Sin paciente – asignar»): se ven en «Sin box».
  const fromIso = new Date(Date.parse(from + "T00:00:00Z") - 86400000).toISOString();
  const toIso = new Date(Date.parse(to + "T00:00:00Z") + 2 * 86400000).toISOString();
  type CalRow = { id: number; title: string; start_at: string; end_at: string; status: string; patient_id: number | null; needs_patient: number | null; name: string | null; phone: string | null };
  const calRows = (await db.prepare("SELECT ce.id, ce.title, ce.start_at, ce.end_at, ce.status, ce.patient_id, ce.needs_patient, p.name, p.phone FROM calendar_events ce LEFT JOIN patients p ON p.id = ce.patient_id AND p.owner_id = ce.owner_id LEFT JOIN appointment_google_events g ON g.owner_id = ce.owner_id AND g.calendar_id = ce.calendar_id AND g.event_id = ce.google_event_id WHERE ce.owner_id = ? AND ce.all_day = 0 AND ce.start_at >= ? AND ce.start_at < ? AND g.appointment_id IS NULL ORDER BY ce.start_at LIMIT 500")
    .bind(ownerId, fromIso, toIso).all<CalRow>().catch(() => ({ results: [] as CalRow[] }))).results;
  for (const r of calRows) {
    const when = chileDayTime(r.start_at);
    if (!when || when.day < from || when.day > to) continue;
    if (r.status === "cancelled" && !statuses.has(`cal:${r.id}`)) continue;
    if (r.patient_id !== null && seen.has(`${r.patient_id}|${when.day}|${when.time}`)) continue;
    const minutes = Math.max(15, Math.round((Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000) || 30);
    out.push({ key: `cal:${r.id}`, source: "cal", id: r.id, patientId: r.patient_id, patientName: r.name ?? r.title, phone: r.phone ?? "", day: when.day, start: when.time, minutes, reason: r.name ? r.title : "", boxId: null, professional: "", status: statuses.get(`cal:${r.id}`) ?? "agendada", google: true, needsPatient: r.needs_patient === 1 });
  }
  return out;
}

/** Estado desde la tarjeta: se guarda en la cita de la app y en su evento de Google enlazado (Dashboard y agenda semanal lo ven igual). */
export async function setBoxStatus(ownerId: string, source: "app" | "cal", id: number, status: AttendanceStatus): Promise<boolean> {
  const { setAttendance } = await import("@/app/attendance-db");
  if (!(await setAttendance(ownerId, source, id, status))) return false;
  if (source === "app") {
    const db = await database();
    const linked = await db.prepare("SELECT ce.id FROM appointment_google_events g JOIN calendar_events ce ON ce.owner_id = g.owner_id AND ce.calendar_id = g.calendar_id AND ce.google_event_id = g.event_id WHERE g.owner_id = ? AND g.appointment_id = ?").bind(ownerId, id).first<{ id: number }>().catch(() => null);
    if (linked) await setAttendance(ownerId, "cal", linked.id, status).catch(() => false);
  }
  return true;
}

type NewAppointment = { patientId?: unknown; newPatient?: { name?: unknown; phone?: unknown; rut?: unknown }; day: unknown; time: unknown; minutes?: unknown; boxId?: unknown; reason?: unknown; professional?: unknown };
/** «Detalle cita»: nueva cita en un box (con paciente existente o nuevo); se escribe en Google con el box en «lugar». */
export async function createBoxAppointment(ownerId: string, input: NewAppointment, defaultProfessional: string): Promise<{ ok: true; appointment: BoxAppointment; calendar: string } | { ok: false; error: string }> {
  const db = await database();
  if (!isIsoDay(input.day) || !isClock(input.time)) return { ok: false, error: "Revisa la fecha y la hora." };
  const minutes = DURATIONS.includes(Number(input.minutes)) ? Number(input.minutes) : 30;
  const boxes = await listBoxes(ownerId);
  const boxId = input.boxId === null || input.boxId === undefined || input.boxId === "" ? null : Number(input.boxId);
  const box: TreatmentBox | undefined = boxId === null ? undefined : boxes.find(b => b.id === boxId && b.enabled);
  if (boxId !== null && !box) return { ok: false, error: "Ese box no está disponible." };
  let patient: { id: number; name: string; phone: string } | null = null;
  if (input.newPatient) {
    const name = text(input.newPatient.name, 120);
    if (name.length < 3) return { ok: false, error: "Escribe el nombre del paciente nuevo." };
    const phone = text(input.newPatient.phone, 30);
    const stamp = now();
    const row = await db.prepare("INSERT INTO patients (owner_id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id").bind(ownerId, name, phone, stamp, stamp).first<{ id: number }>();
    if (!row) return { ok: false, error: "No se pudo crear el paciente." };
    patient = { id: row.id, name, phone };
  } else {
    const id = Number(input.patientId);
    const row = Number.isSafeInteger(id) && id > 0 ? await db.prepare("SELECT id, name, phone FROM patients WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<{ id: number; name: string; phone: string }>() : null;
    if (!row) return { ok: false, error: "Elige un paciente o crea uno nuevo." };
    patient = row;
  }
  const reason = text(input.reason, 500) || "Atención";
  const professional = text(input.professional, 80) || defaultProfessional;
  const row = await db.prepare("INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at, minutes, box_id, professional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(ownerId, patient.id, input.day, input.time, reason, now(), minutes, box?.id ?? null, professional).first<{ id: number }>();
  if (!row) return { ok: false, error: "No se pudo guardar la cita." };
  const { pushAppointmentToGoogle } = await import("@/app/drive-oauth");
  const calendar = await pushAppointmentToGoogle(ownerId, { id: row.id, day: input.day, time: input.time, reason, minutes, ...(box ? { box: box.name } : {}) }, patient.name, patient.id).catch(() => "error" as const);
  return { ok: true, calendar, appointment: { key: `app:${row.id}`, source: "app", id: row.id, patientId: patient.id, patientName: patient.name, phone: patient.phone, day: input.day, start: input.time, minutes, reason, boxId: box?.id ?? null, professional, status: "agendada", google: calendar === "ok", needsPatient: false } };
}

/** Mover una cita de la app a otro box (y/u otra hora/duración). Si está en Google, se actualiza el evento (lugar incluido). */
export async function updateBoxAppointment(ownerId: string, id: number, change: { boxId?: unknown; time?: unknown; day?: unknown; minutes?: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await database();
  const current = await db.prepare("SELECT id, day, time, minutes, box_id FROM appointments WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<{ id: number; day: string; time: string; minutes: number | null; box_id: number | null }>();
  if (!current) return { ok: false, error: "Cita no encontrada." };
  let boxId = current.box_id;
  if (change.boxId !== undefined) {
    boxId = change.boxId === null || change.boxId === "" ? null : Number(change.boxId);
    if (boxId !== null && !(await listBoxes(ownerId)).some(b => b.id === boxId && b.enabled)) return { ok: false, error: "Ese box no está disponible." };
  }
  const day = change.day === undefined ? current.day : isIsoDay(change.day) ? change.day : null;
  const time = change.time === undefined ? current.time : isClock(change.time) ? change.time : null;
  if (!day || !time) return { ok: false, error: "Revisa la fecha y la hora." };
  const minutes = change.minutes === undefined ? current.minutes : DURATIONS.includes(Number(change.minutes)) ? Number(change.minutes) : current.minutes;
  const twoWay = await import("@/app/calendar-two-way");
  const link = await db.prepare("SELECT appointment_id FROM appointment_google_events WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, id).first<{ appointment_id: number }>().catch(() => null);
  if (link) await twoWay.markAppChanged(ownerId, id).catch(() => undefined);
  await db.prepare("UPDATE appointments SET box_id = ?, day = ?, time = ?, minutes = ? WHERE id = ? AND owner_id = ?").bind(boxId, day, time, minutes, id, ownerId).run();
  if (day !== current.day) {
    const { controlFollowsAppointment } = await import("@/app/followup-db");
    await controlFollowsAppointment(ownerId, id, { day }).catch(() => undefined);
  }
  if (link) {
    // Se escribe en Google a través de la cola: si falla, queda «pendiente de sincronizar» y se reintenta sola.
    await twoWay.enqueuePending(ownerId, id, "upsert", "cambio de box/hora").catch(() => undefined);
    const { processPendingWrites } = await import("@/app/drive-oauth");
    await processPendingWrites(ownerId).catch(() => undefined);
  }
  return { ok: true };
}
