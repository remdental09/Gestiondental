import { env } from "cloudflare:workers";
import { NO_TIMES, checkWaitEntry, isWaitPreference, nextTimes, type CycleTimes, type WaitEntry } from "@/lib/appointment-cycle";
import type { AttendanceStatus } from "@/lib/dashboard";

/**
 * Ciclo de la cita y lista de espera (GES-10). Tablas aditivas (migración 0018, también se crean aquí con IF NOT EXISTS);
 * todo filtra por owner_id (el espacio de la clínica).
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };

export const CYCLE_DDL = [
  "CREATE TABLE IF NOT EXISTS appointment_times (owner_id TEXT NOT NULL, source TEXT NOT NULL, ref_id INTEGER NOT NULL, arrived_at TEXT, in_box_at TEXT, done_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, source, ref_id))",
  "CREATE TABLE IF NOT EXISTS waitlist_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', preference TEXT NOT NULL DEFAULT 'cualquiera', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT, removed_at TEXT)",
  "CREATE INDEX IF NOT EXISTS waitlist_entries_owner_idx ON waitlist_entries (owner_id, removed_at)",
];
let ready: Promise<unknown> | null = null;
export async function ensureCycle(db: Db = database()) {
  ready ??= (async () => { for (const sql of CYCLE_DDL) await db.prepare(sql).run(); })().catch((cause) => { ready = null; throw cause; });
  await ready;
  return db;
}

type TimesRow = { source: string; ref_id: number; arrived_at: string | null; in_box_at: string | null; done_at: string | null };
const timesOf = (r: TimesRow): CycleTimes => ({ arrivedAt: r.arrived_at, inBoxAt: r.in_box_at, doneAt: r.done_at });

/** Guarda la hora del paso (llegó / en box / atendida). La cita ya se validó como del espacio. Nunca lanza. */
export async function recordCycleTimes(ownerId: string, source: "app" | "cal", refId: number, status: AttendanceStatus, nowIso = new Date().toISOString()): Promise<CycleTimes | null> {
  try {
    const db = await ensureCycle();
    const row = await db.prepare("SELECT source, ref_id, arrived_at, in_box_at, done_at FROM appointment_times WHERE owner_id = ? AND source = ? AND ref_id = ?").bind(ownerId, source, refId).first<TimesRow>();
    const prev = row ? timesOf(row) : NO_TIMES;
    const next = nextTimes(prev, status, nowIso);
    if (next.arrivedAt === prev.arrivedAt && next.inBoxAt === prev.inBoxAt && next.doneAt === prev.doneAt) return prev;
    await db.prepare("INSERT INTO appointment_times (owner_id, source, ref_id, arrived_at, in_box_at, done_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, source, ref_id) DO UPDATE SET arrived_at = excluded.arrived_at, in_box_at = excluded.in_box_at, done_at = excluded.done_at, updated_at = excluded.updated_at")
      .bind(ownerId, source, refId, next.arrivedAt, next.inBoxAt, next.doneAt, nowIso).run();
    return next;
  } catch { return null; }
}

/** «app:5» / «cal:12» → horas del ciclo, de todo el espacio. */
export async function loadCycleTimes(ownerId: string): Promise<Map<string, CycleTimes>> {
  const out = new Map<string, CycleTimes>();
  try {
    const db = await ensureCycle();
    const { results } = await db.prepare("SELECT source, ref_id, arrived_at, in_box_at, done_at FROM appointment_times WHERE owner_id = ? AND updated_at >= ?").bind(ownerId, new Date(Date.now() - 60 * 86400000).toISOString()).all<TimesRow>();
    for (const r of results) out.set(`${r.source}:${r.ref_id}`, timesOf(r));
  } catch { /* sin tabla aún: sin horas */ }
  return out;
}

type WaitRow = { id: number; patient_id: number | null; name: string; phone: string; preference: string; note: string; created_at: string; p_name: string | null; p_phone: string | null };
const entryOf = (r: WaitRow): WaitEntry => ({ id: r.id, patientId: r.patient_id, name: r.p_name ?? r.name, phone: r.p_phone || r.phone, preference: isWaitPreference(r.preference) ? r.preference : "cualquiera", note: r.note, createdAt: r.created_at });

export async function listWaitlist(ownerId: string): Promise<WaitEntry[]> {
  const db = await ensureCycle();
  const { results } = await db.prepare("SELECT w.id, w.patient_id, w.name, w.phone, w.preference, w.note, w.created_at, p.name AS p_name, p.phone AS p_phone FROM waitlist_entries w LEFT JOIN patients p ON p.id = w.patient_id AND p.owner_id = w.owner_id WHERE w.owner_id = ? AND w.removed_at IS NULL ORDER BY w.created_at LIMIT 200")
    .bind(ownerId).all<WaitRow>();
  return results.map(entryOf);
}

export async function addToWaitlist(ownerId: string, input: Record<string, unknown>, actor: string): Promise<{ ok: true; entry: WaitEntry } | { ok: false; error: string }> {
  const checked = checkWaitEntry(input);
  if (!checked.ok) return checked;
  const db = await ensureCycle();
  let name = checked.name, phone = checked.phone;
  if (checked.patientId) {
    const patient = await db.prepare("SELECT name, phone FROM patients WHERE id = ? AND owner_id = ?").bind(checked.patientId, ownerId).first<{ name: string; phone: string }>();
    if (!patient) return { ok: false, error: "Paciente no encontrado." };
    name = patient.name; phone = phone || patient.phone || "";
    const dup = await db.prepare("SELECT id FROM waitlist_entries WHERE owner_id = ? AND patient_id = ? AND removed_at IS NULL").bind(ownerId, checked.patientId).first<{ id: number }>();
    if (dup) return { ok: false, error: "Ese paciente ya está en la lista de espera." };
  }
  const count = await db.prepare("SELECT COUNT(*) AS n FROM waitlist_entries WHERE owner_id = ? AND removed_at IS NULL").bind(ownerId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 200) return { ok: false, error: "La lista de espera admite hasta 200 personas." };
  const at = new Date().toISOString();
  const row = await db.prepare("INSERT INTO waitlist_entries (owner_id, patient_id, name, phone, preference, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(ownerId, checked.patientId, name, phone, checked.preference, checked.note, at, actor.slice(0, 200)).first<{ id: number }>();
  if (!row) return { ok: false, error: "No se pudo guardar." };
  return { ok: true, entry: { id: row.id, patientId: checked.patientId, name, phone, preference: checked.preference, note: checked.note, createdAt: at } };
}

/** Sacar de la lista (queda marcado, no se borra). */
export async function removeFromWaitlist(ownerId: string, id: number): Promise<boolean> {
  const db = await ensureCycle();
  const found = await db.prepare("SELECT id FROM waitlist_entries WHERE id = ? AND owner_id = ? AND removed_at IS NULL").bind(id, ownerId).first<{ id: number }>();
  if (!found) return false;
  await db.prepare("UPDATE waitlist_entries SET removed_at = ? WHERE id = ? AND owner_id = ?").bind(new Date().toISOString(), id, ownerId).run();
  return true;
}
