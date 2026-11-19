import { env } from "cloudflare:workers";
import { emptyProfile, normalizeProfile, profileHasData, type PatientProfile } from "@/lib/patient-profile";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const database = () => (env as unknown as { DB?: Db }).DB;

// Igual que las direcciones: tabla propia con CREATE IF NOT EXISTS, sin depender de migraciones en producción.
async function ensure(db: Db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS patient_profiles (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, patient_id))"
  ).run();
}

export async function loadProfiles(ownerId: string): Promise<Map<number, PatientProfile>> {
  const map = new Map<number, PatientProfile>();
  const db = database();
  if (!db) return map;
  try {
    await ensure(db);
    const { results } = await db.prepare("SELECT patient_id, data FROM patient_profiles WHERE owner_id = ?").bind(ownerId).all<{ patient_id: number; data: string }>();
    for (const row of results) {
      try { map.set(row.patient_id, normalizeProfile(JSON.parse(row.data))); } catch { /* fila ilegible: la ficha sigue sin esos datos */ }
    }
  } catch { /* sin datos adicionales: la ficha sigue funcionando */ }
  return map;
}

export async function saveProfile(ownerId: string, patientId: number, input: unknown): Promise<PatientProfile> {
  const profile = normalizeProfile(input);
  const db = database();
  if (!db) return profile;
  await ensure(db);
  if (!profileHasData(profile)) {
    await db.prepare("DELETE FROM patient_profiles WHERE owner_id = ? AND patient_id = ?").bind(ownerId, patientId).run();
    return emptyProfile();
  }
  await db.prepare(
    "INSERT INTO patient_profiles (owner_id, patient_id, data, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, patient_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(ownerId, patientId, JSON.stringify(profile), new Date().toISOString()).run();
  return profile;
}
