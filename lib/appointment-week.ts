/**
 * Miniatura de la semana para «Agendar cita»: lógica pura (sin red ni base de datos).
 * Pone las citas existentes en una grilla por día, calcula dónde caería la cita nueva, si choca con otra y cuánto tiempo libre queda cada día.
 * Todo en hora de Chile (America/Santiago). Los minutos se cuentan desde las 00:00 del día.
 */
export type WeekEvent = { id: number; title: string; startAt: string; endAt: string; allDay?: boolean; status?: string };
export type DayBlock = { id: number; title: string; start: number; end: number };
export type Proposed = { day: string; start: number; end: number };

const SANTIAGO = "America/Santiago";
/** Horario de atención que se usa para contar el tiempo libre (la clínica puede abrir antes o después; la grilla se amplía sola). */
export const WORK_WINDOW = { start: 9 * 60, end: 19 * 60 } as const;
export const DEFAULT_GRID = { startHour: 8, endHour: 20 } as const;

export function chileParts(iso: string): { day: string; minute: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: SANTIAGO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const parseTime = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};
export const formatTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const formatSpan = (minutes: number) => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours && rest ? `${hours} h ${rest} min` : hours ? `${hours} h` : `${rest} min`;
};

/** Lunes–domingo que contiene el día (a diferencia de la agenda, un sábado o domingo no salta a la semana siguiente). */
export function weekMonday(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Citas de la semana agrupadas por día (sin las canceladas ni las de todo el día), recortadas al día. */
export function blocksByDay(events: WeekEvent[], weekStart: string): Record<string, DayBlock[]> {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const out: Record<string, DayBlock[]> = Object.fromEntries(days.map(day => [day, []]));
  for (const event of events) {
    if (event.allDay || /cancel/i.test(event.status ?? "")) continue;
    const start = chileParts(event.startAt), end = chileParts(event.endAt);
    if (!start || !out[start.day]) continue;
    const endMinute = end && end.day === start.day ? end.minute : end && end.day > start.day ? 24 * 60 : start.minute + 30;
    out[start.day]!.push({ id: event.id, title: event.title, start: start.minute, end: Math.max(endMinute, start.minute + 15) });
  }
  for (const day of days) out[day]!.sort((a, b) => a.start - b.start);
  return out;
}

export function proposedBlock(day: string, time: string, minutes: number): Proposed | null {
  const start = parseTime(time);
  return start === null || !/^\d{4}-\d{2}-\d{2}$/.test(day) ? null : { day, start, end: Math.min(start + minutes, 24 * 60) };
}

/** Citas que se pisan con la nueva. */
export function conflictsWith(blocks: DayBlock[], proposed: Proposed): DayBlock[] {
  return blocks.filter(block => block.start < proposed.end && block.end > proposed.start);
}

/** Tiempo libre del día dentro del horario de atención y el mayor hueco continuo. */
export function freeSummary(blocks: DayBlock[], window: { start: number; end: number } = WORK_WINDOW): { freeMinutes: number; largest: { start: number; end: number } | null } {
  const busy: Array<[number, number]> = [];
  for (const block of blocks) {
    const start = Math.max(block.start, window.start), end = Math.min(block.end, window.end);
    if (end <= start) continue;
    const last = busy[busy.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else busy.push([start, end]);
  }
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = window.start;
  for (const [start, end] of busy) { if (start > cursor) gaps.push({ start: cursor, end: start }); cursor = Math.max(cursor, end); }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  const largest = gaps.reduce<{ start: number; end: number } | null>((best, gap) => !best || gap.end - gap.start > best.end - best.start ? gap : best, null);
  return { freeMinutes: gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0), largest };
}

/** Horas que muestra la grilla: de 8 a 20 por defecto, ampliada si hay citas (o la cita nueva) fuera de ese rango. */
export function gridHours(days: Record<string, DayBlock[]>, proposed: Proposed | null): { startHour: number; endHour: number } {
  let startHour: number = DEFAULT_GRID.startHour, endHour: number = DEFAULT_GRID.endHour;
  const all = [...Object.values(days).flat(), ...(proposed ? [{ start: proposed.start, end: proposed.end }] : [])];
  for (const item of all) { startHour = Math.min(startHour, Math.floor(item.start / 60)); endHour = Math.max(endHour, Math.ceil(item.end / 60)); }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

/** Hora (redondeada a 15 min) a la que corresponde un toque a `offsetY` píxeles del borde superior de la grilla. */
export function timeAtOffset(offsetY: number, hourHeight: number, startHour: number, endHour: number): string {
  const minute = startHour * 60 + Math.round((offsetY / hourHeight) * 4) * 15;
  return formatTime(Math.max(startHour * 60, Math.min(minute, endHour * 60 - 15)));
}
