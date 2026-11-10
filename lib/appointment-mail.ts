/** Correo de confirmación de cita: solo fecha, hora y clínica (nunca datos clínicos). Funciones puras, sin red. */
import { agendaForDay, type EventHints, type TodayEvent, type TodayPatient } from "./today-agenda.ts";

export const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
export const isValidEmail = (value: string | undefined | null): value is string => !!value && value.length <= 254 && EMAIL_RE.test(value.trim());

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Sin saltos de línea: evita inyectar encabezados en el correo. */
const header = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

export function whenParts(startAt: string) {
  const when = new Date(startAt);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).formatToParts(when).map(part => [part.type, part.value]));
  const time = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(when);
  return { day: `${parts.weekday} ${parts.day} de ${parts.month}`, time };
}

export type ReminderInput = { patientName: string; startAt: string; clinicName?: string; confirmUrl: string; declineUrl: string; message?: string };
/** Mensaje o firma del clínico: texto plano, sin saltos raros ni exceso de largo. */
export const cleanMessage = (value: string | null | undefined) => (value ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 600);

export function reminderEmail(input: ReminderInput): { subject: string; text: string; html: string } {
  const first = header(input.patientName).split(/\s+/)[0] ?? "";
  const { day, time } = whenParts(input.startAt);
  const clinic = header(input.clinicName ?? "");
  const place = clinic ? ` en ${clinic}` : "";
  const note = cleanMessage(input.message);
  const subject = `Confirma tu cita del ${day}${clinic ? ` · ${clinic}` : ""}`;
  const text = [
    `Hola ${first},`,
    "",
    `Le recordamos su cita el ${day} a las ${time}${place}.`,
    "",
    `Para confirmar su asistencia: ${input.confirmUrl}`,
    `Si no puede asistir: ${input.declineUrl}`,
    ...(note ? ["", note] : []),
    "",
    "Este es un recordatorio automático de su cita y no contiene información clínica.",
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f">
<div style="max-width:520px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e6e4ee">
<p style="margin:0 0 12px;font-size:16px">Hola ${esc(first)},</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">Le recordamos su cita el <strong>${esc(day)}</strong> a las <strong>${esc(time)}</strong>${esc(place)}.</p>
<p style="margin:0 0 20px"><a href="${esc(input.confirmUrl)}" style="display:inline-block;background:#473a6d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Confirmo mi asistencia</a></p>
<p style="margin:0 0 20px;font-size:14px"><a href="${esc(input.declineUrl)}" style="color:#6b6a7c">No podré asistir</a></p>
${note ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.5">${esc(note).replace(/\n/g, "<br>")}</p>\n` : ""}<p style="margin:0;font-size:12px;color:#6b6a7c">Este es un recordatorio automático de su cita y no contiene información clínica.</p>
</div></div></body></html>`;
  return { subject, text, html };
}

const b64 = (text: string) => { const bytes = new TextEncoder().encode(text); let bin = ""; for (const byte of bytes) bin += String.fromCharCode(byte); return btoa(bin); };
const wrap76 = (value: string) => value.replace(/(.{76})/g, "$1\r\n");
const base64Url = (text: string) => b64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodedWord = (text: string) => `=?UTF-8?B?${b64(header(text))}?=`;

/** Mensaje RFC 822 (texto + HTML) listo para la API de Gmail (`raw`, base64url). */
export function buildRawMessage(input: { from: string; fromName?: string; to: string; replyTo?: string; subject: string; text: string; html: string }): string {
  if (!isValidEmail(input.from) || !isValidEmail(input.to)) throw new Error("Dirección de correo inválida.");
  const boundary = "gd_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const fromName = header(input.fromName ?? "");
  const lines = [
    `From: ${fromName ? `${encodedWord(fromName)} ` : ""}<${input.from.trim()}>`,
    `To: <${input.to.trim()}>`,
    ...(input.replyTo && isValidEmail(input.replyTo) ? [`Reply-To: <${input.replyTo.trim()}>`] : []),
    `Subject: ${encodedWord(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(input.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(input.html)),
    `--${boundary}--`,
    "",
  ];
  return base64Url(lines.join("\r\n"));
}

export type ReminderCandidate<E extends TodayEvent, P extends TodayPatient> = { event: E; patient: P; email: string };

/** Citas de un día a las que corresponde enviar recordatorio: con ficha reconocida, correo válido, sin confirmar y sin envío previo. */
export function selectReminders<E extends TodayEvent, P extends TodayPatient>(input: {
  events: E[]; patients: P[]; hints?: EventHints; day: string; confirmedEventIds: Set<number>; alreadySent: Set<string>;
}): ReminderCandidate<E, P>[] {
  const out: ReminderCandidate<E, P>[] = [];
  for (const { event, patient } of agendaForDay(input.events, input.patients, input.day, input.hints ?? {})) {
    if (!patient || !isValidEmail(patient.email)) continue;
    if (input.confirmedEventIds.has(event.id)) continue;
    if (input.alreadySent.has(`${event.id}|${event.startAt}`)) continue;
    out.push({ event, patient, email: patient.email.trim() });
  }
  return out;
}

/** ¿Toca enviar ahora? Desde la hora elegida (hora de Chile) y hasta las 20:00, para no mandar correos de noche. */
export function isSendWindow(now: Date, sendHour: number): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(now)) % 24;
  return hour >= sendHour && hour < 20;
}
