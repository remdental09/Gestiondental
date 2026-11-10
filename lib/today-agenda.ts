import { chileDay } from "./chile-day.ts";

export type TodayEvent = { id: number; title: string; startAt: string; endAt: string; status: string; allDay: boolean; patientId: number | null };
export type TodayPatient = { id: number; name: string; rut?: string; phone?: string; email?: string };
/** Contactos hallados en la descripción o los invitados de cada cita (celulares y correos ya extraídos; no se guarda el texto). */
export type EventHints = Record<number, string>;
export type TodayBudget = { id: number; patientId: number; total: number; isAlternative: boolean };
export type TodayPayment = { patientId: number; amount: number };

export type TodayItem<E extends TodayEvent, P extends TodayPatient> = { event: E; patient: P | null; state: "pasada" | "ahora" | "siguiente" | "luego" };
export type PendingBalance<P extends TodayPatient> = { patient: P; owed: number };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const MOBILE_IN_TEXT = /(?<!\d)(?:\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const mobileKey = (value: string | undefined) => { const digits = (value ?? "").replace(/\D/g, ""); const national = digits.startsWith("56") && digits.length === 11 ? digits.slice(2) : digits; return /^9\d{8}$/.test(national) ? national : null; };

/** Celulares chilenos (9 dígitos) y correos que aparecen en un texto, ya normalizados. */
export function contactTokens(text: string): string[] {
  const phones = (text.match(MOBILE_IN_TEXT) ?? []).map(match => mobileKey(match)).filter((key): key is string => key !== null);
  const emails = (text.match(EMAIL_IN_TEXT) ?? []).map(email => email.toLowerCase());
  return [...new Set([...phones, ...emails])];
}

/** Paciente de una cita: por vínculo directo, por celular o correo (en el título o en la descripción/invitados), o por nombre y apellido únicos. */
export function patientForEvent<P extends TodayPatient>(event: TodayEvent, patients: P[], hint = ""): P | null {
  if (event.patientId !== null) {
    const linked = patients.find(patient => patient.id === event.patientId);
    if (linked) return linked;
  }
  const tokens = new Set([...contactTokens(event.title), ...contactTokens(hint), ...hint.split(/\s+/).map(part => part.toLowerCase()).filter(part => part.includes("@"))]);
  if (tokens.size > 0) {
    const byContact = patients.filter(patient => {
      const phone = mobileKey(patient.phone);
      const email = patient.email?.trim().toLowerCase();
      return (phone !== null && tokens.has(phone)) || (!!email && tokens.has(email));
    });
    // Un celular o correo compartido por varias fichas (p. ej. una madre con sus hijos) es ambiguo: no se adivina.
    if (byContact.length === 1) return byContact[0];
    if (byContact.length > 1) return null;
  }
  const title = ` ${fold(event.title)} `;
  const matches = patients.filter(patient => {
    const parts = fold(patient.name).split(" ").filter(part => part.length > 1);
    const present = parts.filter(part => title.includes(` ${part} `));
    return parts.length >= 2 && present.length >= 2 && title.includes(` ${parts[0]} `);
  });
  if (matches.length === 1) return matches[0];
  // Si varias comparten algunas palabras, gana la ficha cuyo nombre completo aparece en el título (p. ej. «Luis Paul Rodríguez Murga» frente a «Luis Orlando Rodríguez Valenzuela»).
  const complete = matches.filter(patient => fold(patient.name).split(" ").filter(part => part.length > 1).every(part => title.includes(` ${part} `)));
  if (complete.length === 1) return complete[0];
  // Un nombre que coincide con varias fichas es ambiguo: no se adivina.
  return null;
}

/** Citas confirmadas de un día de Chile (AAAA-MM-DD), en orden, con su paciente si se reconoce. */
export function agendaForDay<E extends TodayEvent, P extends TodayPatient>(events: E[], patients: P[], day: string, hints: EventHints = {}): Array<{ event: E; patient: P | null }> {
  return events
    .filter(event => event.status === "confirmed" && !event.allDay && chileDay(event.startAt) === day)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map(event => ({ event, patient: patientForEvent(event, patients, hints[event.id]) }));
}

/** Día siguiente (AAAA-MM-DD) de un día de Chile. */
export function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Teléfono chileno de WhatsApp (solo celulares: 9 dígitos que parten en 9) en formato internacional sin «+»; null si no sirve. */
export function whatsappNumber(phone: string | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const national = digits.startsWith("56") && digits.length === 11 ? digits.slice(2) : digits;
  return /^9\d{8}$/.test(national) ? `56${national}` : null;
}

/** Mensaje de confirmación listo para enviar; el profesional solo toca «enviar». */
export function confirmationMessage(input: { patientName: string; startAt: string; clinicName?: string }): string {
  const first = input.patientName.trim().split(/\s+/)[0] ?? "";
  const when = new Date(input.startAt);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).formatToParts(when).map(part => [part.type, part.value]));
  const day = `${parts.weekday} ${parts.day} de ${parts.month}`;
  const time = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(when);
  const place = input.clinicName?.trim() ? ` en ${input.clinicName.trim()}` : "";
  return `Hola ${first}, le recuerdo su cita el ${day} a las ${time}${place}. ¿Me confirma su asistencia? Gracias.`;
}

export function whatsappLink(phone: string | undefined, message: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

/** Citas de hoy (hora de Chile) en orden, marcando cuál está en curso y cuál sigue. */
export function todayAgenda<E extends TodayEvent, P extends TodayPatient>(events: E[], patients: P[], now: Date = new Date(), hints: EventHints = {}): TodayItem<E, P>[] {
  const today = chileDay(now.toISOString());
  const list = events
    .filter(event => event.status === "confirmed" && !event.allDay && chileDay(event.startAt) === today)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const t = now.getTime();
  let nextMarked = false;
  return list.map(event => {
    const start = new Date(event.startAt).getTime();
    const end = new Date(event.endAt).getTime();
    let state: TodayItem<E, P>["state"];
    if (end <= t) state = "pasada";
    else if (start <= t) state = "ahora";
    else if (!nextMarked) { state = "siguiente"; nextMarked = true; }
    else state = "luego";
    return { event, patient: patientForEvent(event, patients, hints[event.id]), state };
  });
}

/** Saldo estimado por paciente: presupuestos principales menos abonos registrados. Solo los que deben algo, de mayor a menor. */
export function pendingBalances<P extends TodayPatient>(patients: P[], budgets: TodayBudget[], payments: TodayPayment[], limit = 5): PendingBalance<P>[] {
  const result: PendingBalance<P>[] = [];
  for (const patient of patients) {
    const planned = budgets.filter(b => b.patientId === patient.id && !b.isAlternative).reduce((sum, b) => sum + b.total, 0);
    if (planned <= 0) continue;
    const paid = payments.filter(p => p.patientId === patient.id).reduce((sum, p) => sum + p.amount, 0);
    const owed = planned - paid;
    if (owed > 0) result.push({ patient, owed });
  }
  return result.sort((a, b) => b.owed - a.owed).slice(0, limit);
}

/** Búsqueda rápida por nombre (en cualquier orden) o RUT; sin tildes ni puntos. */
export function quickSearch<P extends TodayPatient>(patients: P[], query: string, limit = 6): P[] {
  const q = fold(query);
  const digits = query.replace(/[^0-9kK]/g, "").toLowerCase();
  if (q.length < 2 && digits.length < 3) return [];
  const words = q.split(" ").filter(Boolean);
  return patients
    .filter(patient => {
      const name = fold(patient.name);
      const byName = words.length > 0 && words.every(word => name.includes(word));
      const byRut = digits.length >= 3 && (patient.rut ?? "").replace(/[^0-9kK]/g, "").toLowerCase().includes(digits);
      return byName || byRut;
    })
    .slice(0, limit);
}
