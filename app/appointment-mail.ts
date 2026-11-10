import { chileDay } from "@/lib/chile-day";
import { buildRawMessage, isSendWindow, reminderEmail, selectReminders } from "@/lib/appointment-mail";
import { nextDay, type TodayEvent, type TodayPatient } from "@/lib/today-agenda";
import { loadHints } from "@/app/calendar-hints-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { deleteReminder, ensureMailTables, getSender, insertReminder, listEnabledSenders, mailDb, recordRun, sentKeys, type MailSender } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";

const MAX_PER_RUN = 30;

const base64Url = (bytes: Uint8Array) => { let bin = ""; for (const byte of bytes) bin += String.fromCharCode(byte); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
const newToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

type EventRow = TodayEvent;
type PatientRow = TodayPatient & { email: string };

/** Envía los recordatorios pendientes de las citas de mañana. Cada cita recibe un solo correo, y solo si el clínico lo activó. */
export async function runReminderCycle(options: { ownerId?: string; now?: Date; force?: boolean } = {}) {
  const now = options.now ?? new Date();
  const senders = options.ownerId ? [await getSender(options.ownerId)].filter((s): s is MailSender => !!s && s.enabled === 1) : await listEnabledSenders();
  const out: Array<{ ownerId: string; sent: number; detail: string }> = [];
  for (const sender of senders.slice(0, 50)) {
    if (!options.force && !isSendWindow(now, sender.send_hour)) { out.push({ ownerId: sender.owner_id, sent: 0, detail: "fuera de horario" }); continue; }
    try {
      const result = await remindersFor(sender, now);
      await recordRun(sender.owner_id, result.detail);
      out.push({ ownerId: sender.owner_id, sent: result.sent, detail: result.detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 200) : "error";
      await recordRun(sender.owner_id, "Error: " + detail).catch(() => undefined);
      out.push({ ownerId: sender.owner_id, sent: 0, detail });
    }
  }
  return out;
}

async function remindersFor(sender: MailSender, now: Date) {
  const db = mailDb();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureMailTables(db);
  const owner = sender.owner_id;
  const day = nextDay(chileDay(now.toISOString()));
  const from = new Date(`${day}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${day}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 2);
  const [events, patients, hints, confirmed, sent, profile] = await Promise.all([
    db.prepare("SELECT id, title, start_at AS startAt, end_at AS endAt, status, all_day AS allDay, patient_id AS patientId FROM calendar_events WHERE owner_id = ? AND start_at >= ? AND start_at < ?").bind(owner, from.toISOString(), to.toISOString()).all<Omit<EventRow, "allDay"> & { allDay: number }>(),
    db.prepare("SELECT id, name, rut, phone, email FROM patients WHERE owner_id = ?").bind(owner).all<PatientRow>(),
    loadHints(owner).catch(() => ({})),
    db.prepare("SELECT event_id FROM appointment_confirmations WHERE owner_id = ?").bind(owner).all<{ event_id: number }>().catch(() => ({ results: [] as Array<{ event_id: number }> })),
    sentKeys(owner),
    loadProfile(owner).catch(() => null),
  ]);
  const candidates = selectReminders({
    events: events.results.map(row => ({ ...row, allDay: Boolean(row.allDay) })),
    patients: patients.results, hints, day,
    confirmedEventIds: new Set(confirmed.results.map(row => row.event_id)), alreadySent: sent,
  });
  let sentCount = 0, failed = 0;
  let lastError = "";
  for (const item of candidates.slice(0, MAX_PER_RUN)) {
    const token = newToken();
    const hash = await hashToken(token);
    if (!(await insertReminder(owner, item.event.id, item.event.startAt, hash, item.email))) continue;
    try {
      const link = (answer: "si" | "no") => `${sender.base_url}/api/confirmar?t=${token}&a=${answer}`;
      const mail = reminderEmail({ patientName: item.patient.name, startAt: item.event.startAt, clinicName: profile?.clinicName, confirmUrl: link("si"), declineUrl: link("no"), message: sender.custom_message ?? undefined });
      await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: profile?.clinicName || undefined, to: item.email, replyTo: sender.google_email, ...mail }));
      sentCount++;
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : "error";
      await deleteReminder(owner, item.event.id, item.event.startAt); // se reintenta en la próxima revisión
      if (/Gmail API|venció|rechazada/.test(lastError)) break; // un fallo de cuenta se repetiría con cada correo
    }
  }
  const pending = Math.max(0, candidates.length - sentCount - failed);
  const detail = candidates.length === 0 ? "Sin recordatorios pendientes para mañana." : `Enviados ${sentCount}${failed ? `, con error ${failed} (${lastError.slice(0, 120)})` : ""}${pending ? `, pendientes ${pending}` : ""}.`;
  return { sent: sentCount, detail };
}

/** Correo de prueba a la propia cuenta de envío, para comprobar que Gmail funciona antes de activar el envío automático. */
export async function sendTestMail(ownerId: string) {
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío.");
  const profile = await loadProfile(ownerId).catch(() => null);
  const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const mail = reminderEmail({ patientName: "Paciente de prueba", startAt: start, clinicName: profile?.clinicName, confirmUrl: `${sender.base_url}/`, declineUrl: `${sender.base_url}/`, message: sender.custom_message ?? undefined });
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: profile?.clinicName || undefined, to: sender.google_email, ...mail, subject: "[Prueba] " + mail.subject }));
}
