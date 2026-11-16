import { env } from "cloudflare:workers";
import { EMPTY_CLINIC, type ClinicProfile } from "@/lib/clinic-profile";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const db = () => (env as unknown as { DB?: Db }).DB;

async function ensureTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS clinic_settings (owner_id TEXT PRIMARY KEY, address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', " +
    "phone TEXT NOT NULL DEFAULT '', phone2 TEXT NOT NULL DEFAULT '', open_time TEXT NOT NULL DEFAULT '', close_time TEXT NOT NULL DEFAULT '', logo TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"
  ).run();
}

type Row = { address: string; city: string; email: string; phone: string; phone2: string; open_time: string; close_time: string; logo: string };

export async function loadClinic(ownerId: string): Promise<ClinicProfile> {
  const database = db();
  if (!database) return { ...EMPTY_CLINIC };
  await ensureTable(database);
  await database.prepare("CREATE TABLE IF NOT EXISTS clinician_profiles (owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, rut TEXT NOT NULL, specialty TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN clinic_name TEXT NOT NULL DEFAULT ''").run().catch(() => undefined);
  const name = await database.prepare("SELECT clinic_name FROM clinician_profiles WHERE owner_id = ?").bind(ownerId).first<{ clinic_name: string | null }>();
  const row = await database.prepare("SELECT address, city, email, phone, phone2, open_time, close_time, logo FROM clinic_settings WHERE owner_id = ?").bind(ownerId).first<Row>();
  return {
    clinicName: name?.clinic_name ?? "", address: row?.address ?? "", city: row?.city ?? "", email: row?.email ?? "",
    phone: row?.phone ?? "", phone2: row?.phone2 ?? "", openTime: row?.open_time ?? "", closeTime: row?.close_time ?? "", logo: row?.logo ?? "",
  };
}

/** Guarda los datos de la clínica; el nombre vive en la ficha del profesional (la misma que ya se muestra arriba). */
export async function saveClinic(ownerId: string, c: ClinicProfile): Promise<void> {
  const database = db();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureTable(database);
  await database.prepare(
    "INSERT INTO clinic_settings (owner_id, address, city, email, phone, phone2, open_time, close_time, logo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id) DO UPDATE SET address = excluded.address, city = excluded.city, email = excluded.email, phone = excluded.phone, phone2 = excluded.phone2, open_time = excluded.open_time, close_time = excluded.close_time, logo = excluded.logo, updated_at = excluded.updated_at"
  ).bind(ownerId, c.address, c.city, c.email, c.phone, c.phone2, c.openTime, c.closeTime, c.logo, new Date().toISOString()).run();
  await database.prepare("ALTER TABLE clinician_profiles ADD COLUMN clinic_name TEXT NOT NULL DEFAULT ''").run().catch(() => undefined);
  await database.prepare("UPDATE clinician_profiles SET clinic_name = ?, updated_at = ? WHERE owner_id = ?").bind(c.clinicName, new Date().toISOString(), ownerId).run();
}
