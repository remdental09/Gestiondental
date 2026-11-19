import { env } from "cloudflare:workers";
import { normalizeAlertKind, normalizeAlertText, type AlertKind, type ManualAlert } from "@/lib/patient-alerts";
import { isControlStatus, type ControlStatus } from "@/lib/next-control";
import { normalizeValidityDays } from "@/lib/budget-status";

/**
 * Tablas aditivas (se crean solas si faltan) para alertas manuales, próximos controles y preferencias del espacio.
 * Toda lectura/escritura filtra por owner_id: un espacio nunca ve datos de otro.
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };

export const FOLLOWUP_DDL = [
  "CREATE TABLE IF NOT EXISTS patient_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS patient_alerts_owner_patient ON patient_alerts (owner_id, patient_id)",
  "CREATE TABLE IF NOT EXISTS patient_controls (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, due_on TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendiente', evolution_id INTEGER, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS patient_controls_owner_due ON patient_controls (owner_id, due_on)",
  "CREATE TABLE IF NOT EXISTS owner_prefs (owner_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, key))",
];
export const CONTROL_APPOINTMENT_DDL = "ALTER TABLE patient_controls ADD COLUMN appointment_id INTEGER";
let ready: Promise<void> | null = null;
export async function ensureFollowup() { return ensure(); }
async function ensure() {
  const db = database();
  ready ??= (async () => {
    for (const sql of FOLLOWUP_DDL) await db.prepare(sql).run();
    // Cita de agenda creada para el control: NULL = aún no se agenda, 0 = se quitó de la agenda a propósito (no se recrea), > 0 = id de la cita.
    try { await db.prepare(CONTROL_APPOINTMENT_DDL).run(); } catch { /* la columna ya existe */ }
  })().catch((cause) => { ready = null; throw cause; });
  await ready;
  return db;
}

type AlertRow = { id: number; kind: string; text: string; updated_at: string };
const alertView = (row: AlertRow): ManualAlert => ({ id: row.id, kind: normalizeAlertKind(row.kind) ?? "medica", text: row.text, updatedAt: row.updated_at });

export async function listAlerts(ownerId: string, patientId: number): Promise<ManualAlert[]> {
  const db = await ensure();
  const { results } = await db.prepare("SELECT id, kind, text, updated_at FROM patient_alerts WHERE owner_id = ? AND patient_id = ? ORDER BY id").bind(ownerId, patientId).all<AlertRow>();
  return results.map(alertView);
}
export async function addAlert(ownerId: string, patientId: number, kind: AlertKind, text: string): Promise<ManualAlert> {
  const db = await ensure(), now = new Date().toISOString();
  const row = await db.prepare("INSERT INTO patient_alerts (owner_id, patient_id, kind, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, kind, text, updated_at").bind(ownerId, patientId, kind, normalizeAlertText(text), now, now).first<AlertRow>();
  if (!row) throw new Error("No se pudo guardar la alerta.");
  return alertView(row);
}
export async function updateAlert(ownerId: string, patientId: number, id: number, text: string): Promise<ManualAlert | null> {
  const db = await ensure();
  const row = await db.prepare("UPDATE patient_alerts SET text = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND patient_id = ? RETURNING id, kind, text, updated_at").bind(normalizeAlertText(text), new Date().toISOString(), id, ownerId, patientId).first<AlertRow>();
  return row ? alertView(row) : null;
}
export async function deleteAlert(ownerId: string, patientId: number, id: number): Promise<boolean> {
  const db = await ensure();
  const row = await db.prepare("DELETE FROM patient_alerts WHERE id = ? AND owner_id = ? AND patient_id = ? RETURNING id").bind(id, ownerId, patientId).first<{ id: number }>();
  return !!row;
}

export type Control = { id: number; patientId: number; dueOn: string; reason: string; note: string; status: ControlStatus; evolutionId: number | null; createdBy: string; createdAt: string; updatedAt: string; appointmentId: number | null; appointmentTime?: string; patientName?: string; patientPhone?: string };
type ControlRow = { id: number; patient_id: number; due_on: string; reason: string; note: string; status: string; evolution_id: number | null; created_by: string; created_at: string; updated_at: string; appointment_id?: number | null; appointment_time?: string | null; name?: string; phone?: string };
const controlView = (row: ControlRow): Control => ({
  id: row.id, patientId: row.patient_id, dueOn: row.due_on, reason: row.reason, note: row.note, status: isControlStatus(row.status) ? row.status : "pendiente",
  evolutionId: row.evolution_id ?? null, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  appointmentId: row.appointment_id && row.appointment_id > 0 ? row.appointment_id : null, ...(row.appointment_time ? { appointmentTime: row.appointment_time } : {}),
  ...(row.name !== undefined ? { patientName: row.name, patientPhone: row.phone ?? "" } : {}),
});
const CONTROL_COLUMNS = "c.id, c.patient_id, c.due_on, c.reason, c.note, c.status, c.evolution_id, c.created_by, c.created_at, c.updated_at, c.appointment_id";
const RETURNING = "RETURNING id, patient_id, due_on, reason, note, status, evolution_id, created_by, created_at, updated_at, appointment_id";

/** Controles del espacio con nombre y teléfono del paciente (solo pacientes del mismo espacio). */
export async function listControls(ownerId: string, patientId?: number): Promise<Control[]> {
  const db = await ensure();
  const sql = `SELECT ${CONTROL_COLUMNS}, a.time AS appointment_time, p.name, p.phone FROM patient_controls c JOIN patients p ON p.id = c.patient_id AND p.owner_id = c.owner_id LEFT JOIN appointments a ON a.id = c.appointment_id AND a.owner_id = c.owner_id WHERE c.owner_id = ?${patientId ? " AND c.patient_id = ?" : ""} ORDER BY c.due_on, c.id LIMIT 2000`;
  const stmt = patientId ? db.prepare(sql).bind(ownerId, patientId) : db.prepare(sql).bind(ownerId);
  return (await stmt.all<ControlRow>()).results.map(controlView);
}
export async function addControl(ownerId: string, input: { patientId: number; dueOn: string; reason: string; note: string; evolutionId: number | null; createdBy: string }): Promise<Control> {
  const db = await ensure(), now = new Date().toISOString();
  if (input.evolutionId) {
    // Reintento del mismo guardado de dictado: no se duplica el control de esa evolución.
    const existing = await db.prepare(`SELECT ${CONTROL_COLUMNS} FROM patient_controls c WHERE c.owner_id = ? AND c.patient_id = ? AND c.evolution_id = ? AND c.due_on = ?`).bind(ownerId, input.patientId, input.evolutionId, input.dueOn).first<ControlRow>();
    if (existing) return controlView(existing);
  }
  const row = await db.prepare(`INSERT INTO patient_controls (owner_id, patient_id, due_on, reason, note, status, evolution_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?) ${RETURNING}`)
    .bind(ownerId, input.patientId, input.dueOn, input.reason, input.note, input.evolutionId, input.createdBy, now, now).first<ControlRow>();
  if (!row) throw new Error("No se pudo guardar el control.");
  return controlView(row);
}
export async function updateControl(ownerId: string, id: number, patch: { dueOn?: string; reason?: string; note?: string; status?: ControlStatus }): Promise<Control | null> {
  const db = await ensure();
  const sets: string[] = [], values: unknown[] = [];
  if (patch.dueOn !== undefined) { sets.push("due_on = ?"); values.push(patch.dueOn); }
  if (patch.reason !== undefined) { sets.push("reason = ?"); values.push(patch.reason); }
  if (patch.note !== undefined) { sets.push("note = ?"); values.push(patch.note); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (!sets.length) return null;
  const row = await db.prepare(`UPDATE patient_controls SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND owner_id = ? ${RETURNING}`)
    .bind(...values, new Date().toISOString(), id, ownerId).first<ControlRow>();
  return row ? controlView(row) : null;
}
export async function deleteControl(ownerId: string, id: number): Promise<boolean> {
  const db = await ensure();
  return !!(await db.prepare("DELETE FROM patient_controls WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first<{ id: number }>());
}

export async function getBudgetValidityDays(ownerId: string): Promise<number> {
  const db = await ensure();
  const row = await db.prepare("SELECT value FROM owner_prefs WHERE owner_id = ? AND key = 'budgetValidityDays'").bind(ownerId).first<{ value: string }>();
  return normalizeValidityDays(row?.value);
}
export async function setBudgetValidityDays(ownerId: string, days: number): Promise<number> {
  const db = await ensure(), value = normalizeValidityDays(days);
  await db.prepare("INSERT INTO owner_prefs (owner_id, key, value, updated_at) VALUES (?, 'budgetValidityDays', ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(ownerId, String(value), new Date().toISOString()).run();
  return value;
}

export async function getControl(ownerId: string, id: number): Promise<Control | null> {
  const db = await ensure();
  const row = await db.prepare(`SELECT ${CONTROL_COLUMNS}, a.time AS appointment_time FROM patient_controls c LEFT JOIN appointments a ON a.id = c.appointment_id AND a.owner_id = c.owner_id WHERE c.id = ? AND c.owner_id = ?`).bind(id, ownerId).first<ControlRow>();
  return row ? controlView(row) : null;
}

/**
 * Reserva el control para crearle su cita (evita duplicados si dos pestañas lo intentan a la vez).
 * Solo controles abiertos sin cita (appointment_id NULL). Devuelve true si esta llamada lo reservó.
 */
export async function claimControlForAgenda(ownerId: string, id: number): Promise<boolean> {
  const db = await ensure();
  const row = await db.prepare("UPDATE patient_controls SET appointment_id = -1 WHERE id = ? AND owner_id = ? AND appointment_id IS NULL AND status IN ('pendiente', 'contactado', 'agendado') RETURNING id").bind(id, ownerId).first<{ id: number }>();
  return !!row;
}
export async function linkControlAppointment(ownerId: string, id: number, appointmentId: number | null) {
  const db = await ensure();
  if (appointmentId === null) { await db.prepare("UPDATE patient_controls SET appointment_id = NULL WHERE id = ? AND owner_id = ? AND appointment_id = -1").bind(id, ownerId).run(); return; }
  await db.prepare("UPDATE patient_controls SET appointment_id = ?, status = CASE WHEN status IN ('pendiente', 'contactado') THEN 'agendado' ELSE status END, updated_at = ? WHERE id = ? AND owner_id = ?").bind(appointmentId, new Date().toISOString(), id, ownerId).run();
}
/** Permite volver a agendar un control cuya cita se quitó (appointment_id 0 → NULL). */
export async function allowReschedule(ownerId: string, id: number) {
  const db = await ensure();
  await db.prepare("UPDATE patient_controls SET appointment_id = NULL WHERE id = ? AND owner_id = ? AND appointment_id = 0").bind(id, ownerId).run();
}
/** Controles abiertos, de hoy en adelante, que nunca tuvieron cita (para crearlas una sola vez). */
export async function controlsMissingAppointment(ownerId: string, today: string, limit = 10): Promise<number[]> {
  const db = await ensure();
  const { results } = await db.prepare("SELECT id FROM patient_controls WHERE owner_id = ? AND appointment_id IS NULL AND status IN ('pendiente', 'contactado') AND due_on >= ? ORDER BY due_on LIMIT ?").bind(ownerId, today, limit).all<{ id: number }>();
  return results.map(row => row.id);
}

/**
 * La cita de agenda cambió fuera del control (se movió o se borró en la Agenda): el control la sigue.
 * Mover → nueva fecha; borrar → el control vuelve a «pendiente» y no se le recrea cita (appointment_id = 0).
 */
export async function controlFollowsAppointment(ownerId: string, appointmentId: number, change: { day: string } | { deleted: true }) {
  const db = await ensure();
  const stamp = new Date().toISOString();
  if ("deleted" in change) {
    await db.prepare("UPDATE patient_controls SET appointment_id = 0, status = CASE WHEN status = 'agendado' THEN 'pendiente' ELSE status END, updated_at = ? WHERE owner_id = ? AND appointment_id = ?").bind(stamp, ownerId, appointmentId).run();
    return;
  }
  const day = change.day.split("-")[0].length === 4 ? change.day : change.day.split("-").reverse().join("-");
  await db.prepare("UPDATE patient_controls SET due_on = ?, updated_at = ? WHERE owner_id = ? AND appointment_id = ? AND status NOT IN ('realizado', 'descartado')").bind(day, stamp, ownerId, appointmentId).run();
}
