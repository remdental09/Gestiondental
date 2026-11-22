/**
 * Ciclo de la cita (como Dentalsoft): Agendada → Confirmada → Llegó (sala de espera) → En box → Atendida,
 * más Inasistida, Cancelada y Reagendada. Lógica pura: horas de llegada / entrada a box / término, tiempos de espera
 * y la lista de espera (sugerencias cuando se libera un cupo, con enlace wa.me; nunca se envía nada solo).
 */
import type { AttendanceStatus } from "./dashboard.ts";

export type CycleTimes = { arrivedAt: string | null; inBoxAt: string | null; doneAt: string | null };
export const NO_TIMES: CycleTimes = { arrivedAt: null, inBoxAt: null, doneAt: null };

/**
 * Horas que quedan guardadas al marcar un estado. Se registra la primera vez (re-marcar no la mueve);
 * volver a un paso anterior borra las horas de los pasos siguientes (corrige un toque equivocado).
 * Cancelada / inasistida / reagendada conservan lo que había.
 */
export function nextTimes(prev: CycleTimes, status: AttendanceStatus, nowIso: string): CycleTimes {
  switch (status) {
    case "en_espera": return { arrivedAt: prev.arrivedAt ?? nowIso, inBoxAt: null, doneAt: null };
    case "ingresada": return { arrivedAt: prev.arrivedAt, inBoxAt: prev.inBoxAt ?? nowIso, doneAt: null };
    case "atendida": return { arrivedAt: prev.arrivedAt, inBoxAt: prev.inBoxAt, doneAt: prev.doneAt ?? nowIso };
    case "cancelada": case "inasistida": case "reagendada": return prev;
    default: return NO_TIMES; // agendada, confirmada, notificada…: aún no llega
  }
}

/** Minutos entre dos marcas ISO (redondeado hacia abajo, nunca negativo); null si falta alguna. */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from), b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 60000));
}
/** «8 min», «1 h 05 min». */
export function waitLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
/** Hora de Chile (HH:MM) de una marca ISO. */
export function chileClock(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

type WithCycle = CycleTimes & { status: AttendanceStatus; start: string };
/** Sala de espera: quienes llegaron y aún no pasan a box, del que lleva más tiempo esperando al que menos. */
export function waitingRoom<T extends WithCycle>(list: T[], nowIso: string): (T & { waiting: number | null })[] {
  return list.filter(a => a.status === "en_espera")
    .map(a => ({ ...a, waiting: minutesBetween(a.arrivedAt, nowIso) }))
    .sort((a, b) => (a.arrivedAt ?? "9").localeCompare(b.arrivedAt ?? "9") || a.start.localeCompare(b.start));
}
/** Espera promedio del día (llegó → en box) de quienes ya pasaron a box; null si nadie. */
export function averageWait(list: CycleTimes[]): number | null {
  const waits = list.map(a => minutesBetween(a.arrivedAt, a.inBoxAt)).filter((n): n is number => n !== null);
  return waits.length ? Math.round(waits.reduce((s, n) => s + n, 0) / waits.length) : null;
}

// ── Lista de espera ─────────────────────────────────────────────────────────
export const WAIT_PREFERENCES = ["cualquiera", "manana", "tarde"] as const;
export type WaitPreference = typeof WAIT_PREFERENCES[number];
export const WAIT_PREFERENCE_LABEL: Record<WaitPreference, string> = { cualquiera: "Cualquier horario", manana: "Mañana", tarde: "Tarde" };
export const isWaitPreference = (value: unknown): value is WaitPreference => typeof value === "string" && (WAIT_PREFERENCES as readonly string[]).includes(value);
export type WaitEntry = { id: number; patientId: number | null; name: string; phone: string; preference: WaitPreference; note: string; createdAt: string };

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Valida una persona nueva en la lista de espera (paciente existente o solo nombre y teléfono). */
export function checkWaitEntry(input: { patientId?: unknown; name?: unknown; phone?: unknown; preference?: unknown; note?: unknown }):
  { ok: true; patientId: number | null; name: string; phone: string; preference: WaitPreference; note: string } | { ok: false; error: string } {
  const id = Number(input.patientId);
  const patientId = input.patientId !== undefined && input.patientId !== null && input.patientId !== "" && Number.isSafeInteger(id) && id > 0 ? id : null;
  const name = clean(input.name, 120);
  if (!patientId && name.length < 3) return { ok: false, error: "Elige un paciente o escribe su nombre." };
  return { ok: true, patientId, name, phone: clean(input.phone, 30), preference: isWaitPreference(input.preference) ? input.preference : "cualquiera", note: clean(input.note, 300) };
}

/** Nombre comparable: sin tildes, minúsculas, espacios simples. */
export const normalizeName = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
/** Teléfono comparable: solo dígitos, últimos 9 (así «+56 9 1234 5678» = «912345678»); vacío si es muy corto. */
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-9) : "";
}
/**
 * ¿Ya está en la lista (activa) de la cuenta? Mismo paciente, mismo teléfono normalizado o mismo nombre normalizado.
 * Se reusa la entrada existente en vez de duplicar (conserva su lugar en la fila).
 */
export function findWaitDuplicate<T extends WaitEntry>(entries: T[], candidate: { patientId: number | null; name: string; phone: string }): T | null {
  const phone = normalizePhone(candidate.phone), name = normalizeName(candidate.name);
  return entries.find(e => (candidate.patientId !== null && e.patientId === candidate.patientId)
    || (phone !== "" && normalizePhone(e.phone) === phone)
    || (name.length >= 3 && normalizeName(e.name) === name)) ?? null;
}

/** ¿La preferencia calza con un cupo que parte a esa hora? Mañana = antes de las 13:00. */
export const preferenceFits = (preference: WaitPreference, start: string) => preference === "cualquiera" || (preference === "manana" ? start < "13:00" : start >= "13:00");
/** Sugerencias para un cupo liberado: primero los que calzan con el horario, luego por antigüedad en la lista. */
export function suggestForSlot<T extends WaitEntry>(entries: T[], slot: { start: string; patientId?: number | null }, limit = 5): T[] {
  return entries.filter(e => !slot.patientId || e.patientId !== slot.patientId)
    .map(e => ({ e, fit: preferenceFits(e.preference, slot.start) ? 0 : 1 }))
    .sort((a, b) => a.fit - b.fit || a.e.createdAt.localeCompare(b.e.createdAt))
    .slice(0, limit).map(x => x.e);
}
/** Texto del WhatsApp para ofrecer el cupo (lo envía la persona desde su teléfono; la app no envía nada). */
export function offerMessage(name: string, slot: { dayLabel: string; start: string }, clinic = ""): string {
  const first = name.trim().split(/\s+/)[0] || "";
  return `Hola${first ? " " + first : ""}, te escribimos${clinic ? " de " + clinic : ""}: se liberó una hora el ${slot.dayLabel} a las ${slot.start}. ¿Te acomoda? Responde este mensaje y te la reservamos.`;
}
export const waLink = (number: string, message: string) => `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
