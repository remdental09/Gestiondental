import { env } from "cloudflare:workers";
import { personalIdOf, spaceRoleOf, type ChatGPTUser } from "@/app/chatgpt-auth";

/**
 * Auditoría por cuenta: quién (correo y rol) hizo cada cambio relevante (citas, pagos, presupuestos, pacientes, lista de espera).
 * Siempre dentro del owner_id del espacio; nunca rompe la acción si la tabla falla.
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };

export const ACCOUNT_EVENTS_DDL = "CREATE TABLE IF NOT EXISTS account_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, actor_role TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)";

/** Acciones de /api/clinical que se registran, con su nombre en la auditoría. */
export const CLINICAL_AUDIT: Record<string, string> = {
  addAppointment: "cita.crear", updateAppointment: "cita.editar", deleteAppointment: "cita.borrar", updateAppointmentReason: "cita.motivo",
  addPayment: "pago.crear", addBudget: "presupuesto.crear", updateBudget: "presupuesto.editar", setBudgetStatus: "presupuesto.estado",
  addBudgetItems: "presupuesto.items", selectBudgetAlternative: "presupuesto.alternativa", setBudgetItemStatus: "presupuesto.avance", setBudgetItemDone: "presupuesto.realizado",
  createPatient: "paciente.crear", updatePatient: "paciente.editar",
};

let ready = false;
const clip = (value: unknown, max: number) => (typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value)).slice(0, max);

export async function recordEvent(user: ChatGPTUser | null | undefined, kind: string, ref: unknown = "", detail: unknown = "", db: Db | undefined = (env as unknown as { DB?: Db }).DB): Promise<void> {
  if (!db || !user?.userId) return;
  try {
    if (!ready) { await db.prepare(ACCOUNT_EVENTS_DDL).run(); ready = true; }
    await db.prepare("INSERT INTO account_events (owner_id, actor_id, actor_email, actor_role, kind, ref, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(user.userId, personalIdOf(user), (user.email || "").slice(0, 200), spaceRoleOf(user), kind.slice(0, 60), clip(ref, 80), clip(detail, 300), new Date().toISOString()).run();
  } catch { /* la auditoría nunca bloquea el trabajo */ }
}

export type AccountEvent = { id: number; actor_email: string; actor_role: string; kind: string; ref: string; detail: string; at: string };

/** Últimos eventos de la cuenta (solo del owner_id pedido). */
export async function recentEvents(ownerId: string, limit = 100, db: Db | undefined = (env as unknown as { DB?: Db }).DB): Promise<AccountEvent[]> {
  if (!db) return [];
  await db.prepare(ACCOUNT_EVENTS_DDL).run().catch(() => undefined);
  const { results } = await db.prepare("SELECT id, actor_email, actor_role, kind, ref, detail, at FROM account_events WHERE owner_id = ? ORDER BY id DESC LIMIT ?").bind(ownerId, Math.min(500, Math.max(1, limit))).all<AccountEvent>();
  return results;
}
