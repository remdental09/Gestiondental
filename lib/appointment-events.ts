// Citas agendadas en la ficha («Agendar control») mostradas como eventos de la agenda general.
export type FichaAppointment = { id: number; patientId: number; day: string; time: string; reason: string };
export type AgendaEvent = { id: number; title: string; startAt: string; endAt: string; sourceTimeZone: string; htmlLink: string | null; status: string; allDay: boolean; patientId: number | null };

const chileParts = (date: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
};

/** Hora de reloj de Chile (dd-mm-aaaa o aaaa-mm-dd + hh:mm) → instante ISO UTC. */
export function chileLocalToIso(day: string, time: string): string | null {
  const bits = day.split("-").map(Number);
  const [y, m, d] = bits[0] > 31 ? bits : [bits[2], bits[1], bits[0]];
  const [h, min] = time.split(":").map(Number);
  if ([y, m, d, h, min].some(n => !Number.isFinite(n))) return null;
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess += wanted - chileParts(new Date(guess));
  return new Date(guess).toISOString();
}

export function appointmentsAsEvents(appointments: FichaAppointment[], patientName: (id: number) => string, existing: AgendaEvent[]): AgendaEvent[] {
  const taken = new Set(existing.filter(e => e.patientId !== null).map(e => `${e.patientId}|${e.startAt.slice(0, 16)}`));
  const out: AgendaEvent[] = [];
  for (const a of appointments) {
    const startAt = chileLocalToIso(a.day, a.time);
    if (!startAt || taken.has(`${a.patientId}|${startAt.slice(0, 16)}`)) continue;
    const endAt = new Date(new Date(startAt).getTime() + 30 * 60000).toISOString();
    const name = patientName(a.patientId);
    out.push({ id: -a.id, title: [name, a.reason].filter(Boolean).join(" · "), startAt, endAt, sourceTimeZone: "America/Santiago", htmlLink: null, status: "confirmed", allDay: false, patientId: a.patientId });
  }
  return out;
}
