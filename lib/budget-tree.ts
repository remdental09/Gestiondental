/**
 * Árbol de presupuestos dentro de la evolución (Dentalsoft): presupuesto → ramas por zona («Pieza 2.7», «Sextante 1»,
 * «Boca») → ítems con su estado. Puro para poder probarlo.
 */
import { budgetItemTotal, budgetProgress, budgetTotals, itemStatus, itemTeeth, type BudgetItem, type ItemStatus } from "./budget-plans.ts";
import { parseZone } from "./treatment-zones.ts";

export type TreeItem = { item: BudgetItem; index: number; status: ItemStatus; value: number };
export type TreeBranch = { key: string; label: string; items: TreeItem[]; done: number; total: number };
export type TreeBudget = {
  id: number; title: string; branches: TreeBranch[];
  total: number; paid: number; doneValue: number; saldo: number; owedForDone: number; doneCount: number; count: number; started: number;
};

const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;

export function branchOf(item: BudgetItem): { key: string; label: string } {
  const zone = parseZone(item.zone);
  if (zone && zone.option.key !== "parcial") {
    const short = zone.option.label.split(" · ")[0];
    return { key: `z:${zone.option.key}`, label: short };
  }
  const teeth = itemTeeth(item);
  if (teeth.length === 1) return { key: `t:${teeth[0]}`, label: `Pieza ${fdi(teeth[0])}` };
  if (teeth.length > 1) return { key: `t:${teeth.join(",")}`, label: `Piezas ${teeth.map(fdi).join(", ")}` };
  return { key: "boca", label: "Boca / sesión" };
}

const ORDER = (key: string) => key.startsWith("t:") ? Number(key.slice(2).split(",")[0]) : key.startsWith("z:sext") ? 100 + Number(key.slice(-1)) : key.startsWith("z:") ? 200 : 300;

export function budgetTree(budget: { id: number; title: string; items: BudgetItem[] }, paid: number): TreeBudget {
  const map = new Map<string, TreeBranch>();
  budget.items.forEach((item, index) => {
    const { key, label } = branchOf(item);
    const branch = map.get(key) ?? { key, label, items: [], done: 0, total: 0 };
    const status = itemStatus(item);
    branch.items.push({ item, index, status, value: budgetItemTotal(item) });
    branch.total += 1;
    if (status === "terminada") branch.done += 1;
    map.set(key, branch);
  });
  const progress = budgetProgress(budget.items, paid);
  const total = budgetTotals(budget.items).total;
  return {
    id: budget.id, title: budget.title,
    branches: [...map.values()].sort((a, b) => ORDER(a.key) - ORDER(b.key)),
    total, paid, doneValue: progress.doneValue, saldo: total - paid, owedForDone: progress.owedForDone,
    doneCount: progress.doneCount, count: budget.items.length, started: budget.items.filter(i => itemStatus(i) === "iniciada").length,
  };
}

export const STATUS_DOT: Record<ItemStatus, string> = { pendiente: "#b8b4c8", iniciada: "#0284c7", terminada: "#059669", desevolucion: "#e11d48" };
