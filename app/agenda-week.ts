const SANTIAGO = "America/Santiago";

/** Civil date YYYY-MM-DD in America/Santiago. */
export function santiagoDateISO(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SANTIAGO, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Monday that opens the agenda for a Santiago civil date.
 * Friday and earlier stay in the current Monday–Sunday week.
 * Saturday and Sunday open the following Monday.
 */
export function mondayOfAgendaWeek(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Fecha inválida");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function shiftAgendaWeek(weekStart: string, weeks: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!match) throw new Error("Fecha inválida");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export type AgendaWeekDay = { key: string; label: string; date: number };

export function agendaWeekDays(weekStart: string): AgendaWeekDay[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${weekStart}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: SANTIAGO }).format(date).replace(".", ""),
      date: Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: SANTIAGO }).format(date)),
    };
  });
}

export function agendaWeekRangeLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: SANTIAGO });
  return `${format.format(start)} – ${format.format(end)}`.replace(/\./g, "");
}
