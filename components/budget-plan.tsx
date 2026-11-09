"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { budgetItemTotal, budgetPhases, budgetTotals, type BudgetItem } from "@/lib/budget-plans";
import type { Prestacion } from "@/lib/prestaciones-catalog";

export type BudgetPlan = {
  id: number;
  patientId: number;
  title: string;
  items: BudgetItem[];
  status: string;
  date: string;
  isAlternative: boolean;
  parentBudgetId: number | null;
};

export type BudgetPaymentEntry = {
  id: number;
  amount: number;
  method: string;
  concept: string;
  date: string;
};

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const paymentMethodLabel: Record<string, string> = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", transferencia: "Transferencia", otro: "Otro" };

type CatalogModule = typeof import("@/lib/prestaciones-catalog");

/** Campo de prestación con sugerencias del catálogo; el texto libre sigue siendo válido. */
function PrestacionField({ value, onChange, onPick }: { value: string; onChange: (label: string) => void; onPick: (label: string, code: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogModule | null>(null);
  const [open, setOpen] = useState(false);
  const matches = useMemo<Prestacion[]>(() => (catalog && open ? catalog.searchPrestaciones(value, 6) : []), [catalog, open, value]);
  return <div className="relative">
    <Input
      maxLength={180} value={value} autoComplete="off" role="combobox" aria-expanded={open && matches.length > 0} aria-autocomplete="list"
      onFocus={() => { setOpen(true); if (!catalog) void import("@/lib/prestaciones-catalog").then(setCatalog); }}
      onBlur={() => setTimeout(() => setOpen(false), 120)}
      onChange={(event) => { onChange(event.target.value); setOpen(true); }}
      placeholder="Ej.: rehabilitación protésica, sellante, exodoncia…"
    />
    {open && catalog && matches.length > 0 && <ul role="listbox" aria-label="Prestaciones sugeridas" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-[#dcd5ee] bg-white py-1 shadow-lg">
      {matches.map((item) => <li key={item.code} role="option" aria-selected={false}>
        <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f3effd]" onMouseDown={(event) => event.preventDefault()} onClick={() => { onPick(catalog.prestacionLabel(item.name), item.code); setOpen(false); }}>
          <span className="block">{catalog.prestacionLabel(item.name)}</span>
          <span className="block text-xs text-[#6e6a8c]">{catalog.prestacionLabel(item.group)} · {item.code}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}

export function BudgetItemsEditor({ items, onChange }: { items: BudgetItem[]; onChange: (items: BudgetItem[]) => void }) {
  const update = (index: number, patch: Partial<BudgetItem>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="font-semibold">Prestaciones y fases</h3><p className="text-xs text-[#6e6a8c]">Agrúpalas por etapa del tratamiento.</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { label: "", amount: 0, phase: "Fase 1", discountPercent: 0 }])}><Plus className="mr-1 size-4"/>Agregar</Button>
    </div>
    {items.map((item, index) => <section key={index} className="rounded-xl border border-[#e4def3] bg-[#fbf9ff] p-3" aria-label={`Prestación ${index + 1}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wide text-[#4f4a74]">Prestación {index + 1}</span>{items.length > 1 && <button type="button" aria-label={`Quitar prestación ${index + 1}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4"/></button>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium sm:col-span-2">Prestación<PrestacionField value={item.label} onChange={label => update(index, { label, code: undefined })} onPick={(label, code) => update(index, { label, code })}/></label>
        <label className="space-y-1 text-sm font-medium">Fase<Input maxLength={80} value={item.phase ?? ""} onChange={event => update(index, { phase: event.target.value })} placeholder="Fase 1 · Resolución"/></label>
        <label className="space-y-1 text-sm font-medium">Valor CLP<Input type="number" inputMode="numeric" min="1" step="1" value={item.amount || ""} onChange={event => update(index, { amount: Number(event.target.value) })} placeholder="790000"/></label>
        <label className="space-y-1 text-sm font-medium">Descuento (%)<Input type="number" inputMode="numeric" min="0" max="100" step="1" value={item.discountPercent ?? 0} onChange={event => update(index, { discountPercent: Number(event.target.value) })}/></label>
        <div className="flex items-end justify-between gap-3 pb-2 text-sm"><span className="text-[#6e6a8c]">Total de la prestación</span><strong>{money(budgetItemTotal(item))}</strong></div>
      </div>
    </section>)}
    <div className="rounded-xl bg-[#f3effd] p-4 text-sm">
      {(() => { const totals = budgetTotals(items); return <>
        <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
        <div className="mt-1 flex justify-between text-[#625e82]"><span>Descuentos</span><span>−{money(totals.discount)}</span></div>
        <div className="mt-3 flex justify-between border-t border-[#d2e7e2] pt-3 text-base font-semibold"><span>Total del plan</span><span className="text-[#6a3fc8]">{money(totals.total)}</span></div>
      </>; })()}
    </div>
  </div>;
}

export function BudgetCard({
  budget, patientName, parentTitle, paid = 0, payments = [], onEdit, onPrint, onCreateAlternative, onSelectPrimary, onRegisterPayment,
}: {
  budget: BudgetPlan;
  patientName?: string;
  parentTitle?: string;
  paid?: number;
  payments?: BudgetPaymentEntry[];
  onEdit?: () => void;
  onPrint?: () => void;
  onCreateAlternative?: () => void;
  onSelectPrimary?: () => void;
  onRegisterPayment?: () => void;
}) {
  const totals = budgetTotals(budget.items);
  const balance = Math.max(0, totals.total - paid);
  return <article className="rounded-xl border border-[#e4def3] p-5 transition hover:border-[#b9a3f5]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong>{budget.title}</strong>
          <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (budget.isAlternative ? "bg-amber-50 text-amber-800" : "bg-[#efe9fc] text-[#5a35b5]")}>
            {budget.isAlternative ? "Alternativa" : "Plan principal"}
          </span>
        </div>
        {parentTitle && <p className="mt-1 text-sm text-[#6e6a8c]">Alternativa de «{parentTitle}»</p>}
        {patientName && <p className="mt-1 text-sm text-[#6e6a8c]">{patientName}</p>}
        <p className="mt-1 text-xs text-[#8c88ab]">{budget.date} · {budget.status}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[#6a3fc8]">{money(totals.total)}</span>
        {onPrint && <Button type="button" variant="outline" size="sm" onClick={onPrint}>Vista previa / PDF</Button>}
        {onCreateAlternative && <Button type="button" variant="outline" size="sm" onClick={onCreateAlternative}>Crear alternativa</Button>}
        {onSelectPrimary && <Button type="button" variant="outline" size="sm" onClick={onSelectPrimary}>Establecer como principal</Button>}
        {onEdit && <Button type="button" variant="outline" size="sm" onClick={onEdit}>Editar</Button>}
      </div>
    </div>
    <div className="mt-4 space-y-4 border-t border-[#eeeaf8] pt-3">
      {budgetPhases(budget.items).map(phase => <section key={phase.name}>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#4f4a74]">{phase.name}</h4>
        <ul className="space-y-2">{phase.items.map((item, index) => <li key={`${item.label}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-[#625e82]"><span>{item.label}{item.code ? <span className="ml-2 text-xs text-[#6e6a8c]">Cód. {item.code}</span> : null}{item.discountPercent ? <span className="ml-2 text-xs text-[#5a35b5]">−{item.discountPercent}%</span> : null}</span><span>{money(budgetItemTotal(item))}</span></li>)}</ul>
      </section>)}
    </div>
    {budget.isAlternative
      ? <p className="mt-4 border-t border-[#eeeaf8] pt-3 text-xs text-[#6e6a8c]">Esta opción es solo una cotización. Para asociarle pagos, primero establécela como plan principal.</p>
      : <>
        <div className="mt-4 grid gap-2 border-t border-[#eeeaf8] pt-3 text-sm sm:grid-cols-3">
          <p><span className="text-[#6e6a8c]">Total</span><strong className="ml-2">{money(totals.total)}</strong></p>
          <p><span className="text-[#6e6a8c]">Abonado</span><strong className="ml-2">{money(paid)}</strong></p>
          <p><span className="text-[#6e6a8c]">Saldo pendiente</span><strong className="ml-2">{money(balance)}</strong></p>
        </div>
        <div className="mt-4 border-t border-[#eeeaf8] pt-4" data-testid={"budget-payment-panel-" + budget.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold">Pagos y abonos de este tratamiento</h4>
            {balance > 0 && onRegisterPayment && <Button type="button" size="sm" className="bg-[#6a3fc8] hover:bg-[#5632a3]" onClick={onRegisterPayment}><Wallet className="mr-2 size-4"/>Registrar pago o abono</Button>}
            {balance === 0 && <span className="rounded-full bg-[#efe9fc] px-3 py-1 text-xs font-semibold text-[#5a35b5]">Plan pagado</span>}
          </div>
          {payments.length
            ? <ul className="mt-3 space-y-2">{payments.map(payment => <li key={payment.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[#f7f4ff] px-3 py-2 text-sm"><span><strong>{money(payment.amount)}</strong> · {paymentMethodLabel[payment.method] ?? payment.method}{payment.concept ? " · " + payment.concept : ""}</span><span className="text-[#6e6a8c]">{payment.date}</span></li>)}</ul>
            : <p className="mt-2 text-xs leading-5 text-[#6e6a8c]">Sin abonos asociados. El dictado no modifica este saldo por sí solo; confirma cada pago o regístralo manualmente aquí.</p>}
        </div>
      </>}
  </article>;
}
