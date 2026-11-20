/**
 * Ida y vuelta con Google Calendar: qué hacer en la app cuando cambia en Google un evento que la app creó.
 * Lógica pura (sin red ni base de datos) para poder probarla.
 */
export type IncomingGoogleEvent = { id: string; status?: string; updated?: string; summary?: string; iCalUID?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };
export type LinkState = { googleUpdated: string | null; appChangedAt: string | null; cancelled?: boolean };
/** Cita de la app tal como la conoce (title = motivo guardado; se compara con el motivo que sale del título de Google). */
export type AppAppointment = { day: string; time: string; minutes?: number | null; title?: string | null } | null;
export type GoogleChange =
  | { kind: "ignore"; why: "eco" | "app-mas-reciente" | "sin-cambio" | "sin-cita" | "sin-fecha" }
  | { kind: "update"; day: string; time: string; minutes: number; title: string | null; restore: boolean }
  | { kind: "cancel" };

const ms = (value: string | null | undefined) => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : null; };
export const DEFAULT_MINUTES = 30;

/** Fecha (YYYY-MM-DD) y hora (HH:MM) en Chile de un instante ISO. */
export function chileDayTime(iso: string): { day: string; time: string } | null {
  const t = ms(iso);
  if (t === null) return null;
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  const [day, time] = parts.split(" ");
  return day && time ? { day, time } : null;
}
/** Duración en minutos entre inicio y término (5 min a 8 h; si falta, 30). */
export function minutesBetween(startIso: string | undefined, endIso: string | undefined): number {
  const a = ms(startIso), b = ms(endIso);
  if (a === null || b === null || b <= a) return DEFAULT_MINUTES;
  return Math.min(480, Math.max(5, Math.round((b - a) / 60000)));
}

/**
 * Decide el efecto de un cambio de Google sobre la cita de la app.
 * - Eco: si Google no tiene nada más nuevo que lo último que la app escribió o leyó, no se hace nada (evita rebotes).
 * - Gana el cambio más reciente: si la app cambió la cita después de la edición en Google, se ignora.
 * - Borrado/cancelado → se cancela (reversible). Restaurado de la papelera → vuelve a agendada.
 * - Movido, otra duración u otro título → se actualiza la cita (sin tocar el paciente).
 */
export function decideGoogleChange(event: IncomingGoogleEvent, link: LinkState, appointment: AppAppointment, reasonOf: (title: string) => string = title => title): GoogleChange {
  if (!appointment) return { kind: "ignore", why: "sin-cita" };
  const updated = ms(event.updated);
  const seen = ms(link.googleUpdated);
  if (updated !== null && seen !== null && updated <= seen) return { kind: "ignore", why: "eco" };
  const appChanged = ms(link.appChangedAt);
  if (updated !== null && appChanged !== null && updated <= appChanged) return { kind: "ignore", why: "app-mas-reciente" };
  if (event.status === "cancelled") return link.cancelled ? { kind: "ignore", why: "sin-cambio" } : { kind: "cancel" };
  let next: { day: string; time: string } | null = null;
  if (event.start?.dateTime) next = chileDayTime(event.start.dateTime);
  else if (event.start?.date && /^\d{4}-\d{2}-\d{2}$/.test(event.start.date)) next = { day: event.start.date, time: appointment.time }; // pasado a «todo el día»: se toma la fecha, se mantiene la hora
  if (!next) return { kind: "ignore", why: "sin-fecha" };
  const minutes = event.start?.dateTime ? minutesBetween(event.start.dateTime, event.end?.dateTime) : (appointment.minutes ?? DEFAULT_MINUTES);
  const title = typeof event.summary === "string" && event.summary.trim() ? event.summary.trim().slice(0, 300) : null;
  const restore = !!link.cancelled;
  const moved = next.day !== appointment.day || next.time !== appointment.time;
  const resized = minutes !== (appointment.minutes ?? DEFAULT_MINUTES);
  const renamed = title !== null && reasonOf(title) !== (appointment.title ?? null);
  if (!restore && !moved && !resized && !renamed) return { kind: "ignore", why: "sin-cambio" };
  return { kind: "update", day: next.day, time: next.time, minutes, title: renamed ? title : null, restore };
}

/** El más nuevo de dos instantes ISO (para guardar lo último visto de Google sin retroceder). */
export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = ms(a), y = ms(b);
  if (x === null) return y === null ? null : b!;
  if (y === null) return a!;
  return x >= y ? a! : b!;
}

/** Cada cuánto se puede repetir la sincronización a pedido (al abrir agenda o controles). */
export const ON_DEMAND_SYNC_MS = 2 * 60_000;
export const shouldSyncNow = (lastRunAt: string | null | undefined, now: Date, minGapMs = ON_DEMAND_SYNC_MS) => {
  const last = ms(lastRunAt);
  return last === null || now.getTime() - last >= minGapMs;
};
