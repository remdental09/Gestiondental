"use client";
/**
 * Ventana de un implante (hoja que sube desde abajo en el teléfono): todo lo de ese implante está aquí, en tres secciones
 * (etapas, datos e imágenes). Se pasa de un implante a otro deslizando o con las flechas.
 * Nada cambia sin un toque del profesional; quitar una marca y descartar lo escrito piden confirmación.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDot, X } from "lucide-react";
import { connectionText, implantSize, phaseLabel, stageMarks, stageOptions, type Implant, type RecordedPhase, type StageChange } from "@/lib/implants";

const dayLabel = (iso: string) => iso ? iso.split("-").reverse().join("-") : "sin fecha";

/** Recuadro pequeño que identifica el implante: marca, medidas y tipo de conexión. Lo que falta se dice, no se supone. */
export function ImplantIdBox({ item, extra = "" }: { item: Implant; extra?: string }) {
  return <span className="block min-w-0 rounded-xl border border-[#dcd7ea] bg-[#f7f5fb] px-3 py-2" data-testid="implant-id-box">
    <span className="block break-words text-sm font-semibold text-[#2b2540]">{[item.brand, item.system].filter(Boolean).join(" · ") || "Marca sin registrar"}</span>
    <span className="block break-words text-sm text-[#473a6d]">{implantSize(item) || "Medidas sin registrar"} · {connectionText(item.connection) || "Conexión sin registrar"}</span>
    {extra && <span className="block break-words text-xs text-[#615f73]">{extra}</span>}
  </span>;
}

/**
 * Las seis etapas del implante, cada una con su fecha. Tocar una abre su fecha para marcarla o corregirla, en cualquier orden;
 * la actual es la más avanzada marcada. Se monta con una `key` por implante.
 */
export function StageList({ item, today, busy, onChange }: {
  item: Implant; today: string; busy: boolean;
  /** Devuelve true si quedó guardado. */
  onChange: (change: StageChange) => Promise<boolean>;
}) {
  const marks = stageMarks(item.history, item.phase, item.placedOn);
  const stages = stageOptions(Object.keys(marks));
  const [open, setOpen] = useState<{ phase: RecordedPhase; date: string } | null>(null);
  const save = async (change: StageChange) => { if (await onChange(change)) setOpen(null); };
  const toggle = (phase: RecordedPhase) => setOpen(previous => previous?.phase === phase ? null
    // Para una marca nueva se propone hoy (la cirugía, la fecha de instalación si ya está); una marcada muestra lo guardado.
    : { phase, date: marks[phase] ?? (phase === "cirugia" && item.placedOn ? item.placedOn : today) });
  const remove = (phase: RecordedPhase) => {
    const rest = stages.filter(other => other.id !== phase && marks[other.id] !== undefined).at(-1);
    const after = phase !== item.phase ? "" : rest ? ` La etapa actual quedará en «${rest.label}».` : " El implante quedará sin etapa registrada.";
    const placed = phase === "cirugia" && item.placedOn ? ` También se borra la fecha de instalación (${dayLabel(item.placedOn)}).` : "";
    if (window.confirm(`¿Desea eliminar la marca de «${phaseLabel(phase)}»?${after}${placed}`)) void save({ phase, was: marks[phase] ?? null, remove: true });
  };

  return <div data-testid="implant-stages">
    <p className="text-sm text-[#615f73]">Toca una etapa para marcarla o cambiar su fecha.</p>
    <ol className="mt-1 divide-y divide-[#ebe9f2]">{stages.map(phase => {
      const day = marks[phase.id], marked = day !== undefined, current = item.phase === phase.id, editing = open?.phase === phase.id ? open : null;
      const installed = phase.id === "cirugia" ? item.placedOn : "";
      const Icon = current ? CircleDot : marked ? CircleCheck : Circle;
      return <li key={phase.id}>
        <button type="button" aria-expanded={!!editing} onClick={() => toggle(phase.id)} data-testid={`implant-stage-${phase.id}`} data-state={current ? "actual" : marked ? "marcada" : "sin-marcar"}
          className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-1 text-left text-base ${current ? "font-semibold text-[#473a6d]" : "text-[#2b2540]"}`}>
          <Icon className={`size-5 shrink-0 ${marked ? "text-[#473a6d]" : "text-[#b4b0c4]"}`} aria-hidden="true"/>
          <span className="flex-1">{phase.label}{current && " (actual)"}</span>
          <span className={`text-right text-sm font-normal ${marked ? "text-[#615f73]" : "text-[#8a879b]"}`}>{marked ? dayLabel(day) : installed ? `instalado ${dayLabel(installed)}` : "marcar"}</span>
        </button>
        {editing && <div className="mb-2 space-y-2 rounded-xl bg-[#f3f1f7] p-3" data-testid="implant-stage-editor">
          <label className="block text-sm font-semibold text-[#473a6d]">{phase.id === "cirugia" ? "Fecha de cirugía (instalación)" : `Fecha de ${phase.label.toLocaleLowerCase("es")}`}
            <input type="date" max={today} value={editing.date} onChange={e => setOpen({ phase: phase.id, date: e.target.value })} className="mt-1 block min-h-11 w-full min-w-0 max-w-full appearance-none rounded-lg border border-[#d8d5e4] bg-white px-3 text-base font-normal text-[#2b2540]" data-testid="implant-stage-date"/></label>
          {!editing.date && <p className="text-xs text-[#615f73]">Sin fecha: la etapa queda marcada sin día.</p>}
          {installed && marked && installed !== day && <button type="button" disabled={busy} onClick={() => void save({ phase: phase.id, was: day, date: installed })} className="block min-h-11 text-left text-sm font-semibold text-[#473a6d] underline">La instalación dice {dayLabel(installed)}: usar esa fecha</button>}
          <button type="button" disabled={busy || (marked && editing.date === day)} onClick={() => void save({ phase: phase.id, was: day ?? null, date: editing.date })} data-testid="implant-stage-save"
            className="min-h-11 w-full rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{marked ? "Guardar fecha" : "Marcar etapa"}</button>
          {marked && <button type="button" disabled={busy} onClick={() => remove(phase.id)} data-testid="implant-stage-remove" className="min-h-11 w-full text-sm font-semibold text-rose-800">Quitar marca</button>}
        </div>}
      </li>;
    })}</ol>
  </div>;
}

export type SheetTab = "etapas" | "datos" | "imagenes";

export function ImplantSheet({ title, patientName, position, summary, tabs, tab, onTab, scrollKey, covered, locked, onStep, canClose, onClosed, footer, children }: {
  title: string;
  patientName: string;
  /** Lugar de este implante entre los del paciente; null en una ficha nueva. */
  position: { at: number; total: number } | null;
  /** Recuadro de identificación: se ve en las tres secciones. */
  summary?: ReactNode;
  /** null en una ficha nueva: solo se muestran sus datos. */
  tabs: { id: SheetTab; label: string }[] | null;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  /** Al cambiar, el contenido vuelve arriba. */
  scrollKey: string;
  /** Hay una imagen abierta encima: las teclas son para ella. */
  covered: boolean;
  /** Mientras se guarda no se cambia de implante. */
  locked: boolean;
  /** Pide pasar al implante anterior o siguiente; false si el profesional prefirió quedarse. */
  onStep: (step: 1 | -1) => boolean;
  /** Se pregunta antes de cerrar (puede haber algo sin guardar). */
  canClose: () => boolean;
  onClosed: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [direction, setDirection] = useState<"" | "next" | "previous">("");
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number; handle: boolean } | null>(null);
  const timer = useRef(0);

  // El fondo no se desplaza mientras la ventana está abierta y al cerrar vuelve el foco a donde estaba.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => { window.clearTimeout(timer.current); document.body.style.overflow = overflow; before?.focus?.({ preventScroll: true }); };
  }, []);
  useEffect(() => { body.current?.scrollTo(0, 0); }, [scrollKey]);

  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current || !canClose()) return;
    leaving.current = true; setClosing(true); timer.current = window.setTimeout(onClosed, 200);
  }, [canClose, onClosed]);
  const go = useCallback((step: 1 | -1) => {
    if (!position || locked || position.at + step < 0 || position.at + step >= position.total) return;
    if (onStep(step)) setDirection(step > 0 ? "next" : "previous");
  }, [position, locked, onStep]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Con una imagen o el lector de códigos encima, las teclas son para ellos.
      if (covered || document.querySelector('[data-testid="code-scanner"]')) return;
      if (event.key === "Escape") { close(); return; }
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, close, go]);

  /** Deslizar a los lados cambia de implante; hacia abajo desde la cabecera, cierra. */
  const onTouchStart = (event: TouchEvent) => {
    const start = event.touches.length === 1 ? event.touches[0]! : null, target = event.target as Element;
    // Lo que se abre por encima (el lector de códigos) no está dentro de la hoja: sus gestos no cuentan.
    touch.current = start && panel.current?.contains(target) && !target.closest("input, textarea, select") ? { x: start.clientX, y: start.clientY, handle: !!target.closest("[data-sheet-handle]") } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current, end = event.changedTouches[0];
    touch.current = null;
    if (!start || !end) return;
    const dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (start.handle && dy > 80 && dy > 1.5 * Math.abs(dx)) close();
  };

  const arrow = "inline-flex size-11 items-center justify-center rounded-full text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-30";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" data-testid="implant-sheet">
      <style>{`
        @keyframes gd-implant-up{from{transform:translateY(100%)}to{transform:none}}
        @keyframes gd-implant-down{from{transform:none}to{transform:translateY(100%);opacity:.4}}
        @keyframes gd-implant-fade{from{opacity:0}to{opacity:1}}
        @keyframes gd-implant-next{from{transform:translateX(28px);opacity:0}to{transform:none;opacity:1}}
        @keyframes gd-implant-previous{from{transform:translateX(-28px);opacity:0}to{transform:none;opacity:1}}
        .gd-implant{animation:gd-implant-up .42s cubic-bezier(.2,.9,.2,1)}
        .gd-implant-closing .gd-implant{animation:gd-implant-down .2s ease-in forwards}
        .gd-implant-backdrop{animation:gd-implant-fade .25s ease-out}
        .gd-implant-closing .gd-implant-backdrop{opacity:0;transition:opacity .2s}
        .gd-implant-next{animation:gd-implant-next .28s ease-out}
        .gd-implant-previous{animation:gd-implant-previous .28s ease-out}
        @media (min-width:640px){@keyframes gd-implant-up{from{transform:translateY(32px) scale(.96);opacity:0}to{transform:none;opacity:1}}}
        @media (prefers-reduced-motion:reduce){.gd-implant,.gd-implant-closing .gd-implant,.gd-implant-backdrop,.gd-implant-next,.gd-implant-previous{animation:none}}
      `}</style>
      <div className={`contents ${closing ? "gd-implant-closing" : ""}`}>
        <button type="button" tabIndex={-1} aria-label="Cerrar ventana del implante" onClick={close} className="gd-implant-backdrop absolute inset-0 cursor-default bg-black/35 backdrop-blur-sm"/>
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title} de ${patientName}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
          className="gd-implant relative flex h-[92dvh] w-full touch-pan-y flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none sm:h-[min(92dvh,52rem)] sm:max-w-xl sm:rounded-3xl">
          <div data-sheet-handle className="touch-none select-none border-b border-[#ebe9f2] px-4 pb-2">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[#d8d3e3] sm:hidden" aria-hidden="true"/>
            <div className="flex items-center gap-1 pt-1">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-[#2b2540]" data-testid="implant-sheet-title">{title}</h2>
                <p className="truncate text-xs text-[#6b6a7c]">{patientName}</p>
              </div>
              {position && position.total > 1 && <div className="flex items-center" role="group" aria-label="Cambiar de implante">
                <button type="button" className={arrow} disabled={position.at === 0 || locked} onClick={() => go(-1)} aria-label="Implante anterior"><ChevronLeft className="size-5" aria-hidden="true"/></button>
                <span className="whitespace-nowrap text-sm text-[#615f73]" aria-live="polite">{position.at + 1} de {position.total}</span>
                <button type="button" className={arrow} disabled={position.at === position.total - 1 || locked} onClick={() => go(1)} aria-label="Implante siguiente"><ChevronRight className="size-5" aria-hidden="true"/></button>
              </div>}
              <button type="button" className={arrow} onClick={close} aria-label="Cerrar"><X className="size-5" aria-hidden="true"/></button>
            </div>
          </div>

          {summary && <div className="px-4 pt-3">{summary}</div>}
          {tabs && <div className="px-4 pt-3"><div className="flex gap-1 rounded-xl bg-[#f3f1f7] p-1" role="tablist" aria-label="Secciones del implante">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => onTab(item.id)} data-testid={`implant-tab-${item.id}`}
            className={`min-h-11 flex-1 rounded-lg px-1 text-sm font-semibold ${tab === item.id ? "bg-white text-[#2b2540] shadow-sm" : "text-[#615f73]"}`}>{item.label}</button>)}</div></div>}

          <div ref={body} className="flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
            {/* Sin `key`: lo que está a medias dentro (producto, capturadora) no se vuelve a montar al cambiar de sección. */}
            <div className={direction ? `gd-implant-${direction}` : ""} onAnimationEnd={event => { if (event.target === event.currentTarget) setDirection(""); }}>{children}</div>
          </div>

          {footer && <div className="space-y-2 border-t border-[#ebe9f2] px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
        </div>
      </div>
    </div>, document.body);
}
