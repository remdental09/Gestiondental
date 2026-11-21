import { mailDb, type MailDb } from "@/app/appointment-mail-db";
import { MAX_ATTEMPTS, type LockRow } from "@/lib/signature-lock";

let ready: Promise<void> | null = null;
const need = (): MailDb => { const db = mailDb(); if (!db) throw new Error("La base de datos no está disponible."); return db; };

/** Tablas del bloqueo de firma (mismo patrón «CREATE IF NOT EXISTS» que el resto): no dependen de que corra una migración. */
export function ensureSignatureLockTables(): Promise<void> {
  if (ready) return ready;
  const db = need();
  ready = (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS signature_unlock (professional_id text PRIMARY KEY NOT NULL, code_hash text NOT NULL DEFAULT '', expires_at text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0, unlocked_until text NOT NULL DEFAULT '', last_sent_at text NOT NULL DEFAULT '')").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS signature_history (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, professional_id text NOT NULL, image text NOT NULL, action text NOT NULL, replaced_at text NOT NULL)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS signature_history_professional_idx ON signature_history (professional_id)").run();
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export async function loadLock(professionalId: string): Promise<LockRow | null> {
  await ensureSignatureLockTables();
  return need().prepare("SELECT code_hash, expires_at, attempts, unlocked_until, last_sent_at FROM signature_unlock WHERE professional_id = ?").bind(professionalId).first<LockRow>();
}

export async function storeCode(professionalId: string, codeHash: string, expiresAt: string, now: string) {
  await ensureSignatureLockTables();
  await need().prepare("INSERT INTO signature_unlock (professional_id, code_hash, expires_at, attempts, unlocked_until, last_sent_at) VALUES (?, ?, ?, 0, '', ?) ON CONFLICT(professional_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, unlocked_until = '', last_sent_at = excluded.last_sent_at").bind(professionalId, codeHash, expiresAt, now).run();
}

/**
 * Reserva un intento de forma atómica: solo cuenta (y devuelve la fila) si hay un código vigente y quedan intentos.
 * Así dos solicitudes simultáneas no pueden probar más de MAX_ATTEMPTS códigos.
 */
export async function reserveAttempt(professionalId: string): Promise<Pick<LockRow, "code_hash" | "expires_at" | "attempts"> | null> {
  await ensureSignatureLockTables();
  return need().prepare("UPDATE signature_unlock SET attempts = attempts + 1 WHERE professional_id = ? AND code_hash != '' AND attempts < ? RETURNING code_hash, expires_at, attempts").bind(professionalId, MAX_ATTEMPTS).first<Pick<LockRow, "code_hash" | "expires_at" | "attempts">>();
}

/** Concede el permiso solo si el código acertado sigue siendo el vigente (no uno nuevo pedido mientras tanto). */
export async function grantUnlock(professionalId: string, codeHash: string, until: string): Promise<boolean> {
  const row = await need().prepare("UPDATE signature_unlock SET code_hash = '', attempts = 0, unlocked_until = ? WHERE professional_id = ? AND code_hash = ? RETURNING professional_id").bind(until, professionalId, codeHash).first<{ professional_id: string }>();
  return !!row;
}

/** Gasta el permiso de forma atómica: solo una solicitud puede usarlo, y solo si sigue vigente. */
export async function consumeUnlock(professionalId: string, nowIso: string): Promise<boolean> {
  await ensureSignatureLockTables();
  const row = await need().prepare("UPDATE signature_unlock SET unlocked_until = '' WHERE professional_id = ? AND unlocked_until != '' AND unlocked_until > ? RETURNING professional_id").bind(professionalId, nowIso).first<{ professional_id: string }>();
  return !!row;
}

export async function archiveMark(professionalId: string, image: string, action: string, now: string) {
  await ensureSignatureLockTables();
  await need().prepare("INSERT INTO signature_history (professional_id, image, action, replaced_at) VALUES (?, ?, ?, ?)").bind(professionalId, image, action, now).run();
}
