"use client";

import { useEffect, useState } from "react";
import { Download, Mail } from "lucide-react";
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
  const [busy, setBusy] = useState<"" | "pdf" | "preview" | "send">("");
  const [target, setTarget] = useState<{ to: string; from: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (open) { setMode("detailed"); setTarget(null); setNotice(null); setBusy(""); }
  }, [open, budget?.id]);
  // Al cambiar el formato se pide confirmar de nuevo el envío.
  useEffect(() => { setTarget(null); }, [mode]);

  /** PDF real (no la impresión del navegador): el mismo archivo que se envía por correo. */
  const downloadPdf = async () => {
    if (!budget) return;
    setBusy("pdf"); setNotice(null);
    try {
      const response = await fetch(`/api/presupuesto/pdf?budgetId=${budget.id}&mode=${mode}`);
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error ?? "No se pudo generar el PDF."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `${budget.isAlternative ? "Alternativa-de-tratamiento" : "Presupuesto-de-tratamiento"}-${budget.id}.pdf`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice({ kind: "ok", text: "PDF generado. Revisa tus descargas." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo generar el PDF. Intenta de nuevo." }); }
    finally { setBusy(""); }
  };
  const prepareSend = async () => {
    if (!budget) return;
    setBusy("preview"); setNotice(null);
    try {
      const response = await fetch(`/api/presupuesto/enviar?budgetId=${budget.id}`);
      const result = await response.json().catch(() => ({})) as { preview?: { to: string; from: string }; error?: string };
      if (!response.ok || !result.preview) setNotice({ kind: "error", text: result.error ?? "No se pudo preparar el correo." });
      else setTarget({ to: result.preview.to, from: result.preview.from });
    } catch { setNotice({ kind: "error", text: "Sin conexión. Intenta de nuevo." }); }
    finally { setBusy(""); }
  };
  const sendNow = async () => {
    if (!budget) return;
    setBusy("send"); setNotice(null);
    try {
      const response = await fetch("/api/presupuesto/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetId: budget.id, mode }) });
      const result = await response.json().catch(() => ({})) as { to?: string; error?: string };
      if (!response.ok) setNotice({ kind: "error", text: result.error ?? "No se pudo enviar el correo." });
      else { setNotice({ kind: "ok", text: `PDF enviado a ${result.to}.` }); setTarget(null); }
    } catch { setNotice({ kind: "error", text: "Sin conexión. No se envió; intenta de nuevo." }); }
    finally { setBusy(""); }
  };
  if (!budget) return null;
  const totals = budgetTotals(budget.items);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-budget-print-dialog className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <div data-budget-print-controls>
        <DialogHeader>
          <DialogTitle>Previsualizar presupuesto</DialogTitle>
          <DialogDescription>Elige qué información verá el paciente. Puedes descargar el PDF o enviarlo ahora al correo registrado del paciente.</DialogDescription>
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
            <p><span className="text-[#6b6a7c]">Fecha:</span> {budget.date} · <span className="text-[#6b6a7c]">N°</span> {budget.id}</p>
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
          Presupuesto informativo sujeto a evaluación y confirmación del profesional tratante. El PDF incluye además la hora de emisión, las condiciones y los espacios de firma.
        </footer>
      </article>

      <div data-budget-print-controls className="space-y-3">
        {target && <div role="alertdialog" aria-label="Confirmar envío" className="rounded-xl border border-[#b8b1d6] bg-[#f7f6fa] p-3 text-sm">
          <p>Se enviará el PDF a <strong>{target.to}</strong> desde <strong>{target.from}</strong>.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy !== ""} onClick={() => void sendNow()}>{busy === "send" ? "Enviando…" : "Enviar ahora"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy === "send"} onClick={() => setTarget(null)}>Cancelar</Button>
          </div>
        </div>}
        {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={"rounded-lg p-3 text-sm " + (notice.kind === "error" ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-900")}>{notice.text}</p>}
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => void prepareSend()}><Mail className="mr-2 size-4"/>{busy === "preview" ? "Preparando…" : "Enviar al correo del paciente"}</Button>
            <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy !== ""} onClick={() => void downloadPdf()}><Download className="mr-2 size-4"/>{busy === "pdf" ? "Generando…" : "Descargar PDF"}</Button>
          </div>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>;
}
