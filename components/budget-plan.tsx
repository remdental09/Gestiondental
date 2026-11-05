"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { budgetItemTotal, budgetPhases, budgetTotals, type BudgetItem } from "@/lib/budget-plans";

export type BudgetPlan = { id: number; patientId: number; title: string; items: BudgetItem[]; status: string; date: string };

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");

export function BudgetItemsEditor({ items, onChange }: { items: BudgetItem[]; onChange: (items: BudgetItem[]) => void }) {
  const update = (index: number, patch: Partial<BudgetItem>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="font-semibold">Prestaciones y fases</h3><p className="text-xs text-[#71858b]">Agrúpalas por etapa del tratamiento.</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { label: "", amount: 0, phase: "Fase 1", discountPercent: 0 }])}><Plus className="mr-1 size-4"/>Agregar</Button>
    </div>
    {items.map((item, index) => <section key={index} className="rounded-xl border border-[#e4ebed] bg-[#fbfdfd] p-3" aria-label={`Prestación ${index + 1}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wide text-[#527075]">Prestación {index + 1}</span>{items.length > 1 && <button type="button" aria-label={`Quitar prestación ${index + 1}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4"/></button>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium sm:col-span-2">Prestación<Input maxLength={180} value={item.label} onChange={event => update(index, { label: event.target.value })} placeholder="Ej.: rehabilitación protésica"/></label>
        <label className="space-y-1 text-sm font-medium">Fase<Input maxLength={80} value={item.phase ?? ""} onChange={event => update(index, { phase: event.target.value })} placeholder="Fase 1 · Resolución"/></label>
        <label className="space-y-1 text-sm font-medium">Valor CLP<Input type="number" inputMode="numeric" min="1" step="1" value={item.amount || ""} onChange={event => update(index, { amount: Number(event.target.value) })} placeholder="790000"/></label>
        <label className="space-y-1 text-sm font-medium">Descuento (%)<Input type="number" inputMode="numeric" min="0" max="100" step="1" value={item.discountPercent ?? 0} onChange={event => update(index, { discountPercent: Number(event.target.value) })}/></label>
        <div className="flex items-end justify-between gap-3 pb-2 text-sm"><span className="text-[#71858b]">Total de la prestación</span><strong>{money(budgetItemTotal(item))}</strong></div>
      </div>
    </section>)}
    <div className="rounded-xl bg-[#eff8f6] p-4 text-sm">
      {(() => { const totals = budgetTotals(items); return <>
        <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
        <div className="mt-1 flex justify-between text-[#60757a]"><span>Descuentos</span><span>−{money(totals.discount)}</span></div>
        <div className="mt-3 flex justify-between border-t border-[#d2e7e2] pt-3 text-base font-semibold"><span>Total del plan</span><span className="text-[#087f83]">{money(totals.total)}</span></div>
      </>; })()}
    </div>
  </div>;
}

export function BudgetCard({ budget, patientName, paid = 0, onEdit }: { budget: BudgetPlan; patientName?: string; paid?: number; onEdit?: () => void }) {
  const totals = budgetTotals(budget.items);
  const balance = Math.max(0, totals.total - paid);
  return <article className="rounded-xl border border-[#e4ebed] p-5 transition hover:border-[#9accca]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><strong>{budget.title}</strong>{patientName && <p className="mt-1 text-sm text-[#71858b]">{patientName}</p>}<p className="mt-1 text-xs text-[#8aa0a5]">{budget.date} · {budget.status}</p></div>
      <div className="flex items-center gap-3"><span className="font-semibold text-[#087f83]">{money(totals.total)}</span>{onEdit && <Button type="button" variant="outline" size="sm" onClick={onEdit}>Editar</Button>}</div>
    </div>
    <div className="mt-4 space-y-4 border-t border-[#edf1f2] pt-3">
      {budgetPhases(budget.items).map(phase => <section key={phase.name}>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#527075]">{phase.name}</h4>
        <ul className="space-y-2">{phase.items.map((item, index) => <li key={`${item.label}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-[#60757a]"><span>{item.label}{item.discountPercent ? <span className="ml-2 text-xs text-[#2b7764]">−{item.discountPercent}%</span> : null}</span><span>{money(budgetItemTotal(item))}</span></li>)}</ul>
      </section>)}
    </div>
    <div className="mt-4 grid gap-2 border-t border-[#edf1f2] pt-3 text-sm sm:grid-cols-3">
      <p><span className="text-[#71858b]">Total</span><strong className="ml-2">{money(totals.total)}</strong></p>
      <p><span className="text-[#71858b]">Abonado</span><strong className="ml-2">{money(paid)}</strong></p>
      <p><span className="text-[#71858b]">Saldo</span><strong className="ml-2">{money(balance)}</strong></p>
    </div>
  </article>;
}
