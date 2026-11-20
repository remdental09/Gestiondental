import { env } from "cloudflare:workers";
import { asProfessionalTitle, type ClinicianProfile, type ProfessionalTitle } from "@/lib/clinician-profile";

type Db = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> } };
export const profileDb = () => (env as unknown as { DB?: Db }).DB;

let extraTitlesReady = false;
let clinicNameReady = false;
let countryReady = false;
let titleReady = false;
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
  if (!clinicNameReady) {
    await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN clinic_name TEXT NOT NULL DEFAULT ''").run().catch(() => undefined);
    clinicNameReady = true;
  }
  if (!countryReady) {
    await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN country TEXT NOT NULL DEFAULT 'Chile'").run().catch(() => undefined);
    countryReady = true;
  }
  if (!titleReady) {
    // Aditiva: «Dr.», «Dra.» o «Dr(a).» (por defecto, como antes).
    await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN title TEXT NOT NULL DEFAULT 'Dr(a).'").run().catch(() => undefined);
    titleReady = true;
  }
}

export async function loadProfile(ownerId: string): Promise<ClinicianProfile | null> {
  const database = profileDb();
  if (!database) return null;
  await ensureProfileTable(database);
  const row = await database.prepare("SELECT first_name, last_name, rut, specialty, extra_titles, clinic_name, country, title FROM clinician_profiles WHERE owner_id = ?")
    .bind(ownerId).first<{ first_name: string; last_name: string; rut: string; specialty: string; extra_titles: string | null; clinic_name: string | null; country: string | null; title: string | null }>();
  return row ? { firstName: row.first_name, lastName: row.last_name, rut: row.rut, specialty: row.specialty, extraTitles: row.extra_titles ?? "", clinicName: row.clinic_name ?? "", country: row.country || "Chile", title: asProfessionalTitle(row.title) } : null;
}

export async function saveProfile(ownerId: string, email: string, p: ClinicianProfile) {
  const database = profileDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureProfileTable(database);
  const stamp = new Date().toISOString();
  await database.prepare(
    "INSERT INTO clinician_profiles (owner_id, email, first_name, last_name, rut, specialty, extra_titles, clinic_name, country, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, rut = excluded.rut, specialty = excluded.specialty, extra_titles = excluded.extra_titles, clinic_name = excluded.clinic_name, country = excluded.country, title = excluded.title, updated_at = excluded.updated_at"
  ).bind(ownerId, email, p.firstName, p.lastName, p.rut, p.specialty, p.extraTitles ?? "", p.clinicName ?? "", p.country ?? "Chile", asProfessionalTitle(p.title), stamp, stamp).run();
}

/** Tratamiento actual de varios profesionales (para mostrar sus documentos con el título que eligieron). */
export async function loadProfileTitles(ownerIds: string[]): Promise<Map<string, ProfessionalTitle>> {
  const unique = [...new Set(ownerIds.filter(Boolean))].slice(0, 50);
  const result = new Map<string, ProfessionalTitle>();
  const database = profileDb();
  if (!database || !unique.length) return result;
  await ensureProfileTable(database);
  const rows = await (database.prepare(`SELECT owner_id, title FROM clinician_profiles WHERE owner_id IN (${unique.map(() => "?").join(",")})`).bind(...unique) as unknown as { all<T>(): Promise<{ results: T[] }> }).all<{ owner_id: string; title: string | null }>();
  for (const row of rows.results) result.set(row.owner_id, asProfessionalTitle(row.title));
  return result;
}

/** Cambia solo el tratamiento del propio perfil (sin tocar nombre ni RUT). */
export async function saveProfileTitle(ownerId: string, title: ProfessionalTitle): Promise<boolean> {
  const database = profileDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureProfileTable(database);
  const result = await database.prepare("UPDATE clinician_profiles SET title = ?, updated_at = ? WHERE owner_id = ?").bind(title, new Date().toISOString(), ownerId).run() as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) > 0;
}
