import { env } from "cloudflare:workers";
import { getChatGPTUser, spaceRoleOf } from "@/app/chatgpt-auth";
import { loadAttendance } from "@/app/attendance-db";
import { getBudgetValidityDays } from "@/app/followup-db";
import { json, ownedPatient, sameOrigin } from "@/app/followup-http";
import { loadContacts, setContacted } from "@/app/call-lists-db";
import { decodeBudgetData } from "@/lib/budget-plans";
import { buildCallLists, CALL_LISTS, DEFAULT_INACTIVE_MONTHS, INACTIVE_MONTHS, isCallList, type CallRows } from "@/lib/call-lists";
import { chileDayOf, isoDay } from "@/lib/dashboard";
import { ROLE_DENIED } from "@/lib/role-policy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
type Db = { prepare(sql: string): Stmt };
/** Lectura tolerante: una tabla opcional que aún no existe en este espacio cuenta como vacía. */
const rowsOf = async <T,>(stmt: () => Stmt): Promise<T[]> => { try { return (await stmt().all<T>()).results; } catch { return []; } };
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Estados que no cuentan como visita ni como cita vigente. */
const GONE = new Set(["cancelada", "reagendada"]);

/**
 * GET ?meses=12 → las listas de «a quién llamar» del espacio: sin cita futura, inactivos, presupuestos sin iniciar y morosos.
 * Solo dueño, administrador, dentista y recepción: la asistente no cobra ni ve montos (el Worker y esta ruta lo rechazan).
 */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (spaceRoleOf(user) === "asistente") return json({ error: ROLE_DENIED }, 403);
  const db = (env as unknown as { DB?: Db }).DB;
  if (!db) return json({ error: "La base de datos no está disponible." }, 503);
  const ownerId = user.userId;
  const requested = Number(new URL(request.url).searchParams.get("meses"));
  const months = (INACTIVE_MONTHS as readonly number[]).includes(requested) ? requested : DEFAULT_INACTIVE_MONTHS;
  const today = chileDayOf(new Date().toISOString());
  try {
    const [patients, evolutions, appointments, calendar, budgets, payments, attendance, validityDays, profile, contacts] = await Promise.all([
      rowsOf<{ id: number; name: string; phone: string; created_at: string }>(() => db.prepare("SELECT id, name, phone, created_at FROM patients WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ patient_id: number; clinical_date: string }>(() => db.prepare("SELECT patient_id, clinical_date FROM evolutions WHERE owner_id = ? AND status = 'vigente'").bind(ownerId)),
      rowsOf<{ id: number; patient_id: number; day: string }>(() => db.prepare("SELECT id, patient_id, day FROM appointments WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ id: number; patient_id: number | null; start_at: string; all_day: number; status: string }>(() => db.prepare("SELECT id, patient_id, start_at, all_day, status FROM calendar_events WHERE owner_id = ? AND (patient_id IS NOT NULL OR start_at >= ?)").bind(ownerId, shiftDay(today, -1))),
      rowsOf<{ id: number; patient_id: number; items: string; status: string; created_at: string }>(() => db.prepare("SELECT id, patient_id, items, status, created_at FROM budgets WHERE owner_id = ?").bind(ownerId)),
      rowsOf<{ budget_id: number | null; amount: number; paid_on: string }>(() => db.prepare("SELECT budget_id, amount, paid_on FROM payments WHERE owner_id = ?").bind(ownerId)),
      loadAttendance(ownerId).catch(() => ({} as Record<string, string>)),
      getBudgetValidityDays(ownerId).catch(() => 90),
      db.prepare("SELECT clinic_name FROM clinician_profiles WHERE owner_id = ?").bind(ownerId).first<{ clinic_name?: string }>().catch(() => null),
      loadContacts(ownerId, shiftDay(today, -60)),
    ]);

    const visits: CallRows["visits"] = evolutions.map(e => ({ patientId: e.patient_id, day: isoDay(e.clinical_date) }));
    const future = new Set<number>();
    let unassigned = 0;
    for (const a of appointments) {
      const day = isoDay(a.day), status = attendance[`app:${a.id}`];
      if (day >= today && !GONE.has(status ?? "")) future.add(a.patient_id);
      if (status === "atendida") visits.push({ patientId: a.patient_id, day });
    }
    for (const e of calendar) {
      if (e.all_day) continue;
      const day = chileDayOf(e.start_at), status = attendance[`cal:${e.id}`];
      if (day >= today && e.status !== "cancelled" && !GONE.has(status ?? "")) { if (e.patient_id !== null) future.add(e.patient_id); else unassigned++; }
      if (e.patient_id !== null && status === "atendida") visits.push({ patientId: e.patient_id, day });
    }
    const decoded = budgets.flatMap(b => { try { const data = decodeBudgetData(b.items); return [{ id: b.id, patientId: b.patient_id, items: data.items, status: b.status, createdOn: chileDayOf(b.created_at), isAlternative: data.isAlternative }]; } catch { return []; } });
    for (const b of decoded) for (const item of b.items) if (item.doneOn && !b.isAlternative) visits.push({ patientId: b.patientId, day: isoDay(item.doneOn) });

    const lists = buildCallLists({
      today, validityDays,
      patients: patients.map(p => ({ id: p.id, name: p.name, phone: p.phone, createdAt: p.created_at })),
      visits, withFutureAppointment: future, budgets: decoded,
      payments: payments.map(p => ({ budgetId: p.budget_id, amount: p.amount, paidOn: isoDay(p.paid_on) })),
      contacts: contacts.filter(c => isCallList(c.list)).map(c => ({ patientId: c.patientId, list: c.list as (typeof CALL_LISTS)[number], day: chileDayOf(c.contactedAt) })),
    }, { inactiveMonths: months, clinicName: profile?.clinic_name ?? "" });
    return json({ today, months, lists, unassignedFutureEvents: unassigned });
  } catch {
    return json({ error: "No se pudieron armar las listas." }, 500);
  }
}

/** POST {patientId, list, contacted: boolean} → marca (o desmarca) a la persona como contactada en esa lista. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (spaceRoleOf(user) === "asistente") return json({ error: ROLE_DENIED }, 403);
  const body = await request.json().catch(() => null) as { patientId?: unknown; list?: unknown; contacted?: unknown } | null;
  if (!body || !isCallList(body.list) || typeof body.contacted !== "boolean") return json({ error: "Solicitud inválida." }, 400);
  const patientId = await ownedPatient(user.userId, body.patientId);
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  try { await setContacted(user.userId, patientId, body.list, body.contacted, user.email ?? ""); return json({ ok: true }); }
  catch { return json({ error: "No se pudo guardar el contacto." }, 500); }
}
