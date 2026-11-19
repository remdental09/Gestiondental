import { env } from "cloudflare:workers";
import { allowReschedule, claimControlForAgenda, controlsMissingAppointment, getControl, linkControlAppointment, type Control } from "@/app/followup-db";
import { controlAppointmentReason, DEFAULT_CONTROL_TIME, isClockTime } from "@/lib/next-control";
import type { CalendarPushStatus } from "@/app/drive-oauth";

/**
 * Cada próximo control queda como cita en la agenda de la app (y en Google Calendar si la cuenta conectada
 * dio permiso de escritura). El control guarda el id de la cita y la sigue si se mueve o se borra.
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };
export type AgendaOutcome = { control: Control | null; calendar: CalendarPushStatus | "sin-cita" };

const patientName = async (ownerId: string, patientId: number) =>
  (await database().prepare("SELECT name FROM patients WHERE id = ? AND owner_id = ?").bind(patientId, ownerId).first<{ name: string }>())?.name ?? "";

/** Crea la cita del control (una sola vez) y la escribe en Google Calendar si se puede. */
export async function scheduleControl(ownerId: string, controlId: number, time: string = DEFAULT_CONTROL_TIME): Promise<AgendaOutcome> {
  if (!(await claimControlForAgenda(ownerId, controlId))) return { control: await getControl(ownerId, controlId), calendar: "sin-cita" };
  const control = await getControl(ownerId, controlId);
  if (!control) return { control: null, calendar: "sin-cita" };
  const reason = controlAppointmentReason(control.reason);
  const hour = isClockTime(time) ? time : DEFAULT_CONTROL_TIME;
  let appointmentId: number | null = null;
  try {
    const row = await database().prepare("INSERT INTO appointments (owner_id, patient_id, day, time, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(ownerId, control.patientId, control.dueOn, hour, reason, new Date().toISOString()).first<{ id: number }>();
    appointmentId = row?.id ?? null;
  } finally {
    await linkControlAppointment(ownerId, controlId, appointmentId);
  }
  if (!appointmentId) return { control: await getControl(ownerId, controlId), calendar: "sin-cita" };
  const { pushAppointmentToGoogle } = await import("@/app/drive-oauth");
  const calendar = await pushAppointmentToGoogle(ownerId, { id: appointmentId, day: control.dueOn, time: hour, reason }, await patientName(ownerId, control.patientId), control.patientId).catch(() => "error" as const);
  return { control: await getControl(ownerId, controlId), calendar };
}

/** Nueva fecha u hora del control → la cita (y su evento de Google) se mueve igual. */
export async function moveControlAppointment(ownerId: string, control: Control, change: { day: string; time?: string; reason: string }): Promise<CalendarPushStatus | "sin-cita"> {
  if (!control.appointmentId) return "sin-cita";
  const current = await database().prepare("SELECT time FROM appointments WHERE id = ? AND owner_id = ?").bind(control.appointmentId, ownerId).first<{ time: string }>();
  if (!current) return "sin-cita";
  const time = change.time && isClockTime(change.time) ? change.time : current.time;
  const reason = controlAppointmentReason(change.reason);
  await database().prepare("UPDATE appointments SET day = ?, time = ?, reason = ? WHERE id = ? AND owner_id = ?").bind(change.day, time, reason, control.appointmentId, ownerId).run();
  const { rescheduleAppointmentInGoogle } = await import("@/app/drive-oauth");
  return rescheduleAppointmentInGoogle(ownerId, control.appointmentId, { day: change.day, time, title: [await patientName(ownerId, control.patientId), reason].filter(Boolean).join(" · ") }).catch(() => "error" as const);
}

/** Control descartado → se quita su cita (también de Google). */
export async function cancelControlAppointment(ownerId: string, control: Control): Promise<CalendarPushStatus | "sin-cita"> {
  if (!control.appointmentId) return "sin-cita";
  const { deleteAppointmentEverywhere } = await import("@/app/drive-oauth");
  const status = await deleteAppointmentEverywhere(ownerId, control.appointmentId).catch(() => "error" as const);
  const { controlFollowsAppointment } = await import("@/app/followup-db");
  await controlFollowsAppointment(ownerId, control.appointmentId, { deleted: true });
  return status;
}

/** Control realizado → su cita queda «Atendida» (agenda y dashboard), también el evento de Google enlazado. */
export async function completeControlAppointment(ownerId: string, control: Control) {
  if (!control.appointmentId) return;
  const { setAttendance } = await import("@/app/attendance-db");
  await setAttendance(ownerId, "app", control.appointmentId, "atendida").catch(() => false);
  const linked = await database().prepare("SELECT e.id AS id FROM appointment_google_events l JOIN calendar_events e ON e.owner_id = l.owner_id AND e.calendar_id = l.calendar_id AND e.google_event_id = l.event_id WHERE l.owner_id = ? AND l.appointment_id = ?")
    .bind(ownerId, control.appointmentId).first<{ id: number }>().catch(() => null);
  if (linked) await setAttendance(ownerId, "cal", linked.id, "atendida").catch(() => false);
}

/**
 * Control descartado porque su evento se borró en Google Calendar (la cita quedó «Cancelada», no se borró):
 * al reabrirlo, la cita vuelve a «Agendada» con la fecha del control y se crea de nuevo en Google si hay permiso.
 */
export async function restoreCancelledControl(ownerId: string, control: Control, time?: string): Promise<CalendarPushStatus | "sin-cita"> {
  if (!control.appointmentId) return "sin-cita";
  const appointment = await database().prepare("SELECT id, day, time, reason FROM appointments WHERE id = ? AND owner_id = ?").bind(control.appointmentId, ownerId).first<{ id: number; day: string; time: string; reason: string }>();
  if (!appointment) {
    await database().prepare("UPDATE patient_controls SET appointment_id = NULL WHERE id = ? AND owner_id = ?").bind(control.id, ownerId).run();
    return (await scheduleControl(ownerId, control.id, time)).calendar;
  }
  const hour = time && isClockTime(time) ? time : appointment.time;
  const reason = controlAppointmentReason(control.reason);
  await database().prepare("UPDATE appointments SET day = ?, time = ?, reason = ? WHERE id = ? AND owner_id = ?").bind(control.dueOn, hour, reason, appointment.id, ownerId).run();
  const { setAttendance } = await import("@/app/attendance-db");
  await setAttendance(ownerId, "app", appointment.id, "agendada").catch(() => false);
  await linkControlAppointment(ownerId, control.id, appointment.id);
  const linked = await database().prepare("SELECT event_id FROM appointment_google_events WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, appointment.id).first<{ event_id: string }>().catch(() => null);
  if (linked) return moveControlAppointment(ownerId, { ...control, appointmentId: appointment.id }, { day: control.dueOn, time: hour, reason: control.reason });
  const { pushAppointmentToGoogle } = await import("@/app/drive-oauth");
  return pushAppointmentToGoogle(ownerId, { id: appointment.id, day: control.dueOn, time: hour, reason }, await patientName(ownerId, control.patientId), control.patientId).catch(() => "error" as const);
}

/** Vuelve a permitir agendar un control al que se le quitó la cita y la crea. */
export async function rescheduleRemovedControl(ownerId: string, controlId: number, time?: string) {
  await allowReschedule(ownerId, controlId);
  return scheduleControl(ownerId, controlId, time);
}

/** Controles pendientes (de hoy en adelante) creados antes de esta función: se les crea su cita una vez. */
export async function backfillControlAppointments(ownerId: string, today: string) {
  let created = 0;
  for (const id of await controlsMissingAppointment(ownerId, today)) {
    const outcome = await scheduleControl(ownerId, id).catch(() => null);
    if (outcome?.control?.appointmentId) created++;
  }
  return created;
}
