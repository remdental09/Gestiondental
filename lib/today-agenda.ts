import { chileDay } from "./chile-day.ts";

export type TodayEvent = { id: number; title: string; startAt: string; endAt: string; status: string; allDay: boolean; patientId: number | null };
export type TodayPatient = { id: number; name: string; rut?: string };
export type TodayBudget = { id: number; patientId: number; total: number; isAlternative: boolean };
export type TodayPayment = { patientId: number; amount: number };

export type TodayItem<E extends TodayEvent, P extends TodayPatient> = { event: E; patient: P | null; state: "pasada" | "ahora" | "siguiente" | "luego" };
export type PendingBalance<P extends TodayPatient> = { patient: P; owed: number };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Paciente de una cita: por vínculo directo o, si falta, porque el título contiene el nombre completo (nombre y al menos un apellido). */
export function patientForEvent<P extends TodayPatient>(event: TodayEvent, patients: P[]): P | null {
  if (event.patientId !== null) {
    const linked = patients.find(patient => patient.id === event.patientId);
    if (linked) return linked;
  }
  const title = ` ${fold(event.title)} `;
  const matches = patients.filter(patient => {
    const parts = fold(patient.name).split(" ").filter(part => part.length > 1);
    const present = parts.filter(part => title.includes(` ${part} `));
    return parts.length >= 2 && present.length >= 2 && title.includes(` ${parts[0]} `);
  });
  // Un nombre que coincide con varias fichas es ambiguo: no se adivina.
  return matches.length === 1 ? matches[0] : null;
}

/** Citas de hoy (hora de Chile) en orden, marcando cuál está en curso y cuál sigue. */
export function todayAgenda<E extends TodayEvent, P extends TodayPatient>(events: E[], patients: P[], now: Date = new Date()): TodayItem<E, P>[] {
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
    return { event, patient: patientForEvent(event, patients), state };
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
