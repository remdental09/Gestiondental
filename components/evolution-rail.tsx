"use client";
/**
 * Riel vertical de herramientas pegado a cada evolución: las acciones más usadas, apiladas, con etiquetas mínimas.
 * La evolución más reciente lo muestra completo; las anteriores, plegado en un solo botón para no recargar la ficha.
 */
import { useState } from "react";
import { CalendarClock, CalendarPlus, CheckCircle2, Ellipsis, FileText, Calculator, Mic, MessageCircle, Wallet } from "lucide-react";

export type RailActions = {
  onDictate?: () => void;
  onBudget?: () => void;
  onMarkDone?: () => void;
  onCharge?: () => void;
  onControl?: () => void;
  onAppointment?: () => void;
  whatsappHref?: string | null;
  onDocument?: () => void;
};

const TOOL = "flex min-h-11 w-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[#473a6d] hover:bg-[#ece8f6] active:bg-[#e2dcf2] focus-visible:outline-2 focus-visible:outline-[#473a6d]";
const LABEL = "text-[9px] font-medium leading-none tracking-tight text-[#615f73]";

export function EvolutionRail({ actions, latest }: { actions: RailActions; latest: boolean }) {
  const [open, setOpen] = useState(latest);
  const tools: Array<{ key: string; label: string; icon: typeof Mic; run?: () => void; href?: string | null }> = [
    { key: "dictar", label: "Dictar", icon: Mic, run: actions.onDictate },
    { key: "presupuestar", label: "Presup.", icon: Calculator, run: actions.onBudget },
    { key: "realizado", label: "Realizado", icon: CheckCircle2, run: actions.onMarkDone },
    { key: "cobrar", label: "Cobrar", icon: Wallet, run: actions.onCharge },
    { key: "control", label: "Control", icon: CalendarClock, run: actions.onControl },
    { key: "cita", label: "Cita", icon: CalendarPlus, run: actions.onAppointment },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, href: actions.whatsappHref },
    { key: "documento", label: "Receta", icon: FileText, run: actions.onDocument },
  ].filter(tool => tool.run || tool.href);
  if (!open) return <div className="sticky top-36 self-start"><button type="button" className={TOOL} onClick={() => setOpen(true)} aria-label="Herramientas de esta evolución" data-testid="rail-expand"><Ellipsis className="size-4" aria-hidden="true" /><span className={LABEL}>Más</span></button></div>;
  return <nav aria-label="Herramientas de la evolución" className="sticky top-36 flex flex-col items-center gap-0.5 self-start rounded-xl border border-[#e6e4ee] bg-white/95 p-0.5 shadow-sm" data-testid="evolution-rail">
    {tools.map(tool => {
      const Icon = tool.icon;
      const inner = <><Icon className="size-[18px]" aria-hidden="true" /><span className={LABEL}>{tool.label}</span></>;
      return tool.href
        ? <a key={tool.key} href={tool.href} target="_blank" rel="noopener noreferrer" className={TOOL} data-testid={`rail-${tool.key}`}>{inner}</a>
        : <button key={tool.key} type="button" className={TOOL} onClick={tool.run} data-testid={`rail-${tool.key}`}>{inner}</button>;
    })}
  </nav>;
}
