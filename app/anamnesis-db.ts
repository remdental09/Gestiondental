import { env } from "cloudflare:workers";
import { normalizeAnamnesis, type Anamnesis } from "@/lib/anamnesis";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const database = () => (env as unknown as { DB?: Db }).DB;

async function ensure(db: Db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS patient_anamnesis (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, patient_id))").run();
}

export async function loadAnamnesis(ownerId: string, patientId: number): Promise<Anamnesis | null> {
  const db = database();
  if (!db) return null;
  await ensure(db);
  const row = await db.prepare("SELECT data, updated_at FROM patient_anamnesis WHERE owner_id = ? AND patient_id = ?").bind(ownerId, patientId).first<{ data: string; updated_at: string }>();
  if (!row) return null;
  try { return { ...normalizeAnamnesis(JSON.parse(row.data)), updatedAt: row.updated_at }; } catch { return null; }
}

export async function saveAnamnesis(ownerId: string, patientId: number, input: unknown): Promise<Anamnesis> {
  const db = database();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensure(db);
  const data = normalizeAnamnesis(input), updatedAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO patient_anamnesis (owner_id, patient_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, patient_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(ownerId, patientId, JSON.stringify(data), updatedAt).run();
  return { ...data, updatedAt };
}
