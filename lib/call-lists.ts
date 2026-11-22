/**
 * Listas de «a quién llamar» para la recepción (como los recordatorios de Dentalsoft): pacientes sin cita futura,
 * inactivos, presupuestos sin iniciar y morosos. Lógica pura, sin red: la app arma el mensaje de WhatsApp y la persona
 * lo envía o llama; no se envía nada solo ni se guardan datos clínicos (solo fechas de visita, montos y contactos).
 */
import { budgetStatus } from "./budget-status.ts";
import { budgetOwed, budgetTotal, isoDay, clp } from "./dashboard.ts";
import type { BudgetItem } from "./budget-plans.ts";
import { whatsappNumber } from "./agenda-box.ts";
import { waLink } from "./appointment-cycle.ts";

export const CALL_LISTS = ["sinCita", "inactivos", "presupuestos", "morosos"] as const;
export type CallList = typeof CALL_LISTS[number];
export const isCallList = (value: unknown): value is CallList => typeof value === "string" && (CALL_LISTS as readonly string[]).includes(value);
export const CALL_LIST_LABEL: Record<CallList, string> = { sinCita: "Sin cita futura", inactivos: "Inactivos", presupuestos: "Presupuestos sin iniciar", morosos: "Morosos" };
export const CALL_LIST_HELP: Record<CallList, string> = {
  sinCita: "Pacientes que vinieron en el último período y no tienen ninguna cita desde hoy en adelante. Primero los que tienen un tratamiento a medias.",
  inactivos: "Pacientes sin cita futura cuya última visita fue hace más que el período elegido (o que nunca han venido).",
  presupuestos: "Presupuestos principales sin ninguna prestación realizada, de pacientes sin cita futura. Los vencidos (más allá de la vigencia) van al final.",
  morosos: "Pacientes con prestaciones ya realizadas que aún no pagan, de mayor a menor deuda. No cuenta lo presupuestado y no iniciado.",
};
/** Meses de inactividad que se pueden elegir. */
export const INACTIVE_MONTHS = [6, 12, 18, 24] as const;
export const DEFAULT_INACTIVE_MONTHS = 12;
/** Días que un paciente contactado se oculta de su lista. */
export const CONTACT_HIDE_DAYS = 14;

export type CallPatient = { id: number; name: string; phone: string; createdAt: string };
export type CallBudget = { id: number; patientId: number; items: BudgetItem[]; status: string; createdOn: string; isAlternative: boolean };
export type CallRows = {
  today: string;
  validityDays: number;
  patients: CallPatient[];
  /** Días en que el paciente vino de verdad (evolución, cita marcada «Atendida», prestación realizada). */
  visits: Array<{ patientId: number; day: string }>;
  /** Pacientes con una cita de hoy en adelante que no está cancelada ni reagendada. */
  withFutureAppointment: Set<number>;
  budgets: CallBudget[];
  payments: Array<{ budgetId: number | null; amount: number; paidOn: string }>;
  /** Último contacto por paciente y lista (AAAA-MM-DD). */
  contacts: Array<{ patientId: number; list: CallList; day: string }>;
};

export type CallEntry = {
  patientId: number;
  name: string;
  phone: string;
  /** Texto corto para la fila («Última visita hace 5 meses»). */
  detail: string;
  /** Fecha del último contacto de esta lista (AAAA-MM-DD) o null. */
  contactedOn: string | null;
  message: string;
  whatsapp: string | null;
  /** Solo en «sin cita»: tiene un presupuesto con prestaciones realizadas y otras pendientes. */
  inTreatment?: boolean;
  /** Solo en «presupuestos»: id del plan y si ya pasó la vigencia. */
  budgetId?: number;
  expired?: boolean;
  /** Solo en «morosos»: deuda en pesos. */
  owed?: number;
};
export type CallLists = Record<CallList, CallEntry[]>;

export function daysSince(from: string, to: string): number {
  const a = Date.parse(`${isoDay(from)}T12:00:00Z`), b = Date.parse(`${isoDay(to)}T12:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.floor((b - a) / 86400000);
}
/** «hoy», «hace 12 días», «hace 5 meses», «hace 1 año y 2 meses». */
export function agoLabel(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "";
  if (days === 0) return "hoy";
  if (days < 45) return days === 1 ? "hace 1 día" : `hace ${days} días`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12), rest = months % 12;
  return `hace ${years} ${years === 1 ? "año" : "años"}${rest ? ` y ${rest} ${rest === 1 ? "mes" : "meses"}` : ""}`;
}
/** ¿El contacto es reciente (la persona ya fue contactada y se oculta)? */
export const recentlyContacted = (contactedOn: string | null, today: string, days = CONTACT_HIDE_DAYS) => contactedOn !== null && daysSince(contactedOn, today) < days;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const shortDate = (day: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDay(day)}T12:00:00Z`));
const greet = (name: string, clinic: string) => `Hola ${firstName(name)}, le escribimos${clinic ? " de " + clinic : ""}.`;

/** Mensajes listos (solo nombre de pila y datos administrativos; nada clínico). */
export const callMessage = {
  sinCita: (name: string, clinic = "") => `${greet(name, clinic)} Quedó pendiente agendar su próxima hora. ¿Le acomoda que la coordinemos? Gracias.`,
  inactivos: (name: string, clinic = "") => `${greet(name, clinic)} Hace tiempo que no lo vemos y nos gustaría saber cómo está. ¿Le gustaría agendar un control? Gracias.`,
  presupuestos: (name: string, createdOn: string, clinic = "") => `${greet(name, clinic)} Le escribimos por el presupuesto que le entregamos el ${shortDate(createdOn)}. ¿Desea que lo revisemos juntos o agendemos el inicio del tratamiento? Gracias.`,
  morosos: (name: string, owed: number, clinic = "") => `${greet(name, clinic)} Tiene un saldo pendiente de ${clp(owed)} por tratamientos ya realizados. ¿Cuándo le acomoda regularizarlo? Gracias.`,
};

const linkOf = (phone: string, message: string) => { const number = whatsappNumber(phone); return number ? waLink(number, message) : null; };

/** Arma las cuatro listas. `inactiveMonths` define cuándo un paciente deja de ser «sin cita» y pasa a «inactivo». */
export function buildCallLists(rows: CallRows, options: { inactiveMonths?: number; clinicName?: string } = {}): CallLists {
  const months = options.inactiveMonths && options.inactiveMonths > 0 ? options.inactiveMonths : DEFAULT_INACTIVE_MONTHS;
  const clinic = options.clinicName?.trim() ?? "";
  const inactiveDays = Math.round(months * 30.44);
  const { today } = rows;

  const lastVisit = new Map<number, string>();
  for (const v of rows.visits) {
    const day = isoDay(v.day);
    if (!day || day > today) continue;
    if (!lastVisit.has(v.patientId) || day > lastVisit.get(v.patientId)!) lastVisit.set(v.patientId, day);
  }
  const contactOf = new Map<string, string>();
  for (const c of rows.contacts) { const key = `${c.patientId}|${c.list}`; if (!contactOf.has(key) || c.day > contactOf.get(key)!) contactOf.set(key, c.day); }
  const contacted = (patientId: number, list: CallList) => contactOf.get(`${patientId}|${list}`) ?? null;
  const entry = (p: CallPatient, list: CallList, detail: string, message: string, extra: Partial<CallEntry> = {}): CallEntry =>
    ({ patientId: p.id, name: p.name, phone: p.phone, detail, contactedOn: contacted(p.id, list), message, whatsapp: linkOf(p.phone, message), ...extra });

  const mains = rows.budgets.filter(b => !b.isAlternative);
  const inTreatment = new Set(mains.filter(b => budgetStatus(b, today, rows.validityDays) === "en-tratamiento").map(b => b.patientId));
  const out: CallLists = { sinCita: [], inactivos: [], presupuestos: [], morosos: [] };

  // Sin cita futura e inactivos: nadie con cita de hoy en adelante.
  const sinCita: Array<{ e: CallEntry; days: number }> = [];
  const inactivos: Array<{ e: CallEntry; days: number }> = [];
  for (const p of rows.patients) {
    if (rows.withFutureAppointment.has(p.id)) continue;
    const last = lastVisit.get(p.id);
    if (last) {
      const days = daysSince(last, today);
      if (days <= inactiveDays) sinCita.push({ days, e: entry(p, "sinCita", `Última visita ${agoLabel(days)}${inTreatment.has(p.id) ? " · tratamiento a medias" : ""}`, callMessage.sinCita(p.name, clinic), { inTreatment: inTreatment.has(p.id) }) });
      else inactivos.push({ days, e: entry(p, "inactivos", `Última visita ${agoLabel(days)}`, callMessage.inactivos(p.name, clinic)) });
    } else {
      const age = daysSince(p.createdAt.slice(0, 10), today);
      if (Number.isFinite(age) && age > inactiveDays) inactivos.push({ days: Number.MAX_SAFE_INTEGER, e: entry(p, "inactivos", `Sin visitas registradas · ficha creada ${agoLabel(age)}`, callMessage.inactivos(p.name, clinic)) });
    }
  }
  // Tratamiento a medias primero; luego los que llevan más tiempo sin volver. Inactivos: los más recientes primero (más fáciles de recuperar).
  out.sinCita = sinCita.sort((a, b) => Number(b.e.inTreatment) - Number(a.e.inTreatment) || b.days - a.days || a.e.name.localeCompare(b.e.name, "es")).map(x => x.e);
  out.inactivos = inactivos.sort((a, b) => a.days - b.days || a.e.name.localeCompare(b.e.name, "es")).map(x => x.e);

  // Presupuestos sin iniciar (dentro de la vigencia primero, los más nuevos arriba; vencidos al final).
  const patientById = new Map(rows.patients.map(p => [p.id, p]));
  const pend: Array<{ e: CallEntry; expired: boolean; createdOn: string }> = [];
  for (const b of mains) {
    const p = patientById.get(b.patientId);
    if (!p || rows.withFutureAppointment.has(p.id) || b.items.length === 0) continue;
    const status = budgetStatus(b, today, rows.validityDays);
    if (status !== "sin-iniciar" && status !== "expirado") continue;
    const age = daysSince(b.createdOn, today);
    const expired = status === "expirado";
    pend.push({ expired, createdOn: b.createdOn, e: entry(p, "presupuestos", `${clp(budgetTotal(b.items))} · entregado ${agoLabel(age)}${expired ? " · vencido" : ""}`, callMessage.presupuestos(p.name, b.createdOn, clinic), { budgetId: b.id, expired }) });
  }
  out.presupuestos = pend.sort((a, b) => Number(a.expired) - Number(b.expired) || b.createdOn.localeCompare(a.createdOn)).map(x => x.e);

  // Morosos: lo realizado y no pagado, por paciente.
  const paidBy = new Map<number, number>();
  const lastPaid = new Map<number, string>();
  const budgetPatient = new Map(mains.map(b => [b.id, b.patientId]));
  for (const pay of rows.payments) {
    if (pay.budgetId === null) continue;
    paidBy.set(pay.budgetId, (paidBy.get(pay.budgetId) ?? 0) + pay.amount);
    const owner = budgetPatient.get(pay.budgetId);
    const day = isoDay(pay.paidOn);
    if (owner !== undefined && day && (!lastPaid.has(owner) || day > lastPaid.get(owner)!)) lastPaid.set(owner, day);
  }
  const owedBy = new Map<number, number>();
  for (const b of mains) { const owed = budgetOwed(b.items, paidBy.get(b.id) ?? 0); if (owed > 0) owedBy.set(b.patientId, (owedBy.get(b.patientId) ?? 0) + owed); }
  out.morosos = [...owedBy].flatMap(([patientId, owed]) => {
    const p = patientById.get(patientId);
    if (!p) return [];
    const paid = lastPaid.get(patientId);
    return [entry(p, "morosos", `Debe ${clp(owed)} · ${paid ? `último pago ${agoLabel(daysSince(paid, today))}` : "sin pagos registrados"}`, callMessage.morosos(p.name, owed, clinic), { owed })];
  }).sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0) || a.name.localeCompare(b.name, "es"));
  return out;
}
