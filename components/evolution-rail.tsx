"use client";
/**
 * Riel vertical de herramientas pegado a cada evolución: las acciones más usadas, apiladas, con etiquetas mínimas.
 * La evolución más reciente lo muestra completo; las anteriores, plegado en un solo botón para no recargar la ficha.
 */
import { useState } from "react";
import { CalendarClock, CalendarPlus, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Ellipsis, FileText, FlaskConical, Calculator, Mic, MessageCircle, Pill, ScrollText, Wallet } from "lucide-react";
import type { ClinicalDocumentKind } from "@/lib/clinical-documents";

export type RailActions = {
  onDictate?: () => void;
  onBudget?: () => void;
  onMarkDone?: () => void;
  onCharge?: () => void;
  onControl?: () => void;
  onAppointment?: () => void;
  whatsappHref?: string | null;
  /** Abre Documentación con el tipo elegido en el árbol de documentos. */
  onDocument?: (kind: ClinicalDocumentKind) => void;
};

const TOOL = "flex min-h-11 w-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[#473a6d] hover:bg-[#ece8f6] active:bg-[#e2dcf2] focus-visible:outline-2 focus-visible:outline-[#473a6d]";
/** Árbol de documentos: cada tipo con su color (mismos que Documentación). */
const DOCUMENT_TREE: Array<{ kind: ClinicalDocumentKind; label: string; icon: typeof Pill; tint: string; color: string }> = [
  { kind: "receta", label: "Receta", icon: Pill, tint: "bg-[#dff0fc]", color: "text-[#4aa3d8]" },
  { kind: "receta_magistral", label: "Magistral", icon: FlaskConical, tint: "bg-[#e6f9fe]", color: "text-[#4cc3e3]" },
  { kind: "orden", label: "Orden", icon: ClipboardList, tint: "bg-[#d4d3e6]", color: "text-[#27277a]" },
  { kind: "certificado", label: "Certificado", icon: ClipboardCheck, tint: "bg-[#e1dcfa]", color: "text-[#6e56f0]" },
  { kind: "consentimiento", label: "Consent.", icon: ScrollText, tint: "bg-[#fbeed5]", color: "text-[#d68a1c]" },
];
/** Curva de resorte suave (estilo Apple): arranque rápido y frenado largo. */
const SPRING = "duration-[550ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none motion-reduce:duration-0";
const LABEL = "text-[9px] font-medium leading-none tracking-tight text-[#615f73]";

export function EvolutionRail({ actions, latest }: { actions: RailActions; latest: boolean }) {
  const [open, setOpen] = useState(latest);
  const [docsOpen, setDocsOpen] = useState(false);
  const tools: Array<{ key: string; label: string; icon: typeof Mic; run?: () => void; href?: string | null }> = [
    { key: "dictar", label: "Dictar", icon: Mic, run: actions.onDictate },
    { key: "presupuestar", label: "Presup.", icon: Calculator, run: actions.onBudget },
    { key: "realizado", label: "Realizado", icon: CheckCircle2, run: actions.onMarkDone },
    { key: "cobrar", label: "Cobrar", icon: Wallet, run: actions.onCharge },
    { key: "control", label: "Control", icon: CalendarClock, run: actions.onControl },
    { key: "cita", label: "Cita", icon: CalendarPlus, run: actions.onAppointment },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, href: actions.whatsappHref },
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
    {actions.onDocument && <div className="flex w-full flex-col items-center" data-testid="rail-documento-grupo">
      <button type="button" className={`${TOOL} ${docsOpen ? "bg-[#ece8f6]" : ""}`} onClick={() => setDocsOpen(value => !value)} aria-expanded={docsOpen} aria-controls="rail-documentos-arbol" data-testid="rail-documento">
        <span className="relative"><FileText className="size-[18px]" aria-hidden="true" /><ChevronDown className={`absolute -right-2.5 -bottom-1 size-3 transition-transform ${SPRING} ${docsOpen ? "rotate-180" : ""}`} aria-hidden="true" /></span>
        <span className={LABEL}>Documento</span>
      </button>
      <div id="rail-documentos-arbol" className={`grid w-full transition-[grid-template-rows,opacity] ${SPRING} ${docsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} data-testid="rail-documentos-arbol" data-open={docsOpen ? "true" : "false"} inert={!docsOpen}>
        <ul className="relative ml-1.5 min-h-0 overflow-hidden border-l border-[#d9d3ea] pl-1" aria-label="Tipos de documento">
          {DOCUMENT_TREE.map((item, index) => {
            const Icon = item.icon;
            return <li key={item.kind} className={`transition-[opacity,transform] ${SPRING} ${docsOpen ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-90 opacity-0"}`} style={{ transitionDelay: docsOpen ? `${index * 45}ms` : "0ms" }}>
              <button type="button" className="group flex min-h-11 w-[2.65rem] flex-col items-center justify-center gap-0.5 rounded-lg text-[#473a6d] hover:bg-[#f3f1f9] active:scale-95 focus-visible:outline-2 focus-visible:outline-[#473a6d] motion-safe:transition-transform" onClick={() => { setDocsOpen(false); actions.onDocument?.(item.kind); }} data-testid={`rail-doc-${item.kind}`}>
                <span className={`flex size-7 items-center justify-center rounded-full ${item.tint} ${item.color} shadow-[inset_0_0_0_1px_rgba(255,255,255,.6)]`}><Icon className="size-4" aria-hidden="true" /></span>
                <span className={LABEL}>{item.label}</span>
              </button>
            </li>;
          })}
        </ul>
      </div>
    </div>}
  </nav>;
}
