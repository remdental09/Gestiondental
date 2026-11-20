"use client";
/**
 * Presupuestos como ramas dentro de la evolución: se ve todo lo presupuestado y lo que se va haciendo «en pleno acto
 * evolutivo». Cada presupuesto se expande en ramas por pieza / sextante / boca; tocar un ítem da Iniciar/Terminar/Cobrar.
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { budgetTree, STATUS_DOT, type TreeBudget } from "@/lib/budget-tree";
import { ITEM_STATUS_LABEL, type BudgetItem, type ItemStatus } from "@/lib/budget-plans";
import { cartola, type AllocPayment } from "@/lib/payment-allocation";

const clp = (value: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);

type Props = {
  budgets: { id: number; title: string; items: BudgetItem[]; editable?: boolean }[];
  /** Abonos por presupuesto (con sus ítems asignados). */
  paymentsByBudget: Record<number, AllocPayment[]>;
  onSetStatus: (budgetId: number, index: number, status: ItemStatus) => Promise<void>;
  onCharge: (budgetId: number, index?: number) => void;
  /** Abre todas las ramas (p. ej. al tocar «Marcar realizado» en el riel). */
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
};

export function BudgetTree({ budgets, paymentsByBudget, onSetStatus, onCharge, expanded, onExpandedChange }: Props) {
  const [openSelf, setOpenSelf] = useState(false);
  const open = expanded ?? openSelf;
  const setOpen = (value: boolean) => { if (onExpandedChange) onExpandedChange(value); else setOpenSelf(value); };
  const [openBudgets, setOpenBudgets] = useState<Set<number>>(new Set());
  const [itemOpen, setItemOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!budgets.length) return null;
  const trees = budgets.map(b => budgetTree(b, (paymentsByBudget[b.id] ?? []).reduce((sum, p) => sum + p.amount, 0)));
  const money = Object.fromEntries(budgets.map(b => [b.id, cartola(b.items, paymentsByBudget[b.id] ?? [])]));
  const owed = trees.reduce((sum, t) => sum + t.owedForDone, 0);
  const saldo = trees.reduce((sum, t) => sum + t.saldo, 0);
  const act = async (tree: TreeBudget, index: number, status: ItemStatus) => {
    const key = `${tree.id}:${index}`;
    setBusy(key); setError("");
    try { await onSetStatus(tree.id, index, status); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); } finally { setBusy(null); }
  };
  const single = trees.length === 1;
  return <section className="mt-3 rounded-xl border border-[#dddbe6] bg-[#fbfaff]" data-testid="budget-tree">
    <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRight className={`size-4 shrink-0 text-[#473a6d] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      <span className="text-sm font-semibold text-[#2c2640]">Presupuestos ({trees.length})</span>
      <span className="ml-auto flex flex-wrap justify-end gap-x-3 text-xs text-[#615f73]">
        {owed > 0 && <span className="font-semibold text-rose-700" data-testid="tree-owed">Realizado no pagado {clp(owed)}</span>}
        <span>Saldo {clp(saldo)}</span>
      </span>
    </button>
    {open && <div className="space-y-2 border-t border-[#ebe9f2] px-2 py-2">
      {trees.map(tree => {
        const budgetOpen = single || openBudgets.has(tree.id);
        return <div key={tree.id} className="rounded-lg border border-[#e6e4ee] bg-white" data-testid={`tree-budget-${tree.id}`}>
          <button type="button" className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left" aria-expanded={budgetOpen} onClick={() => setOpenBudgets(current => { const next = new Set(current); if (next.has(tree.id)) next.delete(tree.id); else next.add(tree.id); return next; })}>
            {!single && <ChevronRight className={`size-4 shrink-0 text-[#473a6d] transition-transform ${budgetOpen ? "rotate-90" : ""}`} aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tree.title}</span>
            <span className="text-xs text-[#615f73]">{tree.doneCount}/{tree.count}{tree.started ? ` · ${tree.started} en curso` : ""}</span>
            <span className="w-full text-[11px] text-[#615f73]" data-testid={`tree-cartola-${tree.id}`}>Total {clp(tree.total)} · Abonado {clp(tree.paid)} · Realizado {clp(tree.doneValue)} · Saldo {money[tree.id].saldo < 0 ? <strong className="rounded bg-rose-50 px-1 text-rose-700">−{clp(-money[tree.id].saldo)} por cobrar</strong> : clp(money[tree.id].saldo)}</span>
          </button>
          {budgetOpen && <ul className="border-t border-[#f0eef5] px-2 pb-2">
            {tree.branches.map(branch => <li key={branch.key} className="mt-2">
              <p className="flex items-center gap-2 px-1 text-xs font-semibold text-[#473a6d]">
                <span>{branch.label}</span>
                <span className="font-normal text-[#615f73]">{branch.done}/{branch.total}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded bg-[#efedf4]"><span className="block h-full bg-emerald-500" style={{ width: `${Math.round(branch.done / branch.total * 100)}%` }} /></span>
              </p>
              <ul className="ml-2 border-l border-[#e6e4ee] pl-2">
                {branch.items.map(({ item, index, status, value }) => {
                  const key = `${tree.id}:${index}`;
                  const opened = itemOpen === key;
                  return <li key={key} data-testid={`tree-item-${key}`} data-status={status}>
                    <button type="button" className="flex min-h-10 w-full items-center gap-2 text-left text-sm" aria-expanded={opened} onClick={() => setItemOpen(opened ? null : key)}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_DOT[status] }} aria-hidden="true" />
                      <span className={`min-w-0 flex-1 truncate ${status === "terminada" ? "text-[#615f73] line-through decoration-emerald-600/60" : ""}`}>{item.label}</span>
                      <span className="shrink-0 text-right text-[11px] leading-tight text-[#615f73]">{ITEM_STATUS_LABEL[status]} · {clp(value)}{(money[tree.id].items[index]?.paid ?? 0) > 0 && <span className="block text-emerald-800">pagado {clp(money[tree.id].items[index].paid)}</span>}{status === "terminada" && (money[tree.id].items[index]?.saldo ?? 0) > 0 && <span className="block font-semibold text-rose-700">por cobrar {clp(money[tree.id].items[index].saldo)}</span>}</span>
                    </button>
                    {opened && <div className="mb-2 flex flex-wrap gap-1.5 pl-4">
                      {status !== "iniciada" && status !== "terminada" && <button type="button" disabled={busy === key} className="h-9 rounded-md border border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-900" onClick={() => void act(tree, index, "iniciada")}>Iniciar</button>}
                      {status !== "terminada" && <button type="button" disabled={busy === key} className="h-9 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900" onClick={() => void act(tree, index, "terminada")}>Terminar</button>}
                      {status !== "pendiente" && <button type="button" disabled={busy === key} className="h-9 rounded-md border px-3 text-xs" onClick={() => void act(tree, index, "pendiente")}>Volver a pendiente</button>}
                      <button type="button" className="h-9 rounded-md border border-[#cfcbe0] px-3 text-xs font-semibold text-[#473a6d]" onClick={() => onCharge(tree.id, index)}>Cobrar</button>
                    </div>}
                  </li>;
                })}
              </ul>
            </li>)}
          </ul>}
        </div>;
      })}
      {error && <p role="alert" className="px-1 text-xs text-rose-800">{error}</p>}
    </div>}
  </section>;
}
