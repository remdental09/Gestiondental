"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BudgetPlan } from "@/components/budget-plan";
import { BUDGET_STATUSES, budgetCardSummary, budgetStatus, budgetStatusLabel, type BudgetStatusKey } from "@/lib/budget-status";

const money = (value: number) => "$" + Math.round(value).toLocaleString("es-CL");
const CHIP: Record<BudgetStatusKey, string> = {
  "sin-iniciar": "bg-slate-100 text-slate-700 border-slate-200",
  "en-tratamiento": "bg-sky-50 text-sky-800 border-sky-200",
  terminado: "bg-emerald-50 text-emerald-800 border-emerald-200",
  alta: "bg-[#efeef4] text-[#3a2f5a] border-[#cfc9e3]",
  expirado: "bg-rose-50 text-rose-800 border-rose-200",
};
const BAR: Record<BudgetStatusKey, string> = { "sin-iniciar": "bg-slate-400", "en-tratamiento": "bg-sky-600", terminado: "bg-emerald-600", alta: "bg-[#473a6d]", expirado: "bg-rose-500" };

/**
 * Planes de tratamiento en tarjetas (como «Plan de tratamiento» de Dentalsoft): N°, fecha, profesional, descripción,
 * estado automático, avance X/Y, total, abonado y saldo, con filtros por estado. El detalle es la tarjeta completa de siempre.
 */
export function BudgetCardsBoard({ budgets, payments, today, validityDays, onPrint, onSetAlta, onChangeValidity, renderDetail }: {
  budgets: BudgetPlan[];
  payments: Array<{ budgetId: number | null; amount: number }>;
  today: string;
  validityDays: number;
  onPrint: (budgetId: number) => void;
  onSetAlta: (budget: BudgetPlan, alta: boolean) => Promise<void>;
  onChangeValidity?: (days: number) => Promise<void>;
  renderDetail: (budget: BudgetPlan) => ReactNode;
}) {
  const [hidden, setHidden] = useState<Set<BudgetStatusKey>>(() => new Set());
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editingValidity, setEditingValidity] = useState(false);
  const [validityText, setValidityText] = useState(String(validityDays));

  // Tarjetas: planes principales y alternativas sin principal; las alternativas viven dentro del detalle.
  const roots = budgets.filter(budget => !budget.isAlternative || !budgets.some(primary => primary.id === budget.parentBudgetId && !primary.isAlternative));
  const cards = roots.map(budget => {
    const paid = payments.filter(payment => payment.budgetId === budget.id).reduce((sum, payment) => sum + payment.amount, 0);
    return { budget, status: budgetStatus(budget, today, validityDays), summary: budgetCardSummary(budget.items, paid), alternatives: budgets.filter(other => other.isAlternative && other.parentBudgetId === budget.id).length };
  }).sort((a, b) => b.budget.id - a.budget.id);
  const counts = Object.fromEntries(BUDGET_STATUSES.map(({ key }) => [key, cards.filter(card => card.status === key).length])) as Record<BudgetStatusKey, number>;
  const visible = cards.filter(card => !hidden.has(card.status));
  const toggleFilter = (key: BudgetStatusKey) => setHidden(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleOpen = (id: number) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setAlta = async (budget: BudgetPlan, alta: boolean) => {
    setBusy(budget.id); setError("");
    try { await onSetAlta(budget, alta); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado."); } finally { setBusy(null); }
  };
  const saveValidity = async () => {
    const days = Number(validityText);
    if (!onChangeValidity || !Number.isInteger(days) || days < 7 || days > 730) { setError("La vigencia debe estar entre 7 y 730 días."); return; }
    setError("");
    try { await onChangeValidity(days); setEditingValidity(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la vigencia."); }
  };

  return <div className="space-y-4" data-testid="budget-cards-board">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar planes por estado">
      {BUDGET_STATUSES.map(({ key, label }) => {
        const active = !hidden.has(key);
        return <button key={key} type="button" aria-pressed={active} onClick={() => toggleFilter(key)} data-testid={`budget-filter-${key}`}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${active ? CHIP[key] : "border-[#e6e4ee] bg-white text-[#9a99ab] line-through"}`}>
          <span aria-hidden="true" className={`inline-block size-3 rounded-sm border ${active ? "border-current bg-current" : "border-[#c9c7d6]"}`}/>{label}<span className="font-normal">({counts[key]})</span>
        </button>;
      })}
      <span className="ml-auto text-xs text-[#6b6a7c]">
        {editingValidity
          ? <span className="inline-flex items-center gap-1">Vigencia <input aria-label="Días de vigencia del presupuesto" inputMode="numeric" className="h-8 w-16 rounded border border-[#dddbe6] px-2 text-base sm:text-xs" value={validityText} onChange={event => setValidityText(event.target.value.replace(/\D/g, "").slice(0, 3))}/> días <Button type="button" size="sm" variant="outline" onClick={() => void saveValidity()}>Guardar</Button></span>
          : <>Expira sin iniciar a los {validityDays} días{onChangeValidity && <button type="button" className="ml-1 underline" onClick={() => { setValidityText(String(validityDays)); setEditingValidity(true); }}>Cambiar</button>}</>}
      </span>
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900">{error}</p>}
    {visible.length === 0 && <p className="rounded-lg border border-dashed border-[#dddbe6] p-4 text-sm text-[#6b6a7c]">Ningún plan con los estados elegidos.</p>}
    {visible.map(({ budget, status, summary, alternatives }) => {
      const expanded = open.has(budget.id);
      return <article key={budget.id} className="overflow-hidden rounded-xl border border-[#e6e4ee] bg-white" data-testid={`budget-summary-${budget.id}`}>
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-2 p-4">
            <p className="text-xs font-semibold text-[#6b6a7c]">N° {budget.id} · {budget.date}{budget.authorName ? ` · ${budget.authorName}` : ""}</p>
            <div className="flex flex-wrap items-center gap-2">
              <strong className="min-w-0 break-words text-[#26243a]">{budget.title}</strong>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CHIP[status]}`} data-testid={`budget-status-${budget.id}`}>{budgetStatusLabel(status)}</span>
              {budget.isAlternative && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Alternativa</span>}
              {alternatives > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{alternatives} alternativa{alternatives === 1 ? "" : "s"}</span>}
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-[#615f73]"><span>Avance {summary.done}/{summary.count}</span><span>{summary.percent}%</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e6e4ee]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent} aria-label={`Avance del plan N° ${budget.id}`}><div className={`h-full rounded-full ${BAR[status]}`} style={{ width: `${summary.percent}%` }}/></div>
            </div>
          </div>
          <div className="space-y-2 border-t border-[#efeef4] bg-[#faf9fc] p-4 md:border-l md:border-t-0">
            <dl className="grid grid-cols-3 gap-2 text-center md:grid-cols-1 md:text-right">
              <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6a7c]">Total plan</dt><dd className="font-semibold text-[#26243a]">{money(summary.total)}</dd></div>
              <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6a7c]">Abonado</dt><dd className="text-[#3a2f5a]">{money(summary.paid)}</dd></div>
              <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6a7c]">Saldo</dt><dd className={summary.balance > 0 ? "font-semibold text-[#a43542]" : "text-emerald-700"}>{money(summary.balance)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => onPrint(budget.id)}><FileText className="mr-1 size-4"/>Ver PDF</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => onPrint(budget.id)}><Printer className="mr-1 size-4"/>Imprimir</Button>
              {!budget.isAlternative && budget.editable !== false && <Button type="button" size="sm" variant="outline" disabled={busy === budget.id} onClick={() => void setAlta(budget, status !== "alta")} data-testid={`budget-alta-${budget.id}`}>{status === "alta" ? "Quitar alta" : "Dar de alta"}</Button>}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => toggleOpen(budget.id)} aria-expanded={expanded} className="flex min-h-10 w-full items-center justify-center gap-1 border-t border-[#efeef4] text-sm font-semibold text-[#473a6d] hover:bg-[#f6f5fa]" data-testid={`budget-detail-toggle-${budget.id}`}>
          {expanded ? <><ChevronUp className="size-4"/>Ocultar detalle</> : <><ChevronDown className="size-4"/>Tratar · ver prestaciones y pagos</>}
        </button>
        {expanded && <div className="border-t border-[#efeef4] p-3 sm:p-4">{renderDetail(budget)}</div>}
      </article>;
    })}
  </div>;
}
