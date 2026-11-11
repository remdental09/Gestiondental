import { chileDay } from "@/lib/chile-day";
import { buildRawMessage, isValidEmail } from "@/lib/appointment-mail";
import { buildSnapshot, changeCount, DIGEST_DAYS, diffSnapshots, digestDays, digestEmail, type DigestEntry } from "@/lib/agenda-digest";
import { type TodayEvent } from "@/lib/today-agenda";
import { loadHints } from "@/app/calendar-hints-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { getSender, mailDb, type MailDb, type MailSender } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";

export type DigestSettings = { owner_id: string; enabled: number; to_email: string; send_hour: number; abbreviate: number; last_sent_at: string | null; last_sent_day: string | null; last_result: string | null; snapshot: string | null; window_end: string | null };

const need = (): MailDb => { const db = mailDb(); if (!db) throw new Error("La base de datos no está disponible."); return db; };
let ready = false;
async function ensure(db: MailDb) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS agenda_digest (owner_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, to_email TEXT NOT NULL DEFAULT '', send_hour INTEGER NOT NULL DEFAULT 18, abbreviate INTEGER NOT NULL DEFAULT 0, last_sent_at TEXT, last_sent_day TEXT, last_result TEXT, snapshot TEXT, window_end TEXT)").run();
  ready = true;
}

export async function getDigest(ownerId: string): Promise<DigestSettings | null> {
  const db = need(); await ensure(db);
  return db.prepare("SELECT * FROM agenda_digest WHERE owner_id = ?").bind(ownerId).first<DigestSettings>();
}

export async function saveDigest(ownerId: string, input: { enabled?: boolean; toEmail?: string; sendHour?: number; abbreviate?: boolean }) {
  const db = need(); await ensure(db);
  await db.prepare("INSERT OR IGNORE INTO agenda_digest (owner_id) VALUES (?)").bind(ownerId).run();
  if (input.toEmail !== undefined) await db.prepare("UPDATE agenda_digest SET to_email = ?, snapshot = NULL, window_end = NULL WHERE owner_id = ?").bind(input.toEmail, ownerId).run();
  if (input.enabled !== undefined) await db.prepare("UPDATE agenda_digest SET enabled = ? WHERE owner_id = ?").bind(input.enabled ? 1 : 0, ownerId).run();
  if (input.sendHour !== undefined) await db.prepare("UPDATE agenda_digest SET send_hour = ? WHERE owner_id = ?").bind(input.sendHour, ownerId).run();
  if (input.abbreviate !== undefined) await db.prepare("UPDATE agenda_digest SET abbreviate = ? WHERE owner_id = ?").bind(input.abbreviate ? 1 : 0, ownerId).run();
}

async function compose(owner: string, settings: DigestSettings, now: Date) {
  const db = need();
  const today = chileDay(now.toISOString());
  const days = digestDays(today, DIGEST_DAYS);
  const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${days[days.length - 1]}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 60);
  const [events, patients, hints, profile] = await Promise.all([
    db.prepare("SELECT id, title, start_at AS startAt, end_at AS endAt, status, all_day AS allDay, patient_id AS patientId FROM calendar_events WHERE owner_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?").bind(owner, from.toISOString(), to.toISOString()).all<TodayEvent>(),
    db.prepare("SELECT id, name, rut, phone, email FROM patients WHERE owner_id = ?").bind(owner).all<{ id: number; name: string; rut?: string; phone?: string; email?: string }>(),
    loadHints(owner).catch(() => ({} as Record<number, string>)),
    loadProfile(owner).catch(() => null),
  ]);
  const rows = events.results.map((row) => ({ ...row, allDay: Boolean(row.allDay) }));
  const entries = buildSnapshot({ events: rows, patients: patients.results, hints: hints as Record<number, string>, days, abbreviate: settings.abbreviate === 1 });
  const known = new Map(rows.map((row) => [row.id, row.startAt]));
  let previous: DigestEntry[] | null = null;
  try { previous = settings.snapshot ? JSON.parse(settings.snapshot) as DigestEntry[] : null; } catch { previous = null; }
  const changes = diffSnapshots(previous, entries, known, { from: days[0], previousEnd: settings.window_end });
  return { today, days, entries, changes, first: !previous, clinicName: profile?.clinicName };
}

async function deliver(sender: MailSender, to: string, mail: { subject: string; text: string; html: string }, clinicName?: string) {
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: clinicName || undefined, to, replyTo: sender.google_email, ...mail }));
}

/**
 * Envía la agenda a quien la recibe. Sin `to`, es el envío habitual: va a la persona guardada y deja la foto para comparar mañana.
 * Con `to` (envío manual a otra persona, o ahora mismo): lleva los cambios desde el último envío habitual y NO mueve esa comparación,
 * así el envío automático de la tarde sigue mostrando todo lo que cambió.
 */
export async function sendDigest(ownerId: string, options: { to?: string; now?: Date } = {}): Promise<string> {
  const now = options.now ?? new Date();
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío.");
  const settings = (await getDigest(ownerId)) ?? { owner_id: ownerId, enabled: 0, to_email: "", send_hour: 18, abbreviate: 0, last_sent_at: null, last_sent_day: null, last_result: null, snapshot: null, window_end: null };
  const manual = options.to !== undefined;
  const to = (options.to ?? settings.to_email).trim();
  if (!isValidEmail(to)) throw new Error("Escribe el correo de quien recibirá la agenda.");
  const built = await compose(ownerId, settings, now);
  await deliver(sender, to, digestEmail({ clinicName: built.clinicName, days: built.days, entries: built.entries, changes: built.changes, first: built.first }), built.clinicName);
  const detail = `Enviada a ${to}: ${built.entries.length} citas${built.first ? "" : `, ${changeCount(built.changes)} ${changeCount(built.changes) === 1 ? "cambio" : "cambios"} desde el último envío automático`}.`;
  if (manual && to !== settings.to_email.trim()) return detail;
  await need().prepare("UPDATE agenda_digest SET snapshot = ?, window_end = ?, last_sent_at = ?, last_sent_day = ?, last_result = ? WHERE owner_id = ?")
    .bind(JSON.stringify(built.entries), built.days[built.days.length - 1], now.toISOString(), built.today, detail, ownerId).run();
  return detail;
}

/** Prueba: llega al correo de envío del clínico y NO cambia la foto de comparación. */
export async function sendDigestTest(ownerId: string, now = new Date()): Promise<string> {
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío.");
  const settings = (await getDigest(ownerId)) ?? { owner_id: ownerId, enabled: 0, to_email: "", send_hour: 18, abbreviate: 0, last_sent_at: null, last_sent_day: null, last_result: null, snapshot: null, window_end: null };
  const built = await compose(ownerId, settings, now);
  await deliver(sender, sender.google_email, digestEmail({ clinicName: built.clinicName, days: built.days, entries: built.entries, changes: built.changes, first: built.first, test: true }), built.clinicName);
  return `Prueba enviada a ${sender.google_email} con ${built.entries.length} citas de la semana.`;
}

/** Cada hora: envía la agenda a quienes la activaron, una vez al día, desde su hora elegida y hasta las 20:00 (Chile). */
export async function runAgendaDigests(now = new Date()) {
  const db = need(); await ensure(db);
  const rows = await db.prepare("SELECT * FROM agenda_digest WHERE enabled = 1").all<DigestSettings>();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(now)) % 24;
  const today = chileDay(now.toISOString());
  const out: Array<{ ownerId: string; detail: string }> = [];
  for (const row of rows.results.slice(0, 50)) {
    if (hour < row.send_hour || hour >= 20) { out.push({ ownerId: row.owner_id, detail: "fuera de horario" }); continue; }
    if (row.last_sent_day === today) { out.push({ ownerId: row.owner_id, detail: "ya enviada hoy" }); continue; }
    try { out.push({ ownerId: row.owner_id, detail: await sendDigest(row.owner_id, { now }) }); }
    catch (error) {
      const detail = "Error: " + (error instanceof Error ? error.message.slice(0, 160) : "no se pudo enviar");
      await db.prepare("UPDATE agenda_digest SET last_result = ? WHERE owner_id = ?").bind(detail, row.owner_id).run().catch(() => undefined);
      out.push({ ownerId: row.owner_id, detail });
    }
  }
  return out;
}
