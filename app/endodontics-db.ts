import { env } from "cloudflare:workers";
import { normalizeEndo, type EndoData } from "@/lib/endodontics";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const endoDb = () => (env as unknown as { DB?: Db }).DB;

let versionsReady = false;
async function ensureVersions(database: Db) {
  if (versionsReady) return;
  await database.prepare("CREATE TABLE IF NOT EXISTS endodontic_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, day TEXT NOT NULL, saved_at TEXT NOT NULL, data TEXT NOT NULL)").run();
  versionsReady = true;
}
const chileDay = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

/** Días con versiones guardadas del endograma (más reciente primero). */
export async function endoVersionDays(ownerId: string, patientId: number): Promise<string[]> {
  const database = endoDb();
  if (!database) return [];
  await ensureVersions(database);
  const { results } = await database.prepare("SELECT DISTINCT day FROM endodontic_versions WHERE owner_id = ? AND patient_id = ? ORDER BY day DESC").bind(ownerId, patientId).all<{ day: string }>();
  return results.map(row => row.day);
}

/** El endograma como quedó al final del día indicado. */
export async function loadEndoAt(ownerId: string, patientId: number, day: string): Promise<EndoData | null> {
  const database = endoDb();
  if (!database) return null;
  await ensureVersions(database);
  const row = await database.prepare("SELECT data FROM endodontic_versions WHERE owner_id = ? AND patient_id = ? AND day <= ? ORDER BY day DESC, id DESC LIMIT 1").bind(ownerId, patientId, day).first<{ data: string }>();
  if (!row) return null;
  try { return normalizeEndo(JSON.parse(row.data)); } catch { return null; }
}

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
  // Cada guardado queda como versión fechada: así se puede ver el endograma de cualquier día.
  try {
    await ensureVersions(database);
    await database.prepare("INSERT INTO endodontic_versions (owner_id, patient_id, day, saved_at, data) VALUES (?, ?, ?, ?, ?)").bind(ownerId, patientId, chileDay(), new Date().toISOString(), JSON.stringify(data)).run();
  } catch { /* la versión es un extra: el guardado principal ya quedó */ }
}
