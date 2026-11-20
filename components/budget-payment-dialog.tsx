"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { budgetTotals } from "@/lib/budget-plans";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/dictation/spoken";
import { santiagoDateISO } from "@/app/agenda-week";
import type { BudgetPlan } from "@/components/budget-plan";
import { cartola, splitAcross, type Allocation, type AllocPayment } from "@/lib/payment-allocation";
import { ITEM_STATUS_LABEL, itemStatus } from "@/lib/budget-plans";

export type ManualPaymentInput = {
  budgetId: number;
  amount: number;
  method: PaymentMethod;
  concept: string;
  paidOn: string;
  requestId: string;
  /** Ítems a los que se aplica; vacío = abono libre (se aplica a lo realizado más antiguo). */
  allocations?: Allocation[];
};

export function BudgetPaymentDialog({
  open, budget, paid, onOpenChange, onSave, payments = [], preselect = [],
}: {
  open: boolean;
  budget: BudgetPlan | null;
  paid: number;
  /** Abonos de este presupuesto (para el saldo por ítem). */
  payments?: AllocPayment[];
  /** Ítems ya marcados al abrir (p. ej. «Cobrar» desde el árbol). */
  preselect?: number[];
  onOpenChange: (open: boolean) => void;
  onSave: (payment: ManualPaymentInput) => Promise<void>;
}) {
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [concept, setConcept] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"libre" | "items">("libre");
  const [selected, setSelected] = useState<number[]>([]);
  const current = budget ? cartola(budget.items, payments) : null;
  const savingRef = useRef(false);
  const today = santiagoDateISO(new Date());
  const total = budget ? budgetTotals(budget.items).total : 0;
  const balance = Math.max(0, total - paid);
  const amount = amountText.trim() ? Number(amountText) : 0;
  const validAmount = Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000_000;
  const exceedsBalance = amount > balance;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && paidOn <= today;
  const validMethod = PAYMENT_METHODS.includes(method as PaymentMethod);

  useEffect(() => {
    if (!open || !budget) return;
    setAmountText("");
    setMethod("");
    setConcept("");
    setPaidOn(santiagoDateISO(new Date()));
    setRequestId(crypto.randomUUID());
    setError("");
    const pre = preselect.filter(index => (budget.items[index] ? true : false));
    setSelected(pre);
    setMode(pre.length ? "items" : "libre");
    if (pre.length) {
      const c = cartola(budget.items, payments);
      const due = pre.reduce((sum, index) => sum + Math.max(0, c.items[index]?.saldo ?? 0), 0);
      if (due > 0) setAmountText(String(due));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget?.id]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !budget) return;
    if (!validAmount) { setError("Ingresa un monto entero mayor que cero."); return; }
    if (exceedsBalance) { setError("El monto supera el saldo pendiente de este tratamiento."); return; }
    if (!validMethod) { setError("Selecciona el medio de pago."); return; }
    if (!validDate) { setError("Revisa la fecha del pago."); return; }
    if (!requestId) { setError("Espera un momento y vuelve a guardar."); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const allocations = mode === "items" && current ? splitAcross(amount, selected, budget.items, current) : [];
      if (mode === "items" && !allocations.length) { setError("Marca al menos un ítem con saldo, o usa abono libre."); return; }
      await onSave({ budgetId: budget.id, amount, method: method as PaymentMethod, concept: concept.trim(), paidOn, requestId, ...(allocations.length ? { allocations } : {}) });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo registrar el pago.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <Dialog open={open && Boolean(budget)} onOpenChange={next => { if (!next && !saving) onOpenChange(false); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto border-[#dddbe6] bg-white sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Registrar pago o abono</DialogTitle>
        <DialogDescription>Se asociará a este tratamiento y actualizará su saldo pendiente. La evolución conserva lo dictado, pero no registra un pago automáticamente.</DialogDescription>
      </DialogHeader>
      {budget && <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-[#e7e4ed] bg-[#f7f6fa] p-4">
          <p className="font-semibold text-[#473a6d]">{budget.title}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <p><span className="block text-xs text-[#6b6a7c]">Total</span><strong>${total.toLocaleString("es-CL")}</strong></p>
            <p><span className="block text-xs text-[#6b6a7c]">Abonado</span><strong>${paid.toLocaleString("es-CL")}</strong></p>
            <p><span className="block text-xs text-[#6b6a7c]">Saldo</span><strong>${balance.toLocaleString("es-CL")}</strong></p>
          </div>
        </div>
        <label className="block space-y-1 text-sm font-medium">Monto del pago (CLP)
          <Input autoFocus type="number" inputMode="numeric" min="1" max={Math.min(1_000_000_000, balance)} step="1" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder="50000" aria-invalid={Boolean(amountText) && (!validAmount || exceedsBalance)} required/>
        </label>
        {current && budget.items.length > 1 && <fieldset className="space-y-2 rounded-xl border border-[#e7e4ed] p-3 text-sm" data-testid="payment-apply">
          <legend className="px-1 text-sm font-medium">Aplicar a</legend>
          <div className="flex gap-2">
            <button type="button" aria-pressed={mode === "libre"} className={`h-10 flex-1 rounded-md border text-sm font-medium ${mode === "libre" ? "border-[#473a6d] bg-[#473a6d] text-white" : "bg-white text-[#473a6d]"}`} onClick={() => setMode("libre")}>Abono libre</button>
            <button type="button" aria-pressed={mode === "items"} className={`h-10 flex-1 rounded-md border text-sm font-medium ${mode === "items" ? "border-[#473a6d] bg-[#473a6d] text-white" : "bg-white text-[#473a6d]"}`} onClick={() => setMode("items")}>Ítems marcados</button>
          </div>
          {mode === "libre" ? <p className="text-xs text-[#6b6a7c]">Se aplica solo: primero a lo realizado más antiguo, luego a lo iniciado y al final a lo pendiente.</p>
            : <ul className="max-h-56 space-y-1 overflow-y-auto">{budget.items.map((item, index) => {
              const money = current.items[index];
              if (!money || money.saldo <= 0) return null;
              const on = selected.includes(index);
              return <li key={index}><label className="flex min-h-10 items-center gap-2 rounded-md px-1 hover:bg-[#f7f6fa]">
                <input type="checkbox" className="size-5" checked={on} onChange={() => {
                  const next = on ? selected.filter(i => i !== index) : [...selected, index];
                  setSelected(next);
                  const due = next.reduce((sum, i) => sum + Math.max(0, current.items[i]?.saldo ?? 0), 0);
                  setAmountText(due > 0 ? String(Math.min(due, balance)) : "");
                }} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-[#6b6a7c]">{ITEM_STATUS_LABEL[itemStatus(item)]} · saldo ${money.saldo.toLocaleString("es-CL")}</span>
              </label></li>;
            })}</ul>}
        </fieldset>}
        <label className="block space-y-1 text-sm font-medium">Medio de pago
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm" value={method} onChange={event => setMethod(event.target.value as PaymentMethod | "")} required>
            <option value="">Seleccionar…</option>
            {PAYMENT_METHODS.map(value => <option key={value} value={value}>{PAYMENT_METHOD_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">Fecha del pago
          <Input type="date" value={paidOn} max={today} onChange={event => setPaidOn(event.target.value)} required/>
        </label>
        <label className="block space-y-1 text-sm font-medium">Concepto (opcional)
          <Input maxLength={240} value={concept} onChange={event => setConcept(event.target.value)} placeholder="Abono de tratamiento"/>
        </label>
        {amount > 0 && validAmount && !exceedsBalance && <p className="rounded-lg bg-[#efeef4] p-3 text-sm">Saldo después de registrar: <strong>${(balance - amount).toLocaleString("es-CL")}</strong></p>}
        {error && <p role="alert" className="text-sm font-medium text-[#a43542]">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="submit" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving || !budget || !validAmount || exceedsBalance || !validMethod || !validDate || !requestId}>{saving ? "Guardando…" : "Confirmar y registrar"}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
