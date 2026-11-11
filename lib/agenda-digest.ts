/**
 * Agenda semanal por correo para quien apoya la consulta (técnico, TONS). Funciones puras, sin red ni base de datos.
 * Cada día se arma la foto de la agenda de los próximos días y se compara con la última que se envió, para destacar
 * qué cita es nueva, cuál cambió de día u hora y cuál se canceló. Solo lleva nombre, día, hora y motivo: nunca datos clínicos.
 */
import { chileDay } from "./chile-day.ts";
import { isValidEmail, whenParts } from "./appointment-mail.ts";
import { nextDay, patientForEvent, type EventHints, type TodayEvent, type TodayPatient } from "./today-agenda.ts";

export type DigestEntry = { id: number; startAt: string; endAt: string; allDay: boolean; label: string };
export type DigestChanges = {
  added: DigestEntry[];
  moved: Array<{ entry: DigestEntry; fromStartAt: string }>;
  cancelled: DigestEntry[];
};
export const DIGEST_DAYS = 7;

/** Hoy y los `count - 1` días siguientes (AAAA-MM-DD, hora de Chile). */
export function digestDays(today: string, count = DIGEST_DAYS): string[] {
  const days: string[] = [today];
  let day = today;
  for (let i = 1; i < count; i++) { day = nextDay(day); days.push(day); }
  return days;
}

/** «Olga Cea Zúñiga» → «Olga C. Z.» */
export function abbreviateName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!first) return "";
  return [first, ...rest.map((part) => `${part[0]?.toUpperCase() ?? ""}.`)].join(" ");
}

const clean = (text: string, max = 80) => text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Citas confirmadas de los días pedidos, ordenadas, con el nombre del paciente si se reconoce (o el título de la cita). */
export function buildSnapshot(input: { events: TodayEvent[]; patients: TodayPatient[]; hints?: EventHints; days: string[]; abbreviate?: boolean }): DigestEntry[] {
  const wanted = new Set(input.days);
  const entries: DigestEntry[] = [];
  for (const event of input.events) {
    if (event.status !== "confirmed" || !wanted.has(chileDay(event.startAt))) continue;
    const patient = patientForEvent(event, input.patients, input.hints?.[event.id] ?? "");
    const name = patient ? (input.abbreviate ? abbreviateName(patient.name) : clean(patient.name)) : "";
    const title = clean(event.title ?? "");
    const label = name ? (title && !title.toLowerCase().includes(name.toLowerCase().split(" ")[0]) ? `${name} · ${title}` : name) : (title || "Cita");
    entries.push({ id: event.id, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay, label });
  }
  return entries.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id - b.id);
}

/**
 * Qué cambió desde la última agenda enviada. `known` trae el inicio actual de TODAS las citas confirmadas conocidas
 * (incluidas las que quedan fuera de la ventana), para distinguir «cambió de día» de «se canceló».
 * Lo que está en la foto anterior pero ya pasó, no cuenta como cancelado.
 */
export function diffSnapshots(previous: DigestEntry[] | null, next: DigestEntry[], known: Map<number, string>, window: { from: string; previousEnd: string | null }): DigestChanges {
  const out: DigestChanges = { added: [], moved: [], cancelled: [] };
  if (!previous) return out;
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  const now = new Map(next.map((entry) => [entry.id, entry]));
  for (const entry of next) {
    const old = before.get(entry.id);
    if (!old) {
      // Una cita que recién entra a la ventana por el día que se suma al final no es «nueva».
      if (window.previousEnd && chileDay(entry.startAt) > window.previousEnd) continue;
      out.added.push(entry);
    } else if (old.startAt !== entry.startAt) out.moved.push({ entry, fromStartAt: old.startAt });
  }
  for (const old of previous) {
    if (now.has(old.id) || chileDay(old.startAt) < window.from) continue;
    const current = known.get(old.id);
    if (current && current !== old.startAt) out.moved.push({ entry: { ...old, startAt: current, endAt: current }, fromStartAt: old.startAt });
    else if (!current) out.cancelled.push(old);
  }
  return out;
}

export const changeCount = (changes: DigestChanges) => changes.added.length + changes.moved.length + changes.cancelled.length;

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hhmm = (iso: string) => whenParts(iso).time;
const minutes = (entry: DigestEntry) => Math.max(0, Math.round((Date.parse(entry.endAt) - Date.parse(entry.startAt)) / 60000));
const hourText = (entry: DigestEntry) => entry.allDay ? "Todo el día" : `${hhmm(entry.startAt)}${minutes(entry) ? ` (${minutes(entry)} min)` : ""}`;
const dayText = (iso: string) => whenParts(iso).day;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type DigestMail = { subject: string; text: string; html: string };
export function digestEmail(input: { clinicName?: string; days: string[]; entries: DigestEntry[]; changes: DigestChanges; first: boolean; test?: boolean }): DigestMail {
  const { entries, changes } = input;
  const total = changeCount(changes);
  const range = `${dayText(`${input.days[0]}T12:00:00Z`)} al ${dayText(`${input.days[input.days.length - 1]}T12:00:00Z`)}`;
  const subject = `${input.test ? "[Prueba] " : ""}Agenda de la semana · ${entries.length} ${entries.length === 1 ? "cita" : "citas"}${total ? ` · ${total} ${total === 1 ? "cambio" : "cambios"}` : ""}${input.clinicName ? ` · ${clean(input.clinicName, 60)}` : ""}`;
  const changedIds = new Map<number, string>();
  changes.added.forEach((entry) => changedIds.set(entry.id, "NUEVA"));
  changes.moved.forEach(({ entry }) => changedIds.set(entry.id, "CAMBIÓ"));

  const changeLines: string[] = [];
  for (const entry of changes.added) changeLines.push(`NUEVA: ${cap(dayText(entry.startAt))}, ${hourText(entry)} · ${entry.label}`);
  for (const { entry, fromStartAt } of changes.moved) changeLines.push(`CAMBIÓ: ${entry.label} · de ${dayText(fromStartAt)} ${hhmm(fromStartAt)} a ${dayText(entry.startAt)} ${hhmm(entry.startAt)}`);
  for (const entry of changes.cancelled) changeLines.push(`CANCELADA: ${cap(dayText(entry.startAt))}, ${hhmm(entry.startAt)} · ${entry.label}`);

  const byDay = new Map<string, DigestEntry[]>();
  for (const entry of entries) { const day = chileDay(entry.startAt); byDay.set(day, [...(byDay.get(day) ?? []), entry]); }
  const intro = input.first ? "Agenda de hoy y los 6 días siguientes." : total ? "Cambios desde la última agenda que recibiste:" : "No hubo cambios desde la última agenda.";

  const textDays = input.days.map((day) => {
    const list = byDay.get(day) ?? [];
    return [cap(dayText(`${day}T12:00:00Z`)), ...(list.length ? list.map((entry) => `  ${hourText(entry)} · ${entry.label}${changedIds.has(entry.id) ? `  [${changedIds.get(entry.id)}]` : ""}`) : ["  Sin citas"])].join("\n");
  });
  const text = [`Agenda de la semana (${range})${input.clinicName ? ` · ${clean(input.clinicName, 60)}` : ""}`, "", intro, ...changeLines.map((line) => `- ${line}`), "", ...textDays.flatMap((block) => [block, ""]), "Mensaje automático de la agenda. Solo incluye nombre, hora y motivo de cada cita."].join("\n");

  const color = (kind: string) => kind.startsWith("CANCEL") ? "#b42318" : kind.startsWith("NUEVA") ? "#067647" : "#9a4a26";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2b2b3b;max-width:620px">
<h2 style="margin:0 0 4px;font-size:18px">Agenda de la semana</h2><p style="margin:0 0 12px;color:#6b6a7c;font-size:13px">${esc(range)}${input.clinicName ? ` · ${esc(clean(input.clinicName, 60))}` : ""}</p>
<p style="margin:0 0 8px;font-size:14px"><strong>${esc(intro)}</strong></p>
${changeLines.length ? `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px">${changeLines.map((line) => { const kind = line.split(":")[0]; return `<li style="margin:3px 0"><strong style="color:${color(kind)}">${esc(kind)}</strong>${esc(line.slice(kind.length))}</li>`; }).join("")}</ul>` : ""}
${input.days.map((day) => { const list = byDay.get(day) ?? []; return `<h3 style="margin:14px 0 4px;font-size:14px;border-bottom:1px solid #e6e4ee;padding-bottom:3px">${esc(cap(dayText(`${day}T12:00:00Z`)))}</h3>${list.length ? `<table style="border-collapse:collapse;font-size:14px;width:100%">${list.map((entry) => `<tr><td style="padding:3px 10px 3px 0;white-space:nowrap;vertical-align:top;color:#473a6d"><strong>${esc(hourText(entry))}</strong></td><td style="padding:3px 0">${esc(entry.label)}${changedIds.has(entry.id) ? ` <strong style="color:${color(changedIds.get(entry.id)!)};font-size:12px">${esc(changedIds.get(entry.id)!)}</strong>` : ""}</td></tr>`).join("")}</table>` : `<p style="margin:2px 0;font-size:13px;color:#6b6a7c">Sin citas</p>`}`; }).join("")}
<p style="margin:18px 0 0;font-size:12px;color:#6b6a7c">Mensaje automático de la agenda. Solo incluye nombre, hora y motivo de cada cita.</p></div>`;
  return { subject, text, html };
}

/** Versión para WhatsApp: texto corto con *negritas* de WhatsApp, lista para que quien envía solo toque «enviar». */
export function digestWhatsApp(input: { clinicName?: string; days: string[]; entries: DigestEntry[]; changes: DigestChanges; first: boolean }): string {
  const { entries, changes } = input;
  const byDay = new Map<string, DigestEntry[]>();
  for (const entry of entries) { const day = chileDay(entry.startAt); byDay.set(day, [...(byDay.get(day) ?? []), entry]); }
  const lines = [`*Agenda de la semana*${input.clinicName ? ` · ${clean(input.clinicName, 60)}` : ""}`];
  const changeLines = [
    ...changes.added.map((entry) => `🆕 NUEVA: ${cap(dayText(entry.startAt))}, ${hourText(entry)} · ${entry.label}`),
    ...changes.moved.map(({ entry, fromStartAt }) => `🔁 CAMBIÓ: ${entry.label} · de ${dayText(fromStartAt)} ${hhmm(fromStartAt)} a ${dayText(entry.startAt)} ${hhmm(entry.startAt)}`),
    ...changes.cancelled.map((entry) => `❌ CANCELADA: ${cap(dayText(entry.startAt))}, ${hhmm(entry.startAt)} · ${entry.label}`),
  ];
  if (changeLines.length) lines.push("", "*Cambios desde el último envío:*", ...changeLines);
  else if (!input.first) lines.push("", "Sin cambios desde el último envío.");
  for (const day of input.days) {
    const list = byDay.get(day) ?? [];
    lines.push("", `*${cap(dayText(`${day}T12:00:00Z`))}*`, ...(list.length ? list.map((entry) => `${hourText(entry)} · ${entry.label}`) : ["Sin citas"]));
  }
  return lines.join("\n");
}

export const isDigestEmail = isValidEmail;
