/**
 * Agregaciones del Dashboard (como «Informes › Dashboard» de Dentalsoft): citas, pagos, presupuestos y acciones.
 * Lógica pura y testeable; la ruta /api/dashboard solo lee filas del espacio (owner_id) y llama a estas funciones.
 * Regla: nunca inventar. Lo que la app no registra se informa como «sin registro» / «Sin datos».
 */
import { budgetProgress, budgetTotals, type BudgetItem } from "./budget-plans.ts";
import { budgetStatus } from "./budget-status.ts";

export type Slice = { label: string; value: number; color: string; amount?: number };
export type Bar = { label: string; amount: number };

/** Estados de la cita (los de Dentalsoft más «inasistida»). Los 5 primeros son los de siempre; el resto se agregó con la agenda por box. */
export const ATTENDANCE_STATUSES = ["agendada", "confirmada", "atendida", "inasistida", "cancelada", "en_espera", "ingresada", "notificada_email", "confirmada_email", "notificada_whatsapp", "confirmada_whatsapp", "reagendada"] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
export const isAttendanceStatus = (value: unknown): value is AttendanceStatus => typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
/** «Reagendada» cuenta como cancelada (el cupo se liberó y la cita vive en otra fecha). Para las cifras del Dashboard cada estado cuenta como uno de los 5 básicos (p. ej. «Confirmada por WhatsApp» = confirmada, «Notificada por email» = agendada). */
export function baseAttendance(status: string | null | undefined): "agendada" | "confirmada" | "atendida" | "inasistida" | "cancelada" | null {
  switch (status) {
    case "confirmada": case "confirmada_email": case "confirmada_whatsapp": case "en_espera": case "ingresada": return "confirmada";
    case "atendida": return "atendida";
    case "inasistida": return "inasistida";
    case "cancelada": case "reagendada": return "cancelada";
    case "agendada": case "notificada_email": case "notificada_whatsapp": return "agendada";
    default: return null;
  }
}
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  agendada: "Agendada", confirmada: "Confirmada", atendida: "Atendida", inasistida: "Inasistida", cancelada: "Cancelada",
  en_espera: "Llegó · sala de espera", ingresada: "En box", notificada_email: "Notificada por email", confirmada_email: "Confirmada por email",
  notificada_whatsapp: "Notificada por WhatsApp", confirmada_whatsapp: "Confirmada por WhatsApp", reagendada: "Reagendada",
};

const pad = (n: number) => String(n).padStart(2, "0");
/** Mes calendario [desde, hasta) en AAAA-MM-DD. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { from: `${year}-${pad(month)}-01`, to: `${next.y}-${pad(next.m)}-01` };
}
export const inRange = (day: string, range: { from: string; to: string }) => !!day && day >= range.from && day < range.to;
/** «dd-mm-aaaa» o «aaaa-mm-dd» → «aaaa-mm-dd». */
export function isoDay(value: string): string {
  const v = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// ── Citas ────────────────────────────────────────────────────────────────────
export type DashAppointment = {
  day: string;                  // AAAA-MM-DD en Chile
  patientId: number | null;
  label: string;                // motivo (o título del evento); solo se usa para clasificar el tipo, nunca se muestra
  cancelledAtSource?: boolean;  // cancelada en Google Calendar
  confirmed?: boolean;          // confirmación registrada (correo o marca manual)
  declined?: boolean;           // el paciente avisó que no asistirá
  status?: AttendanceStatus | null; // estado marcado en la agenda
};
export type AppointmentStats = {
  scheduled: number; effective: number; cancelled: number; noShow: number; noRecord: number; upcoming: number;
  confirmed: number; unconfirmed: number; attendanceMarked: number; confirmationsRecorded: number;
};

/**
 * Una cita es efectiva si se marcó «Atendida» o si el paciente tiene una evolución ese mismo día;
 * inasistida solo si se marcó así. Las pasadas sin ninguna de las dos quedan «sin registro» (no se suponen inasistencias).
 * Agendadas = todas menos las canceladas (como Dentalsoft: efectivas + inasistidas + …).
 */
export function appointmentStats(list: DashAppointment[], evolutionDays: Set<string>, today: string): AppointmentStats {
  const s: AppointmentStats = { scheduled: 0, effective: 0, cancelled: 0, noShow: 0, noRecord: 0, upcoming: 0, confirmed: 0, unconfirmed: 0, attendanceMarked: 0, confirmationsRecorded: 0 };
  for (const a of list) {
    const base = baseAttendance(a.status);
    const status = base && base !== "agendada" ? base : null;
    if (status === "atendida" || status === "inasistida" || status === "cancelada") s.attendanceMarked++;
    if (a.confirmed || status === "confirmada") s.confirmationsRecorded++;
    const attendedByRecord = a.patientId !== null && evolutionDays.has(`${a.patientId}|${a.day}`);
    if (status === "cancelada" || (!status && (a.cancelledAtSource || a.declined) && !attendedByRecord)) { s.cancelled++; continue; }
    s.scheduled++;
    if (a.confirmed || status === "confirmada" || status === "atendida") s.confirmed++; else s.unconfirmed++;
    if (status === "atendida" || (status !== "inasistida" && attendedByRecord)) s.effective++;
    else if (status === "inasistida") s.noShow++;
    else if (a.day < today) s.noRecord++;
    else s.upcoming++;
  }
  return s;
}

const TYPE_RULES: Array<[string, RegExp]> = [
  ["Urgencia", /\b(urgencia|urgente|dolor)\b/],
  ["Control", /\b(control|seguimiento|revision|recontrol)\b/],
  ["Diagnóstico / evaluación", /\b(evaluacion|diagnostico|primera (consulta|vez)|ingreso|consulta)\b/],
  ["Ortodoncia", /\b(ortodoncia|brackets?|alineadores?|frenillos?)\b/],
  ["Endodoncia", /\b(endodoncia|conducto|tratamiento de conducto)\b/],
  ["Implantología", /\b(implantes?|injerto)\b/],
  ["Higiene / periodoncia", /\b(limpieza|destartraje|profilaxis|periodon\w*|pulido)\b/],
  ["Tratamiento", /\b(tratamiento|obturacion|resina|exodoncia|extraccion|corona|protesis|carillas?|blanqueamiento|cirugia)\b/],
];
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Tipo de atención según el motivo de la cita; si no se reconoce, «Sin especificar». */
export function appointmentType(label: string): string {
  const text = fold(label ?? "");
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type;
  return "Sin especificar";
}

// ── Edad ─────────────────────────────────────────────────────────────────────
export const AGE_GROUPS = ["Menor de 17", "17 a 40", "Mayor de 40", "Sin fecha de nacimiento"] as const;
export type AgeGroup = typeof AGE_GROUPS[number];
export function ageOn(birthDate: string, day: string): number | null {
  const b = isoDay(birthDate), d = isoDay(day);
  if (!b || !d) return null;
  const [by, bm, bd] = b.split("-").map(Number), [y, m, dd] = d.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && dd < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}
export function ageGroup(birthDate: string, day: string): AgeGroup {
  const age = ageOn(birthDate, day);
  if (age === null) return "Sin fecha de nacimiento";
  return age < 17 ? "Menor de 17" : age <= 40 ? "17 a 40" : "Mayor de 40";
}

// ── Presupuestos y saldos ────────────────────────────────────────────────────
export type DashBudget = { id: number; patientId: number; items: BudgetItem[]; status: string; createdOn: string; isAlternative: boolean; authorId: string };
/** Pendientes (sin iniciar o expirados), Iniciados (en tratamiento) y Terminados (terminado o alta). */
export function budgetBuckets(budgets: DashBudget[], today: string, validityDays: number) {
  const out = { pendientes: 0, iniciados: 0, terminados: 0 };
  for (const b of budgets) {
    if (b.isAlternative) continue;
    const s = budgetStatus(b, today, validityDays);
    if (s === "terminado" || s === "alta") out.terminados++;
    else if (s === "en-tratamiento") out.iniciados++;
    else out.pendientes++;
  }
  return out;
}
/** Saldo de cada plan = lo realizado que aún no se paga (no cuenta lo presupuestado y no iniciado). */
export function budgetOwed(items: BudgetItem[], paid: number): number { return budgetProgress(items, paid).owedForDone; }
export function sumBy<T>(rows: T[], key: (row: T) => string, amount: (row: T) => number): Bar[] {
  const map = new Map<string, number>();
  for (const row of rows) { const v = amount(row); if (v > 0) map.set(key(row), (map.get(key(row)) ?? 0) + v); }
  return [...map.entries()].map(([label, value]) => ({ label, amount: value })).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}
export const budgetTotal = (items: BudgetItem[]) => budgetTotals(items).total;

// ── Formato ──────────────────────────────────────────────────────────────────
/** «$ 8.638.425» (formato chileno). */
export const clp = (n: number) => "$ " + Math.round(n).toLocaleString("es-CL");
export const PALETTE = ["#0e9bc2", "#d1d5db", "#f2b705", "#c81e32", "#473a6d", "#10b981", "#f97316", "#6366f1", "#14b8a6", "#a3a3a3"];
export function toSlices(entries: Array<[string, number]>, colors: string[] = PALETTE, amounts?: Record<string, number>): Slice[] {
  return entries.map(([label, value], i) => ({ label, value, color: colors[i % colors.length], ...(amounts?.[label] !== undefined ? { amount: amounts[label] } : {}) }));
}

// ── Armado completo ──────────────────────────────────────────────────────────
export type DashboardRows = {
  patients: Array<{ id: number; name: string; birthDate: string; createdAt: string }>;
  calendar: Array<{ id: number; startDay: string; startMinute: string; allDay: boolean; status: string; patientId: number | null; title: string }>;
  appointments: Array<{ id: number; patientId: number; day: string; startMinute: string | null; reason: string }>;
  evolutions: Array<{ patientId: number; clinicalDate: string }>;
  budgets: Array<{ id: number; patientId: number; items: BudgetItem[]; status: string; createdOn: string; isAlternative: boolean; authorId: string; authorName: string }>;
  payments: Array<{ budgetId: number | null; amount: number; method: string; paidOn: string }>;
  profiles: Map<number, { insurance: string; agreement: string; branch: string }>;
  confirmedEvents: Set<number>;
  declinedEvents: Set<number>;
  attendance: Record<string, AttendanceStatus>;
};
export type DashboardOptions = { year: number; month: number; today: string; validityDays: number; professional: string; titularId: string; titularName: string; clinicName: string; methodLabel: (method: string) => string };

export function buildDashboard(rows: DashboardRows, o: DashboardOptions) {
  const range = monthRange(o.year, o.month);
  const name = new Map(rows.patients.map(p => [p.id, p]));
  // Profesionales: autores de presupuestos (los antiguos, sin autor registrado, son del titular).
  const authorOf = (b: { authorId: string }) => b.authorId || o.titularId;
  const professionals = new Map<string, string>([[o.titularId, o.titularName || "Titular"]]);
  for (const b of rows.budgets) if (b.authorId && !professionals.has(b.authorId)) professionals.set(b.authorId, b.authorName || "Profesional");
  const filterPro = o.professional && professionals.has(o.professional) ? o.professional : "";
  const budgets = rows.budgets.filter(b => !filterPro || authorOf(b) === filterPro);
  const budgetIds = new Set(budgets.map(b => b.id));
  const payments = rows.payments.filter(p => !filterPro || (p.budgetId !== null && budgetIds.has(p.budgetId)));

  // Citas del mes: eventos de Google Calendar + citas de la ficha que no estén ya en Calendar.
  const taken = new Set<string>();
  const list: DashAppointment[] = [];
  for (const e of rows.calendar) {
    if (e.allDay || !inRange(e.startDay, range)) continue;
    if (e.patientId !== null) taken.add(`${e.patientId}|${e.startMinute}`);
    taken.add(`${e.title}|${e.startMinute}`);
    list.push({ day: e.startDay, patientId: e.patientId, label: e.title, cancelledAtSource: e.status === "cancelled", confirmed: rows.confirmedEvents.has(e.id), declined: rows.declinedEvents.has(e.id), status: rows.attendance[`cal:${e.id}`] ?? null });
  }
  for (const a of rows.appointments) {
    const day = isoDay(a.day);
    if (!inRange(day, range)) continue;
    const patientName = name.get(a.patientId)?.name ?? "";
    if (a.startMinute && (taken.has(`${a.patientId}|${a.startMinute}`) || [...taken].some(key => patientName && key.startsWith(patientName) && key.endsWith(`|${a.startMinute}`)))) continue;
    list.push({ day, patientId: a.patientId, label: a.reason, status: rows.attendance[`app:${a.id}`] ?? null });
  }
  const evolutionDays = new Set(rows.evolutions.map(e => `${e.patientId}|${isoDay(e.clinicalDate)}`));
  const stats = appointmentStats(list, evolutionDays, o.today);
  const typeCounts = new Map<string, number>();
  for (const a of list) if (!(a.status === "cancelada" || (!a.status && (a.cancelledAtSource || a.declined)))) typeCounts.set(appointmentType(a.label), (typeCounts.get(appointmentType(a.label)) ?? 0) + 1);

  // Pagos del mes por medio.
  const monthPayments = payments.filter(p => inRange(p.paidOn, range));
  const byMethod = new Map<string, number>();
  for (const p of monthPayments) byMethod.set(o.methodLabel(p.method), (byMethod.get(o.methodLabel(p.method)) ?? 0) + p.amount);
  const methodEntries = [...byMethod.entries()].sort((a, b) => (a[0] === "Efectivo" ? -1 : b[0] === "Efectivo" ? 1 : b[1] - a[1]));

  // Presupuestos creados en el mes y su estado.
  const monthBudgets = budgets.filter(b => !b.isAlternative && inRange(b.createdOn, range));
  const buckets = budgetBuckets(monthBudgets, o.today, o.validityDays);

  // Saldos (a la fecha): realizado sin pagar por plan principal.
  const paidBy = new Map<number, number>();
  for (const p of rows.payments) if (p.budgetId !== null) paidBy.set(p.budgetId, (paidBy.get(p.budgetId) ?? 0) + p.amount);
  const owed = budgets.filter(b => !b.isAlternative).map(b => ({ b, owed: budgetOwed(b.items, paidBy.get(b.id) ?? 0) }));
  const byProfessional = sumBy(owed, row => professionals.get(authorOf(row.b)) ?? "Profesional", row => row.owed);
  const anyInsurance = [...rows.profiles.values()].some(p => p.insurance || p.agreement);
  const byInsurance = anyInsurance ? sumBy(owed, row => { const p = rows.profiles.get(row.b.patientId); return p?.agreement || p?.insurance || "Sin previsión registrada"; }, row => row.owed) : null;

  // Acciones: prestaciones marcadas realizadas en el mes.
  const actions = budgets.filter(b => !b.isAlternative).flatMap(b => b.items.filter(item => item.doneOn && inRange(isoDay(item.doneOn), range)).map(item => ({ patientId: b.patientId, day: isoDay(item.doneOn!) })));
  const ages = new Map<string, number>(AGE_GROUPS.map(g => [g, 0]));
  const branches = new Map<string, number>();
  for (const a of actions) {
    const g = ageGroup(name.get(a.patientId)?.birthDate ?? "", a.day);
    ages.set(g, (ages.get(g) ?? 0) + 1);
    const branch = rows.profiles.get(a.patientId)?.branch || o.clinicName || "Clínica";
    branches.set(branch, (branches.get(branch) ?? 0) + 1);
  }

  const patientsCreated = rows.patients.filter(p => inRange(isoDay(p.createdAt.length > 10 ? chileDayOf(p.createdAt) : p.createdAt), range)).length;
  return {
    period: { year: o.year, month: o.month, from: range.from, to: range.to },
    professionals: [...professionals.entries()].map(([id, label]) => ({ id, name: label })),
    professional: filterPro,
    citas: {
      total: list.length,
      effectiveness: toSlices([["Asistidas", stats.effective], ["No asistidas", stats.noShow], ["Sin registro", stats.noRecord]], ["#0e9bc2", "#c81e32", "#d1d5db"]).filter(s => s.value > 0),
      confirmation: toSlices([["Confirmada", stats.confirmed], ["No confirmada", stats.unconfirmed]], ["#0e9bc2", "#d1d5db"]).filter(s => s.value > 0),
      types: toSlices([...typeCounts.entries()].sort((a, b) => b[1] - a[1])),
      stats,
    },
    kpis: {
      patientsCreated,
      scheduled: stats.scheduled,
      effective: stats.effective,
      cancelled: stats.cancelled,
      // Sin ninguna marca de asistencia en el mes no se puede saber cuántos faltaron.
      noShow: stats.attendanceMarked > 0 ? stats.noShow : null,
    },
    pagos: {
      budgetsCreated: monthBudgets.length,
      incomeTotal: monthPayments.reduce((sum, p) => sum + p.amount, 0),
      income: toSlices(methodEntries.map(([label, amount]) => [label, amount] as [string, number]), ["#0e9bc2", "#d1d5db", "#f2b705", "#473a6d", "#10b981"]),
      budgets: toSlices([["Pendientes", buckets.pendientes], ["Iniciados", buckets.iniciados], ["Terminados", buckets.terminados]], ["#0e9bc2", "#d1d5db", "#f2b705"]).filter(s => s.value > 0),
      balancesByProfessional: byProfessional,
      balancesByInsurance: byInsurance,
    },
    acciones: {
      total: actions.length,
      byAge: toSlices([...ages.entries()].filter(([, v]) => v > 0), ["#0e9bc2", "#f2b705", "#473a6d", "#d1d5db"]),
      byBranch: toSlices([...branches.entries()].sort((a, b) => b[1] - a[1])),
    },
  };
}
export type Dashboard = ReturnType<typeof buildDashboard>;

/** Día en Chile de un instante ISO. */
export function chileDayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
/** Minuto en Chile «AAAA-MM-DDTHH:MM» de un instante ISO (para cruzar citas de la ficha con eventos de Calendar). */
export function chileMinuteOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
