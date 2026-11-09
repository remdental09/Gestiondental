import { env } from "cloudflare:workers";
import { emptyAddress, hasAddress, normalizeAddress, type PatientAddress } from "@/lib/patient-address";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const database = () => (env as unknown as { DB?: Db }).DB;

// Tabla propia (no migración de drizzle) para no depender de migraciones en producción.
async function ensure(db: Db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS patient_addresses (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, street TEXT NOT NULL DEFAULT '', commune TEXT NOT NULL DEFAULT '', " +
    "country TEXT NOT NULL DEFAULT 'Chile', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, patient_id))"
  ).run();
}

export async function loadAddresses(ownerId: string): Promise<Map<number, PatientAddress>> {
  const map = new Map<number, PatientAddress>();
  const db = database();
  if (!db) return map;
  try {
    await ensure(db);
    const { results } = await db.prepare("SELECT patient_id, street, commune, country FROM patient_addresses WHERE owner_id = ?").bind(ownerId)
      .all<{ patient_id: number; street: string; commune: string; country: string }>();
    for (const r of results) map.set(r.patient_id, normalizeAddress(r));
  } catch { /* sin dirección guardada: la ficha sigue funcionando */ }
  return map;
}

export async function saveAddress(ownerId: string, patientId: number, input: unknown): Promise<PatientAddress> {
  const address = normalizeAddress(input);
  const db = database();
  if (!db) return address;
  await ensure(db);
  if (!hasAddress(address)) {
    await db.prepare("DELETE FROM patient_addresses WHERE owner_id = ? AND patient_id = ?").bind(ownerId, patientId).run();
    return emptyAddress();
  }
  await db.prepare(
    "INSERT INTO patient_addresses (owner_id, patient_id, street, commune, country, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, patient_id) DO UPDATE SET street = excluded.street, commune = excluded.commune, country = excluded.country, updated_at = excluded.updated_at"
  ).bind(ownerId, patientId, address.street, address.commune, address.country, new Date().toISOString()).run();
  return address;
}
