"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { budgetTotals } from "@/lib/budget-plans";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/dictation/spoken";
import { santiagoDateISO } from "@/app/agenda-week";
import type { BudgetPlan } from "@/components/budget-plan";

export type ManualPaymentInput = {
  budgetId: number;
  amount: number;
  method: PaymentMethod;
  concept: string;
  paidOn: string;
  requestId: string;
};

export function BudgetPaymentDialog({
  open, budget, paid, onOpenChange, onSave,
}: {
  open: boolean;
  budget: BudgetPlan | null;
  paid: number;
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
      await onSave({ budgetId: budget.id, amount, method: method as PaymentMethod, concept: concept.trim(), paidOn, requestId });
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
