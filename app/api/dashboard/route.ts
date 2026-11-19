import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadAttendance } from "@/app/attendance-db";
import { getBudgetValidityDays } from "@/app/followup-db";
import { json } from "@/app/followup-http";
import { loadProfiles } from "@/app/patient-profile-db";
import { decodeBudgetData } from "@/lib/budget-plans";
import { buildDashboard, chileDayOf, chileMinuteOf, isoDay, monthRange } from "@/lib/dashboard";
import { PAYMENT_METHOD_LABEL } from "@/lib/dictation/spoken";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
type Db = { prepare(sql: string): Stmt };
/** Lectura tolerante: una tabla opcional que aún no existe en este espacio cuenta como vacía. */
const rowsOf = async <T,>(stmt: () => Stmt): Promise<T[]> => { try { return (await stmt().all<T>()).results; } catch { return []; } };
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Dashboard del mes (como Informes › Dashboard de Dentalsoft). Todo se filtra por el espacio (owner_id) de la sesión. */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const db = (env as unknown as { DB?: Db }).DB;
  if (!db) return json({ error: "La base de datos no está disponible." }, 503);
  const ownerId = user.userId;
  const params = new URL(request.url).searchParams;
  const today = chileDayOf(new Date().toISOString());
  const [ty, tm] = today.split("-").map(Number);
  const year = Number(params.get("anio")) || ty, month = Number(params.get("mes")) || tm;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return json({ error: "Mes o año inválido." }, 400);
  const range = monthRange(year, month);
  const fromUtc = shiftDay(range.from, -1), toUtc = shiftDay(range.to, 1);
  try {
    const [patients, calendar, appointments, evolutions, budgets, authors, payments, confirmations, declined, titular, profiles, attendance, validityDays] = await Promise.all([
      rowsOf<{ id: number; name: string; birth_date: string; created_at: string }>(() => db.prepare("SELECT id, name, birth_date, created_at FROM patients WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ id: number; start_at: string; all_day: number; status: string; patient_id: number | null; title: string }>(() => db.prepare("SELECT id, start_at, all_day, status, patient_id, title FROM calendar_events WHERE owner_id = ? AND start_at >= ? AND start_at < ?").bind(ownerId, fromUtc, toUtc)),
      rowsOf<{ id: number; patient_id: number; day: string; time: string; reason: string }>(() => db.prepare("SELECT id, patient_id, day, time, reason FROM appointments WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ patient_id: number; clinical_date: string }>(() => db.prepare("SELECT patient_id, clinical_date FROM evolutions WHERE owner_id = ? AND status = 'vigente' AND clinical_date >= ? AND clinical_date < ?").bind(ownerId, range.from, range.to)),
      rowsOf<{ id: number; patient_id: number; items: string; status: string; created_at: string }>(() => db.prepare("SELECT id, patient_id, items, status, created_at FROM budgets WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ budget_id: number; author_id: string; author_name: string }>(() => db.prepare("SELECT budget_id, author_id, author_name FROM budget_authors WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ budget_id: number | null; amount: number; method: string; paid_on: string }>(() => db.prepare("SELECT budget_id, amount, method, paid_on FROM payments WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ event_id: number }>(() => db.prepare("SELECT c.event_id AS event_id FROM appointment_confirmations c JOIN calendar_events e ON e.id = c.event_id AND e.owner_id = c.owner_id AND e.start_at = c.start_at WHERE c.owner_id = ?").bind(ownerId)),
      rowsOf<{ event_id: number }>(() => db.prepare("SELECT r.event_id AS event_id FROM appointment_reminders r JOIN calendar_events e ON e.id = r.event_id AND e.owner_id = r.owner_id AND e.start_at = r.start_at WHERE r.owner_id = ? AND r.response = 'declined'").bind(ownerId)),
      db.prepare("SELECT first_name, last_name, clinic_name FROM clinician_profiles WHERE owner_id = ?").bind(ownerId).first<{ first_name: string; last_name: string; clinic_name?: string }>().catch(() => null),
      loadProfiles(ownerId),
      loadAttendance(ownerId).catch(() => ({})),
      getBudgetValidityDays(ownerId).catch(() => 90),
    ]);
    const authorBy = new Map(authors.map(a => [a.budget_id, a]));
    const dashboard = buildDashboard({
      patients: patients.map(p => ({ id: p.id, name: p.name, birthDate: p.birth_date, createdAt: p.created_at })),
      calendar: calendar.map(e => ({ id: e.id, startDay: chileDayOf(e.start_at), startMinute: chileMinuteOf(e.start_at), allDay: !!e.all_day, status: e.status, patientId: e.patient_id, title: e.title })),
      appointments: appointments.map(a => ({ id: a.id, patientId: a.patient_id, day: isoDay(a.day), startMinute: isoDay(a.day) && /^\d{2}:\d{2}$/.test(a.time) ? `${isoDay(a.day)}T${a.time}` : null, reason: a.reason })),
      evolutions: evolutions.map(e => ({ patientId: e.patient_id, clinicalDate: e.clinical_date })),
      budgets: budgets.flatMap(b => { let data: ReturnType<typeof decodeBudgetData>; try { data = decodeBudgetData(b.items); } catch { return []; } return [{ id: b.id, patientId: b.patient_id, items: data.items, status: b.status, createdOn: chileDayOf(b.created_at), isAlternative: data.isAlternative, authorId: authorBy.get(b.id)?.author_id ?? "", authorName: authorBy.get(b.id)?.author_name ?? "" }]; }),
      payments: payments.map(p => ({ budgetId: p.budget_id, amount: p.amount, method: p.method, paidOn: isoDay(p.paid_on) })),
      profiles: new Map([...profiles.entries()].map(([id, p]) => [id, { insurance: p.insurance, agreement: p.agreement, branch: p.branch }])),
      confirmedEvents: new Set(confirmations.map(c => c.event_id)),
      declinedEvents: new Set(declined.map(d => d.event_id)),
      attendance,
    }, {
      year, month, today, validityDays, professional: params.get("profesional") ?? "",
      titularId: ownerId,
      titularName: [titular?.first_name, titular?.last_name].filter(Boolean).join(" ") || "Titular",
      clinicName: titular?.clinic_name || "",
      methodLabel: (method: string) => PAYMENT_METHOD_LABEL[method as keyof typeof PAYMENT_METHOD_LABEL] ?? (method ? method[0].toUpperCase() + method.slice(1) : "Otro"),
    });
    return json(dashboard);
  } catch {
    return json({ error: "No se pudo armar el dashboard." }, 500);
  }
}
