import { env } from "cloudflare:workers";
import type { PrestadorCertificate, PublicRegistration } from "@/lib/prestador-certificate";
import { printableQr, type QrSource } from "@/lib/prestador-qr";

type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const db = () => (env as unknown as { DB?: Db }).DB;

export type RegistrationStatus = "pendiente" | "aprobado" | "rechazado";
export type RegistrationRow = {
  professional_id: string; email: string; reg_sis: string; run: string; full_name: string; profession: string; specialties: string; issued_on: string;
  validation_code: string; file_hash: string; status: RegistrationStatus; reviewed_by: string; reviewed_at: string; review_note: string; created_at: string; updated_at: string;
  // El certificado original (PDF) y su QR se guardan en R2 bajo prestador/<professional_id>/ (columnas agregadas, aditivas).
  cert_key?: string | null; cert_name?: string | null; cert_size?: number | null; cert_uploaded_at?: string | null;
  qr_key?: string | null; qr_payload?: string | null; qr_source?: string | null;
};
export type StoredFile = { key: string; name: string; size: number };
export type StoredQr = { key: string; payload: string; source: Exclude<QrSource, "" | "codigo"> };

const ADDED_COLUMNS = ["cert_key TEXT NOT NULL DEFAULT ''", "cert_name TEXT NOT NULL DEFAULT ''", "cert_size INTEGER NOT NULL DEFAULT 0", "cert_uploaded_at TEXT NOT NULL DEFAULT ''",
  "qr_key TEXT NOT NULL DEFAULT ''", "qr_payload TEXT NOT NULL DEFAULT ''", "qr_source TEXT NOT NULL DEFAULT ''"];

let ready = false;
async function ensure(database: Db) {
  if (ready) return;
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS professional_registrations (professional_id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', reg_sis TEXT NOT NULL, run TEXT NOT NULL, full_name TEXT NOT NULL, " +
    "profession TEXT NOT NULL, specialties TEXT NOT NULL DEFAULT '[]', issued_on TEXT NOT NULL, validation_code TEXT NOT NULL, file_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendiente', " +
    "reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  // Migración aditiva: columnas nuevas para el certificado guardado y su QR (si ya existen, se ignora el error).
  for (const column of ADDED_COLUMNS) await database.prepare(`ALTER TABLE professional_registrations ADD COLUMN ${column}`).run().catch(() => undefined);
  ready = true;
}

const open = async () => { const database = db(); if (!database) throw new Error("Base de datos no disponible."); await ensure(database); return database; };
const list = (raw: string): string[] => { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };

export const publicRegistration = (row: RegistrationRow): PublicRegistration => ({
  regSis: row.reg_sis, run: row.run, fullName: row.full_name, profession: row.profession, specialties: list(row.specialties), issuedOn: row.issued_on, validationCode: row.validation_code,
  qrUrl: printableQr({ qrPayload: row.qr_payload ?? "", validationCode: row.validation_code }).url,
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

/** Guarda los datos del certificado. Con PDF: reemplaza el archivo guardado (y su QR, si se leyó). Con texto pegado: conserva el PDF anterior. */
/** Decisión al guardar: habilitado automático (todo coincide) o en revisión con el motivo exacto. */
export type RegistrationDecision = { approved: boolean; reviewer: string; note: string };

export async function saveRegistration(professionalId: string, email: string, cert: PrestadorCertificate, fileHash: string, file?: StoredFile | null, qr?: StoredQr | null, decision?: RegistrationDecision | null): Promise<RegistrationRow> {
  const database = await open();
  const now = new Date().toISOString();
  const previous = await loadRegistration(professionalId);
  // Si es el mismo registro y el mismo RUN ya aprobado, un certificado más nuevo no pierde la aprobación.
  const keepApproved = previous?.status === "aprobado" && previous.reg_sis === cert.regSis && previous.run === cert.run;
  const approveNow = Boolean(decision?.approved);
  const status = approveNow || keepApproved ? "aprobado" : "pendiente";
  const reviewedBy = approveNow ? (decision?.reviewer ?? "") : keepApproved ? previous!.reviewed_by : "";
  const reviewedAt = approveNow ? now : keepApproved ? previous!.reviewed_at : "";
  const note = status === "pendiente" ? (decision?.note ?? "").slice(0, 300) : "";
  await database.prepare(
    "INSERT INTO professional_registrations (professional_id, email, reg_sis, run, full_name, profession, specialties, issued_on, validation_code, file_hash, status, reviewed_by, reviewed_at, review_note, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(professional_id) DO UPDATE SET email = excluded.email, reg_sis = excluded.reg_sis, run = excluded.run, full_name = excluded.full_name, " +
    "profession = excluded.profession, specialties = excluded.specialties, issued_on = excluded.issued_on, validation_code = excluded.validation_code, file_hash = excluded.file_hash, status = excluded.status, " +
    "reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, review_note = excluded.review_note, updated_at = excluded.updated_at"
  ).bind(professionalId, email, cert.regSis, cert.run, cert.fullName, cert.profession, JSON.stringify(cert.specialties), cert.issuedOn, cert.validationCode, fileHash,
    status, reviewedBy, reviewedAt, note, now, now).run();
  if (file) {
    await database.prepare("UPDATE professional_registrations SET cert_key = ?, cert_name = ?, cert_size = ?, cert_uploaded_at = ?, qr_key = ?, qr_payload = ?, qr_source = ? WHERE professional_id = ?")
      .bind(file.key, file.name.slice(0, 200), file.size, now, qr?.key ?? "", qr?.payload ?? "", qr?.source ?? "", professionalId).run();
  } else if (qr) await saveQr(professionalId, qr);
  return (await loadRegistration(professionalId))!;
}

/** QR subido a mano (imagen) o leído del PDF. Solo la fila del propio profesional. */
export async function saveQr(professionalId: string, qr: StoredQr): Promise<RegistrationRow | null> {
  const database = await open();
  await database.prepare("UPDATE professional_registrations SET qr_key = ?, qr_payload = ?, qr_source = ?, updated_at = ? WHERE professional_id = ?")
    .bind(qr.key, qr.payload, qr.source, new Date().toISOString(), professionalId).run();
  return loadRegistration(professionalId);
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
