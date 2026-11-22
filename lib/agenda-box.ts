/**
 * Agenda «Día por box» (como Dentalsoft): lógica pura, sin red ni base de datos.
 * Estados con su color, box con tipo y color, horarios por box que generan los cupos libres,
 * bloqueos con repetición y la ubicación de cada tarjeta en la grilla de 15 minutos.
 */
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, type AttendanceStatus } from "./dashboard.ts";

/** Esquema aditivo (se ejecuta con IF NOT EXISTS / ALTER ADD COLUMN tolerante): nunca borra datos. */
export const BOX_SCHEMA_DDL = [
  "CREATE TABLE IF NOT EXISTS treatment_boxes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS box_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, box_id INTEGER NOT NULL, professional TEXT NOT NULL DEFAULT '', weekdays TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, valid_from TEXT, valid_to TEXT, block_minutes INTEGER NOT NULL DEFAULT 30, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS box_schedules_owner ON box_schedules (owner_id, box_id)",
  "CREATE TABLE IF NOT EXISTS agenda_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, box_id INTEGER, day TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, repeat TEXT NOT NULL DEFAULT 'none', until TEXT, reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, removed_at TEXT)",
  "CREATE INDEX IF NOT EXISTS agenda_blocks_owner ON agenda_blocks (owner_id, day)",
];
/** Columnas nuevas (si ya existen, el ALTER falla y se ignora). */
export const BOX_COLUMNS_DDL = [
  "ALTER TABLE treatment_boxes ADD COLUMN kind TEXT",
  "ALTER TABLE treatment_boxes ADD COLUMN color TEXT",
  "ALTER TABLE appointments ADD COLUMN minutes INTEGER",
  "ALTER TABLE appointments ADD COLUMN box_id INTEGER",
  "ALTER TABLE appointments ADD COLUMN professional TEXT",
];

export const BOX_KINDS = ["odontologia", "pabellon", "radiologia"] as const;
export type BoxKind = typeof BOX_KINDS[number];
export const BOX_KIND_LABEL: Record<BoxKind, string> = { odontologia: "Odontología", pabellon: "Pabellón", radiologia: "Radiología" };
export const isBoxKind = (value: unknown): value is BoxKind => typeof value === "string" && (BOX_KINDS as readonly string[]).includes(value);
export const BOX_COLORS = ["#473a6d", "#4a97c6", "#64b873", "#f49f33", "#9575cd", "#e8c73f", "#80cbc4", "#e57373"];
export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Color = solo el estado (paleta de Dentalsoft). */
export const STATUS_COLOR: Record<AttendanceStatus, string> = {
  agendada: "#a5bbc7", en_espera: "#f49f33", confirmada: "#4a97c6", ingresada: "#64b873", cancelada: "#92a2a8", atendida: "#9575cd",
  notificada_email: "#80cbc4", confirmada_email: "#4db6ac", notificada_whatsapp: "#e8c73f", confirmada_whatsapp: "#9ccc65", inasistida: "#6d7b82", reagendada: "#b0a4c8",
};
export const BLOCK_COLOR = "#e53935";
/** Orden de la leyenda «Colores». */
export const LEGEND_ORDER: AttendanceStatus[] = ["agendada", "en_espera", "confirmada", "ingresada", "cancelada", "atendida", "notificada_email", "confirmada_email", "notificada_whatsapp", "confirmada_whatsapp", "inasistida", "reagendada"];
export const LEGEND = LEGEND_ORDER.map(status => ({ status, label: ATTENDANCE_LABEL[status], color: STATUS_COLOR[status] }));
/** Botones rápidos de la tarjeta (ciclo de la cita): ✓ confirmada → 🪑 llegó (sala de espera) → ➜ en box → 👍 atendida. */
export const QUICK_STATUS: { status: AttendanceStatus; icon: string; label: string }[] = [
  { status: "confirmada", icon: "✓", label: "Confirmada" },
  { status: "en_espera", icon: "🪑", label: "Llegó" },
  { status: "ingresada", icon: "➜", label: "En box" },
  { status: "atendida", icon: "👍", label: "Atendida" },
];
/** Estados que liberan el cupo (no ocupan la grilla para calcular cupos libres y sugieren la lista de espera). */
export const FREES_SLOT: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>(["cancelada", "reagendada"]);
export const freesSlot = (status: AttendanceStatus) => FREES_SLOT.has(status);
export const statusOf = (value: unknown): AttendanceStatus => typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value) ? value as AttendanceStatus : "agendada";
/** Texto oscuro o claro según el fondo, para que se lea en iPhone al sol. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#1f2430" : "#ffffff";
}

export const SLOT_MINUTES = 15;
export const isClock = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const isIsoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T12:00:00Z"));
export const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** 0 = domingo … 6 = sábado (día civil, sin depender de la zona horaria del equipo). */
export const weekdayOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();
export const addDays = (day: string, n: number) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Lunes a domingo de la semana del día. */
export function weekOf(day: string): string[] {
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
/** Duraciones en módulos de 15 minutos (15 min a 4 h). */
export const DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * SLOT_MINUTES);

export type BoxSchedule = { id: number; boxId: number; professional: string; professionalId: number | null; weekdays: number[]; start: string; end: string; validFrom: string | null; validTo: string | null; blockMinutes: number };
export type AgendaBlock = { id: number; boxId: number | null; day: string; start: string; end: string; repeat: "none" | "weekly" | "daily"; until: string | null; reason: string; note: string };
export type Busy = { boxId: number | null; start: string; minutes: number };

export const parseWeekdays = (value: string) => [...new Set(value.split(",").map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();

/** Valida un horario de box. */
export function checkSchedule(input: { weekdays: unknown; start: unknown; end: unknown; validFrom?: unknown; validTo?: unknown; blockMinutes?: unknown }): { ok: true; weekdays: number[]; start: string; end: string; validFrom: string | null; validTo: string | null; blockMinutes: number } | { ok: false; error: string } {
  const weekdays = Array.isArray(input.weekdays) ? [...new Set(input.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  if (!weekdays.length) return { ok: false, error: "Elige al menos un día de la semana." };
  if (!isClock(input.start) || !isClock(input.end) || toMinutes(input.end) <= toMinutes(input.start)) return { ok: false, error: "Revisa la hora de inicio y término." };
  const validFrom = isIsoDay(input.validFrom) ? input.validFrom : null;
  const validTo = isIsoDay(input.validTo) ? input.validTo : null;
  if (validFrom && validTo && validTo < validFrom) return { ok: false, error: "La fecha «hasta» es anterior a «desde»." };
  const block = Number(input.blockMinutes ?? 30);
  const blockMinutes = DURATIONS.includes(block) ? block : 30;
  return { ok: true, weekdays, start: input.start, end: input.end, validFrom, validTo, blockMinutes };
}

/** ¿El bloqueo (con su repetición) cae ese día? */
export function blockOccursOn(block: AgendaBlock, day: string): boolean {
  if (day < block.day) return false;
  if (block.repeat === "none") return day === block.day;
  if (block.until && day > block.until) return false;
  return block.repeat === "daily" || weekdayOf(day) === weekdayOf(block.day);
}
export const blocksOn = (blocks: AgendaBlock[], day: string) => blocks.filter(block => blockOccursOn(block, day));

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

export type FreeSlot = { boxId: number; start: string; minutes: number; professional: string; professionalId: number | null };
/**
 * Cupos libres de un box ese día, a partir de sus horarios vigentes: bloques del largo configurado,
 * sin los que chocan con una cita (no cancelada) o un bloqueo de ese box (o de todos los box).
 */
export function freeSlots(schedules: BoxSchedule[], boxId: number, day: string, busy: Busy[], blocks: AgendaBlock[]): FreeSlot[] {
  const weekday = weekdayOf(day);
  const taken = [
    ...busy.filter(b => b.boxId === boxId).map(b => [toMinutes(b.start), toMinutes(b.start) + b.minutes] as const),
    ...blocksOn(blocks, day).filter(b => b.boxId === null || b.boxId === boxId).map(b => [toMinutes(b.start), toMinutes(b.end)] as const),
  ];
  const out: FreeSlot[] = [];
  const seen = new Set<number>();
  for (const s of schedules) {
    if (s.boxId !== boxId || !s.weekdays.includes(weekday)) continue;
    if ((s.validFrom && day < s.validFrom) || (s.validTo && day > s.validTo)) continue;
    const end = toMinutes(s.end);
    for (let t = toMinutes(s.start); t + s.blockMinutes <= end; t += s.blockMinutes) {
      if (seen.has(t) || taken.some(([a, b]) => overlaps(t, t + s.blockMinutes, a, b))) continue;
      seen.add(t);
      out.push({ boxId, start: toClock(t), minutes: s.blockMinutes, professional: s.professional, professionalId: s.professionalId ?? null });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Rango de horas de la grilla: lo que cubren horarios, citas y bloqueos; por defecto 08:00–20:00. */
export function dayRange(schedules: BoxSchedule[], day: string, items: { start: string; minutes: number }[]): { from: number; to: number } {
  let from = 8 * 60, to = 20 * 60;
  const weekday = weekdayOf(day);
  for (const s of schedules) if (s.weekdays.includes(weekday)) { from = Math.min(from, toMinutes(s.start)); to = Math.max(to, toMinutes(s.end)); }
  for (const item of items) { from = Math.min(from, toMinutes(item.start)); to = Math.max(to, toMinutes(item.start) + item.minutes); }
  from = Math.floor(from / 60) * 60;
  to = Math.min(24 * 60, Math.ceil(to / 60) * 60);
  return { from, to };
}
/** Posición vertical de una tarjeta: alto proporcional a la duración (mínimo un módulo). */
export function cardBox(start: string, minutes: number, from: number, rowPx: number): { top: number; height: number } {
  return { top: ((toMinutes(start) - from) / SLOT_MINUTES) * rowPx, height: Math.max(1, minutes / SLOT_MINUTES) * rowPx };
}
/** Hora (múltiplo de 15) que corresponde a un toque en la columna. */
export const clockAt = (offsetPx: number, from: number, rowPx: number) => toClock(from + Math.max(0, Math.floor(offsetPx / rowPx)) * SLOT_MINUTES);

/** Columnas de la vista: box habilitados y, si hay citas sin box, la columna «Sin box» (id null) al final. */
export function columnsFor<T extends { id: number; enabled: boolean }>(boxes: T[], items: { boxId: number | null }[]): ({ id: number | null })[] {
  const enabled = boxes.filter(b => b.enabled);
  const known = new Set(enabled.map(b => b.id));
  const orphan = items.some(item => item.boxId === null || !known.has(item.boxId));
  return [...enabled.map(b => ({ id: b.id as number | null })), ...(orphan ? [{ id: null }] : [])];
}
/** Columna en que se muestra un ítem: su box si está habilitado; si no, «Sin box». */
export const columnOf = (boxIds: Set<number>, boxId: number | null) => boxId !== null && boxIds.has(boxId) ? boxId : null;

/** Número de WhatsApp (Chile) desde un teléfono escrito a mano; null si no parece un celular. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^569\d{8}$/.test(digits)) return digits;
  if (/^9\d{8}$/.test(digits)) return "56" + digits;
  if (/^\d{10,15}$/.test(digits) && !digits.startsWith("56")) return digits;
  return null;
}

/** Valida un bloqueo nuevo. */
export function checkBlock(input: { day: unknown; start: unknown; end: unknown; repeat?: unknown; until?: unknown }): { ok: true; day: string; start: string; end: string; repeat: AgendaBlock["repeat"]; until: string | null } | { ok: false; error: string } {
  if (!isIsoDay(input.day)) return { ok: false, error: "Fecha no válida." };
  if (!isClock(input.start) || !isClock(input.end) || toMinutes(input.end) <= toMinutes(input.start)) return { ok: false, error: "Revisa la hora de inicio y término del bloqueo." };
  const repeat = input.repeat === "weekly" || input.repeat === "daily" ? input.repeat : "none";
  const until = repeat === "none" ? null : isIsoDay(input.until) ? input.until : null;
  if (repeat !== "none" && !until) return { ok: false, error: "Indica hasta qué fecha se repite el bloqueo." };
  if (until && until < input.day) return { ok: false, error: "La fecha «hasta» es anterior al bloqueo." };
  if (until && (Date.parse(until) - Date.parse(input.day)) > 366 * 86400000) return { ok: false, error: "Un bloqueo puede repetirse hasta por un año." };
  return { ok: true, day: input.day, start: input.start, end: input.end, repeat, until };
}
