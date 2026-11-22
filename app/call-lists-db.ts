import { env } from "cloudflare:workers";
import type { CallList } from "@/lib/call-lists";

/**
 * Marcas de «a quién llamar»: quién fue contactado y cuándo, por paciente y lista. Sin datos clínicos.
 * Tabla aditiva (migración 0019, también se crea aquí con IF NOT EXISTS); todo filtra por owner_id (espacio de la clínica).
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => { const db = (env as unknown as { DB?: Db }).DB; if (!db) throw new Error("La base de datos no está disponible."); return db; };

export const CALL_DDL = [
  "CREATE TABLE IF NOT EXISTS call_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, list TEXT NOT NULL, contacted_at TEXT NOT NULL, contacted_by TEXT)",
  "CREATE INDEX IF NOT EXISTS call_contacts_owner_idx ON call_contacts (owner_id, patient_id, list)",
];
let ready: Promise<unknown> | null = null;
async function ensure(db: Db = database()) {
  ready ??= (async () => { for (const sql of CALL_DDL) await db.prepare(sql).run(); })().catch(cause => { ready = null; throw cause; });
  await ready;
  return db;
}

/** Último contacto por paciente y lista en los últimos `sinceDays` días; sin tabla aún = sin contactos. */
export async function loadContacts(ownerId: string, sinceIso: string): Promise<Array<{ patientId: number; list: string; contactedAt: string }>> {
  try {
    const db = await ensure();
    const { results } = await db.prepare("SELECT patient_id, list, MAX(contacted_at) AS contacted_at FROM call_contacts WHERE owner_id = ? AND contacted_at >= ? GROUP BY patient_id, list").bind(ownerId, sinceIso).all<{ patient_id: number; list: string; contacted_at: string }>();
    return results.map(r => ({ patientId: r.patient_id, list: r.list, contactedAt: r.contacted_at }));
  } catch { return []; }
}

/** Marca (o desmarca) a un paciente como contactado en una lista. El paciente ya se validó como del espacio. */
export async function setContacted(ownerId: string, patientId: number, list: CallList, contacted: boolean, by: string, nowIso = new Date().toISOString()): Promise<void> {
  const db = await ensure();
  if (contacted) await db.prepare("INSERT INTO call_contacts (owner_id, patient_id, list, contacted_at, contacted_by) VALUES (?, ?, ?, ?, ?)").bind(ownerId, patientId, list, nowIso, by.slice(0, 120)).run();
  else await db.prepare("DELETE FROM call_contacts WHERE owner_id = ? AND patient_id = ? AND list = ?").bind(ownerId, patientId, list).run();
}
