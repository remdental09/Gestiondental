import { env } from "cloudflare:workers";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
export type MailDb = { prepare(sql: string): Statement };
export const mailDb = () => (env as unknown as { DB?: MailDb }).DB;
const need = () => { const db = mailDb(); if (!db) throw new Error("La base de datos no está disponible."); return db; };

export type MailSender = { owner_id: string; google_sub: string; google_email: string; refresh_token_ciphertext: string; base_url: string; enabled: number; send_hour: number; connected_at: string; last_run_at: string | null; last_result: string | null; custom_message?: string | null };
export type Reminder = { owner_id: string; event_id: number; start_at: string; token_hash: string; to_email: string; sent_at: string; response: string | null; responded_at: string | null };

let ready = false;
export async function ensureMailTables(db: MailDb = need()) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS mail_senders (owner_id TEXT PRIMARY KEY, google_sub TEXT NOT NULL, google_email TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, base_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, send_hour INTEGER NOT NULL DEFAULT 9, connected_at TEXT NOT NULL, last_run_at TEXT, last_result TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS appointment_reminders (owner_id TEXT NOT NULL, event_id INTEGER NOT NULL, start_at TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, to_email TEXT NOT NULL, sent_at TEXT NOT NULL, response TEXT, responded_at TEXT, PRIMARY KEY (owner_id, event_id, start_at))").run();
  try { await db.prepare("ALTER TABLE mail_senders ADD COLUMN custom_message TEXT").run(); } catch { /* la columna ya existe */ }
  ready = true;
}

export async function getSender(ownerId: string): Promise<MailSender | null> {
  const db = need(); await ensureMailTables(db);
  return db.prepare("SELECT * FROM mail_senders WHERE owner_id = ?").bind(ownerId).first<MailSender>();
}
export async function listEnabledSenders(): Promise<MailSender[]> {
  const db = need(); await ensureMailTables(db);
  return (await db.prepare("SELECT * FROM mail_senders WHERE enabled = 1").bind().all<MailSender>()).results;
}
export async function saveSender(ownerId: string, sub: string, email: string, ciphertext: string, baseUrl: string) {
  const db = need(); await ensureMailTables(db);
  // Conectar otra cuenta apaga el envío hasta que el clínico lo active de nuevo.
  await db.prepare(
    "INSERT INTO mail_senders (owner_id, google_sub, google_email, refresh_token_ciphertext, base_url, enabled, send_hour, connected_at) VALUES (?, ?, ?, ?, ?, 0, 9, ?) " +
    "ON CONFLICT(owner_id) DO UPDATE SET google_sub = excluded.google_sub, google_email = excluded.google_email, refresh_token_ciphertext = excluded.refresh_token_ciphertext, base_url = excluded.base_url, " +
    "enabled = CASE WHEN mail_senders.google_sub = excluded.google_sub THEN mail_senders.enabled ELSE 0 END, connected_at = excluded.connected_at"
  ).bind(ownerId, sub, email, ciphertext, baseUrl, new Date().toISOString()).run();
}
export async function updateSettings(ownerId: string, settings: { enabled?: boolean; sendHour?: number; message?: string }) {
  const db = need(); await ensureMailTables(db);
  if (typeof settings.enabled === "boolean") await db.prepare("UPDATE mail_senders SET enabled = ? WHERE owner_id = ?").bind(settings.enabled ? 1 : 0, ownerId).run();
  if (typeof settings.message === "string") await db.prepare("UPDATE mail_senders SET custom_message = ? WHERE owner_id = ?").bind(settings.message.trim() || null, ownerId).run();
  if (typeof settings.sendHour === "number") await db.prepare("UPDATE mail_senders SET send_hour = ? WHERE owner_id = ?").bind(settings.sendHour, ownerId).run();
}
export async function removeSender(ownerId: string) {
  const db = need(); await ensureMailTables(db);
  await db.prepare("DELETE FROM mail_senders WHERE owner_id = ?").bind(ownerId).run();
}
export async function recordRun(ownerId: string, detail: string) {
  const db = need(); await ensureMailTables(db);
  await db.prepare("UPDATE mail_senders SET last_run_at = ?, last_result = ? WHERE owner_id = ?").bind(new Date().toISOString(), detail.slice(0, 300), ownerId).run();
}

export async function sentKeys(ownerId: string): Promise<Set<string>> {
  const db = need(); await ensureMailTables(db);
  const { results } = await db.prepare("SELECT event_id, start_at FROM appointment_reminders WHERE owner_id = ?").bind(ownerId).all<{ event_id: number; start_at: string }>();
  return new Set(results.map(row => `${row.event_id}|${row.start_at}`));
}
export async function insertReminder(ownerId: string, eventId: number, startAt: string, tokenHash: string, toEmail: string): Promise<boolean> {
  const db = need(); await ensureMailTables(db);
  try {
    await db.prepare("INSERT INTO appointment_reminders (owner_id, event_id, start_at, token_hash, to_email, sent_at) VALUES (?, ?, ?, ?, ?, ?)").bind(ownerId, eventId, startAt, tokenHash, toEmail, new Date().toISOString()).run();
    return true;
  } catch { return false; }
}
export async function deleteReminder(ownerId: string, eventId: number, startAt: string) {
  const db = need(); await ensureMailTables(db);
  await db.prepare("DELETE FROM appointment_reminders WHERE owner_id = ? AND event_id = ? AND start_at = ?").bind(ownerId, eventId, startAt).run();
}
export async function reminderByHash(tokenHash: string): Promise<Reminder | null> {
  const db = need(); await ensureMailTables(db);
  return db.prepare("SELECT * FROM appointment_reminders WHERE token_hash = ?").bind(tokenHash).first<Reminder>();
}
export async function setResponse(tokenHash: string, response: "confirmed" | "declined") {
  const db = need(); await ensureMailTables(db);
  await db.prepare("UPDATE appointment_reminders SET response = ?, responded_at = ? WHERE token_hash = ?").bind(response, new Date().toISOString(), tokenHash).run();
}
/** Citas cuyo paciente avisó que no podrá asistir (solo vale si la cita sigue a la misma hora). */
export async function declinedEvents(ownerId: string): Promise<number[]> {
  const db = need(); await ensureMailTables(db);
  const { results } = await db.prepare(
    "SELECT r.event_id AS event_id FROM appointment_reminders r JOIN calendar_events e ON e.id = r.event_id AND e.owner_id = r.owner_id AND e.start_at = r.start_at WHERE r.owner_id = ? AND r.response = 'declined' AND e.status = 'confirmed'"
  ).bind(ownerId).all<{ event_id: number }>();
  return results.map(row => row.event_id);
}
