import { env } from "cloudflare:workers";
import type { PrestadorCertificate, PublicRegistration } from "@/lib/prestador-certificate";

type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const db = () => (env as unknown as { DB?: Db }).DB;

export type RegistrationStatus = "pendiente" | "aprobado" | "rechazado";
export type RegistrationRow = {
  professional_id: string; email: string; reg_sis: string; run: string; full_name: string; profession: string; specialties: string; issued_on: string;
  validation_code: string; file_hash: string; status: RegistrationStatus; reviewed_by: string; reviewed_at: string; review_note: string; created_at: string; updated_at: string;
};

let ready = false;
async function ensure(database: Db) {
  if (ready) return;
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS professional_registrations (professional_id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', reg_sis TEXT NOT NULL, run TEXT NOT NULL, full_name TEXT NOT NULL, " +
    "profession TEXT NOT NULL, specialties TEXT NOT NULL DEFAULT '[]', issued_on TEXT NOT NULL, validation_code TEXT NOT NULL, file_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendiente', " +
    "reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  ready = true;
}

const open = async () => { const database = db(); if (!database) throw new Error("Base de datos no disponible."); await ensure(database); return database; };
const list = (raw: string): string[] => { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };

export const publicRegistration = (row: RegistrationRow): PublicRegistration => ({
  regSis: row.reg_sis, run: row.run, fullName: row.full_name, profession: row.profession, specialties: list(row.specialties), issuedOn: row.issued_on, validationCode: row.validation_code,
});

export async function loadRegistration(professionalId: string): Promise<RegistrationRow | null> {
  const database = await open();
  return database.prepare("SELECT * FROM professional_registrations WHERE professional_id = ?").bind(professionalId).first<RegistrationRow>();
}

/** Registro aprobado de cada profesional (clave: professional_id). Solo datos públicos de la receta. */
export async function loadApprovedRegistrations(ids: string[]): Promise<Map<string, PublicRegistration>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 50);
  const result = new Map<string, PublicRegistration>();
  if (!unique.length) return result;
  const database = await open();
  const rows = await database.prepare(`SELECT * FROM professional_registrations WHERE status = 'aprobado' AND professional_id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<RegistrationRow>();
  for (const row of rows.results) result.set(row.professional_id, publicRegistration(row));
  return result;
}

export async function saveRegistration(professionalId: string, email: string, cert: PrestadorCertificate, fileHash: string): Promise<RegistrationRow> {
  const database = await open();
  const now = new Date().toISOString();
  const previous = await loadRegistration(professionalId);
  // Si es el mismo registro y el mismo RUN ya aprobado, un certificado más nuevo no pierde la aprobación.
  const keepApproved = previous?.status === "aprobado" && previous.reg_sis === cert.regSis && previous.run === cert.run;
  await database.prepare(
    "INSERT INTO professional_registrations (professional_id, email, reg_sis, run, full_name, profession, specialties, issued_on, validation_code, file_hash, status, reviewed_by, reviewed_at, review_note, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?) ON CONFLICT(professional_id) DO UPDATE SET email = excluded.email, reg_sis = excluded.reg_sis, run = excluded.run, full_name = excluded.full_name, " +
    "profession = excluded.profession, specialties = excluded.specialties, issued_on = excluded.issued_on, validation_code = excluded.validation_code, file_hash = excluded.file_hash, status = excluded.status, " +
    "reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, review_note = '', updated_at = excluded.updated_at"
  ).bind(professionalId, email, cert.regSis, cert.run, cert.fullName, cert.profession, JSON.stringify(cert.specialties), cert.issuedOn, cert.validationCode, fileHash,
    keepApproved ? "aprobado" : "pendiente", keepApproved ? previous!.reviewed_by : "", keepApproved ? previous!.reviewed_at : "", now, now).run();
  return (await loadRegistration(professionalId))!;
}

export async function listRegistrations(): Promise<RegistrationRow[]> {
  const database = await open();
  const rows = await database.prepare("SELECT * FROM professional_registrations ORDER BY CASE status WHEN 'pendiente' THEN 0 WHEN 'aprobado' THEN 1 ELSE 2 END, updated_at DESC LIMIT 200").all<RegistrationRow>();
  return rows.results;
}

export async function reviewRegistration(professionalId: string, status: Exclude<RegistrationStatus, "pendiente">, reviewer: string, note: string): Promise<RegistrationRow | null> {
  const database = await open();
  await database.prepare("UPDATE professional_registrations SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE professional_id = ?")
    .bind(status, reviewer, new Date().toISOString(), note.slice(0, 300), new Date().toISOString(), professionalId).run();
  return loadRegistration(professionalId);
}
