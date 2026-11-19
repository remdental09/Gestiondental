import { env } from "cloudflare:workers";
import { isAttendanceStatus, type AttendanceStatus } from "@/lib/dashboard";

/**
 * Estado de cada cita marcado en la agenda (confirmada, atendida, inasistida, cancelada). Tabla aditiva por espacio:
 * `source` = «cal» (evento de Google Calendar importado, ref = calendar_events.id) o «app» (cita de la ficha, ref = appointments.id).
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };

export const ATTENDANCE_DDL = "CREATE TABLE IF NOT EXISTS appointment_attendance (owner_id TEXT NOT NULL, source TEXT NOT NULL, ref_id INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, source, ref_id))";
let ready: Promise<unknown> | null = null;
export async function ensureAttendance(db: Db = database()) {
  ready ??= db.prepare(ATTENDANCE_DDL).run().catch((cause) => { ready = null; throw cause; });
  await ready;
  return db;
}

/** «cal:12» / «app:5» → estado. */
export async function loadAttendance(ownerId: string): Promise<Record<string, AttendanceStatus>> {
  const db = await ensureAttendance();
  const { results } = await db.prepare("SELECT source, ref_id, status FROM appointment_attendance WHERE owner_id = ?").bind(ownerId).all<{ source: string; ref_id: number; status: string }>();
  const out: Record<string, AttendanceStatus> = {};
  for (const row of results) if (isAttendanceStatus(row.status)) out[`${row.source}:${row.ref_id}`] = row.status;
  return out;
}

/** Marca el estado; «agendada» borra la marca. Devuelve false si la cita no es del espacio. */
export async function setAttendance(ownerId: string, source: "cal" | "app", refId: number, status: AttendanceStatus): Promise<boolean> {
  const db = await ensureAttendance();
  const owned = source === "cal"
    ? await db.prepare("SELECT id FROM calendar_events WHERE id = ? AND owner_id = ?").bind(refId, ownerId).first<{ id: number }>()
    : await db.prepare("SELECT id FROM appointments WHERE id = ? AND owner_id = ?").bind(refId, ownerId).first<{ id: number }>();
  if (!owned) return false;
  if (status === "agendada") await db.prepare("DELETE FROM appointment_attendance WHERE owner_id = ? AND source = ? AND ref_id = ?").bind(ownerId, source, refId).run();
  else await db.prepare("INSERT INTO appointment_attendance (owner_id, source, ref_id, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, source, ref_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at")
    .bind(ownerId, source, refId, status, new Date().toISOString()).run();
  return true;
}
