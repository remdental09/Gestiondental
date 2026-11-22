import { env } from "cloudflare:workers";
import type { AppUserRow, CountRow, ProfileRow } from "@/lib/developer-dashboard";
import { ensureProfileTable } from "@/app/clinician-profile-db";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const database = () => (env as unknown as { DB?: Db }).DB;

let ready = false;
async function ensureUsersTable(db: Db) {
  if (ready) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS app_users (owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, google_name TEXT NOT NULL DEFAULT '', " +
    "first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, visits INTEGER NOT NULL DEFAULT 1)"
  ).run();
  ready = true;
}

/** Memoria del isolate: evita incluso la consulta si esta persona ya quedó anotada hoy. */
const touchedToday = new Map<string, string>();

/** Anota que este profesional abrió la app (primer y último ingreso; «visits» cuenta días con ingreso). A lo más una escritura al día. Nunca bloquea la carga de la ficha. */
export async function touchAppUser(ownerId: string, email: string, googleName: string): Promise<void> {
  const db = database();
  if (!db || !ownerId || !email) return;
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10); // día UTC, igual que la condición SQL
  const key = ownerId + "|" + email.trim().toLowerCase();
  if (touchedToday.get(key) === day) return;
  await ensureUsersTable(db);
  // El UPDATE del upsert solo ocurre si cambió el día o el correo: el resto de las aperturas del día no escribe filas.
  await db.prepare(
    "INSERT INTO app_users (owner_id, email, google_name, first_seen, last_seen, visits) VALUES (?, ?, ?, ?, ?, 1) " +
    "ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email, google_name = CASE WHEN excluded.google_name <> '' THEN excluded.google_name ELSE app_users.google_name END, " +
    "last_seen = excluded.last_seen, visits = app_users.visits + 1 " +
    "WHERE substr(app_users.last_seen, 1, 10) <> ? OR app_users.email <> excluded.email"
  ).bind(ownerId, email.trim().toLowerCase(), googleName.trim().slice(0, 120), stamp, stamp, day).run();
  if (touchedToday.size > 5000) touchedToday.clear();
  touchedToday.set(key, day);
}

const safe = async <T,>(db: Db, sql: string): Promise<T[]> => {
  try { return (await db.prepare(sql).all<T>()).results ?? []; } catch { return []; }
};

/** Todo lo que necesita el panel del desarrollador, en cuatro consultas de solo lectura. */
export async function loadDeveloperData() {
  const db = database();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureUsersTable(db);
  await ensureProfileTable(db as never).catch(() => undefined);
  const [users, profiles, patients, notes] = await Promise.all([
    safe<AppUserRow>(db, "SELECT owner_id, email, google_name, first_seen, last_seen, visits FROM app_users"),
    safe<ProfileRow>(db, "SELECT owner_id, email, first_name, last_name, rut, specialty, clinic_name, extra_titles, created_at FROM clinician_profiles"),
    safe<CountRow>(db, "SELECT owner_id, COUNT(*) AS patients FROM patients GROUP BY owner_id"),
    safe<CountRow>(db, "SELECT owner_id, COUNT(*) AS notes, MAX(recorded_at) AS last_note FROM evolutions GROUP BY owner_id"),
  ]);
  return { users, profiles, patients, notes };
}
