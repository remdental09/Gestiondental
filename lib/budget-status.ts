/**
 * Estado de un presupuesto en la vista de tarjetas (como «Plan de tratamiento» de Dentalsoft, adaptado):
 * se calcula solo a partir de las prestaciones realizadas; «Alta» es la única marca manual.
 */
import { budgetTotals, type BudgetItem } from "./budget-plans.ts";

export type BudgetStatusKey = "sin-iniciar" | "en-tratamiento" | "terminado" | "alta" | "expirado";
export const BUDGET_STATUSES: Array<{ key: BudgetStatusKey; label: string }> = [
  { key: "sin-iniciar", label: "Sin iniciar" },
  { key: "en-tratamiento", label: "En tratamiento" },
  { key: "terminado", label: "Terminado" },
  { key: "alta", label: "Alta" },
  { key: "expirado", label: "Expirado" },
];
export const DEFAULT_BUDGET_VALIDITY_DAYS = 90;
/** Valor guardado en la columna `budgets.status` cuando el profesional da el alta a mano. */
export const BUDGET_ALTA = "Alta";

const dayNumber = (iso: string) => { const t = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`); return Number.isNaN(t) ? NaN : Math.floor(t / 86_400_000); };

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number { return dayNumber(b) - dayNumber(a); }

/**
 * - Alta: marcada a mano (prevalece).
 * - Terminado: todas las prestaciones realizadas.
 * - En tratamiento: alguna realizada.
 * - Expirado: ninguna realizada y la fecha supera la vigencia (por defecto 90 días).
 * - Sin iniciar: ninguna realizada, dentro de la vigencia.
 */
export function budgetStatus(budget: { items: BudgetItem[]; status?: string; createdOn?: string }, today: string, validityDays = DEFAULT_BUDGET_VALIDITY_DAYS): BudgetStatusKey {
  if ((budget.status ?? "").trim().toLowerCase() === BUDGET_ALTA.toLowerCase()) return "alta";
  const total = budget.items.length, done = budget.items.filter(item => item.doneOn).length;
  if (total > 0 && done === total) return "terminado";
  if (done > 0) return "en-tratamiento";
  const age = budget.createdOn ? daysBetween(budget.createdOn, today) : NaN;
  if (Number.isFinite(age) && validityDays > 0 && age > validityDays) return "expirado";
  return "sin-iniciar";
}

export const budgetStatusLabel = (key: BudgetStatusKey) => BUDGET_STATUSES.find(status => status.key === key)?.label ?? key;

/** Resumen de la tarjeta: realizadas X/Y, total, abonado y saldo. */
export function budgetCardSummary(items: BudgetItem[], paid: number) {
  const total = budgetTotals(items).total;
  return { done: items.filter(item => item.doneOn).length, count: items.length, total, paid, balance: Math.max(0, total - paid), percent: items.length ? Math.round(items.filter(item => item.doneOn).length / items.length * 100) : 0 };
}

export const normalizeValidityDays = (value: unknown) => { const n = Number(value); return Number.isInteger(n) && n >= 7 && n <= 730 ? n : DEFAULT_BUDGET_VALIDITY_DAYS; };
