"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { budgetItemTotal, budgetPhases, budgetTotals } from "@/lib/budget-plans";
import type { BudgetPlan } from "@/components/budget-plan";

type PrintMode = "detailed" | "total" | "no-prices";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");

const modes: Array<{ value: PrintMode; title: string; description: string }> = [
  { value: "detailed", title: "Completo", description: "Prestaciones, fases y valores." },
  { value: "total", title: "Solo total", description: "No muestra el detalle de prestaciones." },
  { value: "no-prices", title: "Sin valores", description: "Muestra prestaciones, sin montos." },
];

export function BudgetPrintDialog({
  open, onOpenChange, budget, patientName, professionalName = "", clinicName = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget: BudgetPlan | null;
  patientName: string;
  /** Nombre del profesional que emite el documento (el de su perfil). */
  professionalName?: string;
  clinicName?: string;
}) {
  const [mode, setMode] = useState<PrintMode>("detailed");
  useEffect(() => {
    if (open) setMode("detailed");
  }, [open, budget?.id]);
  if (!budget) return null;
  const totals = budgetTotals(budget.items);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-budget-print-dialog className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <div data-budget-print-controls>
        <DialogHeader>
          <DialogTitle>Previsualizar presupuesto</DialogTitle>
          <DialogDescription>Elige qué información verá el paciente. Para guardar un PDF, selecciona «Guardar como PDF» en el cuadro de impresión.</DialogDescription>
        </DialogHeader>
        <div className="mt-5 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato del presupuesto">
          {modes.map(option => <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={"rounded-xl border p-3 text-left transition " + (mode === option.value ? "border-[#473a6d] bg-[#efeef4]" : "border-[#dddbe6] bg-white hover:border-[#b8b1d6]")}
          >
            <span className="block font-semibold">{option.title}</span>
            <span className="mt-1 block text-xs text-[#615f73]">{option.description}</span>
          </button>)}
        </div>
      </div>

      <article id="budget-print-document" data-budget-print-document className="mt-5 rounded-xl border border-[#dddbe6] bg-white p-6 text-[#35343f]">
        <header className="border-b border-[#dddbe6] pb-4">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#8874b4]">{professionalName ? `${clinicName || "Gestión Dental"} · ${professionalName}` : clinicName || "Gestión Dental"}</p>
          <h2 className="mt-2 text-2xl font-semibold">{budget.isAlternative ? "Alternativa de tratamiento" : "Presupuesto de tratamiento"}</h2>
          <p className="mt-1 text-sm text-[#615f73]">{budget.title}</p>
          <div className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
            <p><span className="text-[#6b6a7c]">Paciente:</span> <strong>{patientName}</strong></p>
            <p><span className="text-[#6b6a7c]">Fecha:</span> {budget.date}</p>
          </div>
        </header>

        {mode === "total" ? <section className="py-8 text-center">
          <p className="text-sm text-[#615f73]">Total del presupuesto</p>
          <p className="mt-2 text-3xl font-bold text-[#473a6d]">{money(totals.total)}</p>
        </section> : <div className="mt-5 space-y-5">
          {budgetPhases(budget.items).map(phase => <section key={phase.name} className="break-inside-avoid">
            <h3 className="border-b border-[#efeef4] pb-2 text-sm font-semibold uppercase tracking-wide text-[#4f4e62]">{phase.name}</h3>
            <ul className="divide-y divide-[#efeef4]">
              {phase.items.map((item, index) => <li key={phase.name + "-" + index} className="flex justify-between gap-4 py-3 text-sm">
                <span>{item.label}{mode === "detailed" && item.discountPercent ? <span className="ml-2 text-xs text-[#3a2f5a]">Descuento {item.discountPercent}%</span> : null}</span>
                {mode === "detailed" && <strong className="shrink-0">{money(budgetItemTotal(item))}</strong>}
              </li>)}
            </ul>
          </section>)}
          {mode === "detailed" && <section className="ml-auto max-w-sm space-y-2 border-t border-[#dddbe6] pt-4 text-sm">
            <p className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></p>
            <p className="flex justify-between text-[#615f73]"><span>Descuentos</span><span>−{money(totals.discount)}</span></p>
            <p className="flex justify-between border-t border-[#dddbe6] pt-3 text-base font-bold"><span>Total</span><span className="text-[#473a6d]">{money(totals.total)}</span></p>
          </section>}
        </div>}

        <footer className="mt-8 border-t border-[#dddbe6] pt-3 text-xs text-[#6b6a7c]">
          Presupuesto informativo sujeto a evaluación y confirmación del profesional tratante.
        </footer>
      </article>

      <DialogFooter data-budget-print-controls className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => window.print()}>Imprimir / Guardar como PDF</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
