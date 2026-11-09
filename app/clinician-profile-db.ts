import { env } from "cloudflare:workers";
import type { ClinicianProfile } from "@/lib/clinician-profile";

type Db = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> } };
export const profileDb = () => (env as unknown as { DB?: Db }).DB;

export async function ensureProfileTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS clinician_profiles (owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, " +
    "rut TEXT NOT NULL, specialty TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
}

export async function loadProfile(ownerId: string): Promise<ClinicianProfile | null> {
  const database = profileDb();
  if (!database) return null;
  await ensureProfileTable(database);
  const row = await database.prepare("SELECT first_name, last_name, rut, specialty FROM clinician_profiles WHERE owner_id = ?")
    .bind(ownerId).first<{ first_name: string; last_name: string; rut: string; specialty: string }>();
  return row ? { firstName: row.first_name, lastName: row.last_name, rut: row.rut, specialty: row.specialty } : null;
}

export async function saveProfile(ownerId: string, email: string, p: ClinicianProfile) {
  const database = profileDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureProfileTable(database);
  const stamp = new Date().toISOString();
  await database.prepare(
    "INSERT INTO clinician_profiles (owner_id, email, first_name, last_name, rut, specialty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, rut = excluded.rut, specialty = excluded.specialty, updated_at = excluded.updated_at"
  ).bind(ownerId, email, p.firstName, p.lastName, p.rut, p.specialty, stamp, stamp).run();
}
