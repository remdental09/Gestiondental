import { env } from "cloudflare:workers";
import type { ClinicianProfile } from "@/lib/clinician-profile";

type Db = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> } };
export const profileDb = () => (env as unknown as { DB?: Db }).DB;

let extraTitlesReady = false;
export async function ensureProfileTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS clinician_profiles (owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, " +
    "rut TEXT NOT NULL, specialty TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  if (!extraTitlesReady) {
    // Columna agregada después: en tablas antiguas se crea una vez; si ya existe, el error se ignora.
    await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN extra_titles TEXT NOT NULL DEFAULT ''").run().catch(() => undefined);
    extraTitlesReady = true;
  }
}

export async function loadProfile(ownerId: string): Promise<ClinicianProfile | null> {
  const database = profileDb();
  if (!database) return null;
  await ensureProfileTable(database);
  const row = await database.prepare("SELECT first_name, last_name, rut, specialty, extra_titles FROM clinician_profiles WHERE owner_id = ?")
    .bind(ownerId).first<{ first_name: string; last_name: string; rut: string; specialty: string; extra_titles: string | null }>();
  return row ? { firstName: row.first_name, lastName: row.last_name, rut: row.rut, specialty: row.specialty, extraTitles: row.extra_titles ?? "" } : null;
}

export async function saveProfile(ownerId: string, email: string, p: ClinicianProfile) {
  const database = profileDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureProfileTable(database);
  const stamp = new Date().toISOString();
  await database.prepare(
    "INSERT INTO clinician_profiles (owner_id, email, first_name, last_name, rut, specialty, extra_titles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, rut = excluded.rut, specialty = excluded.specialty, extra_titles = excluded.extra_titles, updated_at = excluded.updated_at"
  ).bind(ownerId, email, p.firstName, p.lastName, p.rut, p.specialty, p.extraTitles ?? "", stamp, stamp).run();
}
