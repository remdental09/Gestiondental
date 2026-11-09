import { env } from "cloudflare:workers";
import { normalizeEndo, type EndoData } from "@/lib/endodontics";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const endoDb = () => (env as unknown as { DB?: Db }).DB;

async function ensureTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS endodontic_records (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, data TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, patient_id))"
  ).run();
}

export async function loadEndo(ownerId: string, patientId: number): Promise<{ data: EndoData; finished: boolean } | null> {
  const database = endoDb();
  if (!database) return null;
  await ensureTable(database);
  const row = await database.prepare("SELECT data, finished FROM endodontic_records WHERE owner_id = ? AND patient_id = ?").bind(ownerId, patientId).first<{ data: string; finished: number }>();
  if (!row) return null;
  try { return { data: normalizeEndo(JSON.parse(row.data)), finished: row.finished === 1 }; } catch { return null; }
}

export async function loadAllEndo(ownerId: string): Promise<Array<{ patientId: number; data: EndoData; finished: boolean }>> {
  const database = endoDb();
  if (!database) return [];
  await ensureTable(database);
  const { results } = await database.prepare("SELECT patient_id, data, finished FROM endodontic_records WHERE owner_id = ?").bind(ownerId).all<{ patient_id: number; data: string; finished: number }>();
  return results.flatMap(row => { try { return [{ patientId: row.patient_id, data: normalizeEndo(JSON.parse(row.data)), finished: row.finished === 1 }]; } catch { return []; } });
}

export async function saveEndo(ownerId: string, patientId: number, data: EndoData, finished: boolean) {
  const database = endoDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureTable(database);
  await database.prepare(
    "INSERT INTO endodontic_records (owner_id, patient_id, data, finished, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, patient_id) DO UPDATE SET data = excluded.data, finished = excluded.finished, updated_at = excluded.updated_at"
  ).bind(ownerId, patientId, JSON.stringify(data), finished ? 1 : 0, new Date().toISOString()).run();
}
