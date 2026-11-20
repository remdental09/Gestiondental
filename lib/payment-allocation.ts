/**
 * Abonos por ítem (Dentalsoft): cada ítem del presupuesto tiene su pagado y su saldo.
 * - Un abono puede aplicarse a ítems marcados (se guardan las asignaciones explícitas);
 * - o ser «abono libre» (sin asignaciones): se aplica solo, primero a lo ya realizado más antiguo, luego a lo iniciado
 *   y al final a lo pendiente. Los abonos antiguos (sin asignaciones) se tratan como libres: nada se migra.
 * La cartola del presupuesto: total, abonado, tratamientos realizados y saldo (abonado − realizado; negativo = por cobrar).
 * Puro para poder probarlo.
 */
import { budgetItemTotal, budgetTotals, itemStatus, type BudgetItem } from "./budget-plans.ts";

export type Allocation = { index: number; label: string; amount: number };
export type AllocPayment = { id: number; amount: number; paidOn?: string; allocations?: Allocation[] };
export type ItemMoney = { index: number; value: number; paid: number; saldo: number };
export type Cartola = { total: number; abonado: number; realizado: number; saldo: number; pendiente: number; anticipo: number; items: ItemMoney[] };

export const PAYMENT_ALLOCATIONS_DDL = "CREATE TABLE IF NOT EXISTS payment_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, payment_id INTEGER NOT NULL, budget_id INTEGER NOT NULL, item_index INTEGER NOT NULL, item_label TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL)";
export const PAYMENT_ALLOCATIONS_INDEX = "CREATE INDEX IF NOT EXISTS payment_allocations_owner_payment ON payment_allocations (owner_id, payment_id)";

/** Ítem al que apunta una asignación: por índice si el nombre sigue igual; si el plan se reordenó, por nombre. */
function resolveIndex(items: BudgetItem[], allocation: Allocation): number {
  if (items[allocation.index]?.label === allocation.label) return allocation.index;
  const byLabel = items.findIndex(item => item.label === allocation.label);
  return byLabel;
}

/** Orden del abono libre: realizado más antiguo → iniciado más antiguo → pendiente en el orden del plan. */
export function freeOrder(items: BudgetItem[]): number[] {
  const rank = (item: BudgetItem) => { const s = itemStatus(item); return s === "terminada" ? 0 : s === "iniciada" ? 1 : s === "pendiente" ? 2 : 3; };
  const date = (item: BudgetItem) => item.doneOn || item.startedOn || "9999";
  return items.map((_, index) => index).sort((a, b) => rank(items[a]) - rank(items[b]) || date(items[a]).localeCompare(date(items[b])) || a - b);
}

export function cartola(items: BudgetItem[], payments: AllocPayment[]): Cartola {
  const value = items.map(budgetItemTotal);
  const paid = items.map(() => 0);
  let pool = 0;
  const ordered = [...payments].sort((a, b) => (a.paidOn ?? "").localeCompare(b.paidOn ?? "") || a.id - b.id);
  for (const payment of ordered) {
    let left = payment.amount;
    for (const allocation of payment.allocations ?? []) {
      const index = resolveIndex(items, allocation);
      if (index < 0) continue;
      const take = Math.max(0, Math.min(allocation.amount, left, value[index] - paid[index]));
      paid[index] += take;
      left -= take;
    }
    pool += left;
  }
  for (const index of freeOrder(items)) {
    if (pool <= 0) break;
    const take = Math.min(pool, value[index] - paid[index]);
    if (take > 0) { paid[index] += take; pool -= take; }
  }
  const abonado = payments.reduce((sum, p) => sum + p.amount, 0);
  const realizado = items.reduce((sum, item, index) => sum + (itemStatus(item) === "terminada" ? value[index] : 0), 0);
  const total = budgetTotals(items).total;
  return {
    total, abonado, realizado, saldo: abonado - realizado, pendiente: Math.max(0, total - abonado), anticipo: pool,
    items: items.map((_, index) => ({ index, value: value[index], paid: paid[index], saldo: value[index] - paid[index] })),
  };
}

/**
 * Reparte un abono entre los ítems marcados, hasta el saldo de cada uno y en el orden marcado. Lo que sobra queda libre
 * (no se asigna). `current` es la cartola antes del abono.
 */
export function splitAcross(amount: number, selected: number[], items: BudgetItem[], current: Cartola): Allocation[] {
  let left = amount;
  const out: Allocation[] = [];
  for (const index of selected) {
    const item = items[index];
    const saldo = current.items[index]?.saldo ?? 0;
    if (!item || saldo <= 0 || left <= 0) continue;
    const take = Math.min(left, saldo);
    out.push({ index, label: item.label, amount: take });
    left -= take;
  }
  return out;
}

/** Valida asignaciones recibidas: índices existentes, montos enteros positivos, suma ≤ abono. */
export function sanitizeAllocations(value: unknown, items: BudgetItem[], amount: number): Allocation[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) return null;
  const out: Allocation[] = [];
  let sum = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const index = Number(r.index), share = Number(r.amount);
    if (!Number.isInteger(index) || index < 0 || index >= items.length || !Number.isSafeInteger(share) || share < 1) return null;
    if (share > budgetItemTotal(items[index])) return null;
    sum += share;
    out.push({ index, label: items[index].label, amount: share });
  }
  return sum <= amount ? out : null;
}
