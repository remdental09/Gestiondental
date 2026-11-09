import { env } from "cloudflare:workers";
import { normalizeOrtho, type OrthoData } from "@/lib/orthodontics";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const orthoDb = () => (env as unknown as { DB?: Db }).DB;

async function ensureTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS orthodontic_plans (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, data TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, patient_id))"
  ).run();
}

export async function loadOrtho(ownerId: string, patientId: number): Promise<{ data: OrthoData; finished: boolean } | null> {
  const database = orthoDb();
  if (!database) return null;
  await ensureTable(database);
  const row = await database.prepare("SELECT data, finished FROM orthodontic_plans WHERE owner_id = ? AND patient_id = ?").bind(ownerId, patientId).first<{ data: string; finished: number }>();
  if (!row) return null;
  try { return { data: normalizeOrtho(JSON.parse(row.data)), finished: row.finished === 1 }; } catch { return null; }
}

export async function loadAllOrtho(ownerId: string): Promise<Array<{ patientId: number; data: OrthoData; finished: boolean }>> {
  const database = orthoDb();
  if (!database) return [];
  await ensureTable(database);
  const { results } = await database.prepare("SELECT patient_id, data, finished FROM orthodontic_plans WHERE owner_id = ?").bind(ownerId).all<{ patient_id: number; data: string; finished: number }>();
  return results.flatMap(row => { try { return [{ patientId: row.patient_id, data: normalizeOrtho(JSON.parse(row.data)), finished: row.finished === 1 }]; } catch { return []; } });
}

export async function saveOrtho(ownerId: string, patientId: number, data: OrthoData, finished: boolean) {
  const database = orthoDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureTable(database);
  await database.prepare(
    "INSERT INTO orthodontic_plans (owner_id, patient_id, data, finished, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, patient_id) DO UPDATE SET data = excluded.data, finished = excluded.finished, updated_at = excluded.updated_at"
  ).bind(ownerId, patientId, JSON.stringify(data), finished ? 1 : 0, new Date().toISOString()).run();
}
