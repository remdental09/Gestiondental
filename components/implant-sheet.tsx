"use client";
/* eslint-disable @next/next/no-img-element -- Las imágenes clínicas son rutas autenticadas que se cargan con la sesión del navegador. */
/**
 * Ventana de un implante (hoja que sube desde abajo en el teléfono): recuadro de identificación, etapa, historial e imágenes.
 * Se pasa de un implante a otro deslizando o con las flechas. Nada cambia sin un toque del profesional y eliminar pide confirmación.
 */
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import type { ClinicalImage } from "@/app/clinical-data";
import { thumbUrl } from "@/lib/image-compress";
import { IMPLANT_PHASES, connectionText, implantSize, nextPhase, phaseLabel, type Implant, type ImplantLabel, type PhaseEntry } from "@/lib/implants";

const dayLabel = (iso: string) => iso ? iso.split("-").reverse().join("-") : "sin fecha";

/** Recuadro pequeño que identifica el implante: marca, medidas y tipo de conexión. Lo que falta se dice, no se supone. */
export function ImplantIdBox({ item, extra = "" }: { item: Implant; extra?: string }) {
  return <span className="block min-w-0 rounded-xl border border-[#dcd7ea] bg-[#f7f5fb] px-3 py-2" data-testid="implant-id-box">
    <span className="block break-words text-sm font-semibold text-[#2b2540]">{[item.brand, item.system].filter(Boolean).join(" · ") || "Marca sin registrar"}</span>
    <span className="block break-words text-sm text-[#473a6d]">{implantSize(item) || "Medidas sin registrar"} · {connectionText(item.connection) || "Conexión sin registrar"}</span>
    {extra && <span className="block break-words text-xs text-[#615f73]">{extra}</span>}
  </span>;
}

export type StageChange = { index: number; phase: PhaseEntry["phase"]; date: string } & ({ to: string } | { remove: true });

export function ImplantSheet({ implants, shownId, label, images, patientName, today, covered, warning = "", onShow, onClose, onAdvance, onEditStage, onOpenForm, onOpenImage }: {
  /** En el orden del implantograma. */
  implants: Implant[];
  shownId: number;
  label: ImplantLabel | undefined;
  images: ClinicalImage[];
  patientName: string;
  today: string;
  /** Hay una imagen abierta encima: las teclas son para ella. */
  covered: boolean;
  warning?: string;
  onShow: (id: number) => void;
  onClose: () => void;
  /** Devuelven el implante guardado; si falla, lanzan el motivo. */
  onAdvance: (item: Implant) => Promise<Implant>;
  onEditStage: (item: Implant, change: StageChange) => Promise<Implant>;
  onOpenForm: (item: Implant) => void;
  onOpenImage: (image: ClinicalImage) => void;
}) {
  const at = Math.max(0, implants.findIndex(item => item.id === shownId));
  const item = implants[at]!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ index: number; date: string } | null>(null);
  const [direction, setDirection] = useState<"" | "next" | "previous">("");
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number; handle: boolean } | null>(null);
  const working = useRef(false);
  const timer = useRef(0);

  // El fondo no se desplaza mientras la ventana está abierta y al cerrar vuelve el foco a donde estaba.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => { window.clearTimeout(timer.current); document.body.style.overflow = overflow; before?.focus?.({ preventScroll: true }); };
  }, []);
  // Al cambiar de implante no se arrastra nada del anterior.
  useEffect(() => { setEditing(null); setError(""); setNotice(""); body.current?.scrollTo(0, 0); }, [item.id]);

  const close = useCallback(() => { setClosing(true); timer.current = window.setTimeout(onClose, 200); }, [onClose]);
  const go = useCallback((step: 1 | -1) => {
    const next = implants[at + step];
    if (!next || working.current) return;
    setDirection(step > 0 ? "next" : "previous"); onShow(next.id);
  }, [implants, at, onShow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (covered) return;
      if (event.key === "Escape") { if (editing) setEditing(null); else close(); return; }
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, editing, close, go]);

  /** Deslizar a los lados cambia de implante; hacia abajo desde la cabecera, cierra. */
  const onTouchStart = (event: TouchEvent) => {
    const start = event.touches.length === 1 ? event.touches[0]! : null, target = event.target as Element;
    touch.current = start && !target.closest("input") ? { x: start.clientX, y: start.clientY, handle: !!target.closest("[data-sheet-handle]") } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current, end = event.changedTouches[0];
    touch.current = null;
    if (!start || !end) return;
    const dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (start.handle && dy > 80 && dy > 1.5 * Math.abs(dx)) close();
  };

  const run = async (work: () => Promise<Implant>, done: (saved: Implant) => string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { const saved = await work(); setEditing(null); setNotice(done(saved)); }
    catch (reason) { setEditing(null); setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio."); }
    finally { working.current = false; setBusy(false); }
  };

  const advance = () => void run(() => onAdvance(item), saved => {
    const entry = saved.history.at(-1);
    return entry ? `Anotado: ${phaseLabel(entry.phase)}, ${entry.date === today ? "hoy" : dayLabel(entry.date)}. Puedes corregir la fecha en el historial.` : "Etapa actualizada.";
  });
  const saveDate = (index: number, entry: PhaseEntry, to: string) => void run(() => onEditStage(item, { index, phase: entry.phase, date: entry.date, to }), () => "Fecha corregida.");
  const removeEntry = (index: number, entry: PhaseEntry) => {
    const current = index === item.history.length - 1 && entry.phase === item.phase;
    const back = item.history[index - 1];
    const after = !current ? "" : back ? ` El implante volverá a «${phaseLabel(back.phase)}».` : " La etapa quedará sin registrar.";
    if (!window.confirm(`¿Desea eliminar «${phaseLabel(entry.phase)} · ${dayLabel(entry.date)}» del historial?${after}`)) return;
    void run(() => onEditStage(item, { index, phase: entry.phase, date: entry.date, remove: true }), () => "Entrada eliminada del historial.");
  };

  const step = IMPLANT_PHASES.findIndex(phase => phase.id === item.phase);
  const next = nextPhase(item.phase);
  const trace = [label?.lot && `Lote ${label.lot}`, label?.serial && `Serie ${label.serial}`, label?.reference && `Ref. ${label.reference}`, item.torque !== null && `Torque ${item.torque} Ncm`, item.isq !== null && `ISQ ${item.isq}`].filter(Boolean).join(" · ");
  // La instalación se muestra mientras ninguna entrada de cirugía diga la misma fecha; si difieren, se ofrece igualarlas.
  const installed = item.placedOn && !item.history.some(entry => entry.phase === "cirugia" && entry.date === item.placedOn) ? item.placedOn : "";
  const surgery = item.history.reduce((found, entry, index) => entry.phase === "cirugia" ? index : found, -1);
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
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Implante ${item.tooth} de ${patientName}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
          className="gd-implant relative flex max-h-[92dvh] w-full touch-pan-y flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl">
          <div data-sheet-handle className="touch-none select-none border-b border-[#ebe9f2] px-4 pb-2">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[#d8d3e3] sm:hidden" aria-hidden="true"/>
            <div className="flex items-center gap-1 pt-1">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-[#2b2540]" data-testid="implant-sheet-title">Implante {item.tooth}</h2>
                <p className="truncate text-xs text-[#6b6a7c]">{patientName}</p>
              </div>
              {implants.length > 1 && <div className="flex items-center" role="group" aria-label="Cambiar de implante">
                <button type="button" className={arrow} disabled={at === 0 || busy} onClick={() => go(-1)} aria-label="Implante anterior"><ChevronLeft className="size-5" aria-hidden="true"/></button>
                <span className="whitespace-nowrap text-sm text-[#615f73]" aria-live="polite">{at + 1} de {implants.length}</span>
                <button type="button" className={arrow} disabled={at === implants.length - 1 || busy} onClick={() => go(1)} aria-label="Implante siguiente"><ChevronRight className="size-5" aria-hidden="true"/></button>
              </div>}
              <button type="button" className={arrow} onClick={close} aria-label="Cerrar"><X className="size-5" aria-hidden="true"/></button>
            </div>
          </div>

          <div ref={body} className="flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3">
            <div key={item.id} className={`space-y-4 ${direction ? `gd-implant-${direction}` : ""}`}>
              <ImplantIdBox item={item} extra={trace}/>

              <div>
                <div className="flex gap-1" aria-hidden="true">{IMPLANT_PHASES.map((phase, i) => <span key={phase.id} className={`h-2 flex-1 rounded-full ${i <= step ? "bg-[#473a6d]" : "bg-[#e6e4ee]"}`}/>)}</div>
                <p className="mt-2 text-sm font-semibold text-[#2b2540]" data-testid="implant-sheet-stage">{step < 0 ? "Etapa sin registrar" : `Etapa actual: ${phaseLabel(item.phase)} · ${step + 1} de ${IMPLANT_PHASES.length}`}</p>
              </div>

              <section aria-label="Historial">
                <h3 className="text-sm font-semibold text-[#2b2540]">Historial</h3>
                <ol className="mt-1 divide-y divide-[#ebe9f2] rounded-xl border border-[#e6e4ee]" data-testid="implant-history">
                  {installed && <li className="flex items-center gap-2 px-3 py-1 text-sm"><span className="flex-1 py-2">Instalación</span><span className="text-[#615f73]">{dayLabel(installed)}</span>
                    {surgery >= 0 && <button type="button" disabled={busy} onClick={() => saveDate(surgery, item.history[surgery]!, installed)} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]">Usar en cirugía</button>}</li>}
                  {!item.history.length && item.phase && <li className="flex items-center justify-between gap-2 px-3 py-3 text-sm"><span>{phaseLabel(item.phase)}</span><span className="text-[#615f73]">sin fecha</span></li>}
                  {!item.history.length && !item.phase && !installed && <li className="px-3 py-3 text-sm text-[#6b6a7c]">Aún no hay etapas anotadas.</li>}
                  {item.history.map((entry, index) => <li key={index} className="px-3 py-1 text-sm">
                    {editing?.index === index ? <div className="space-y-2 py-2">
                      <label className="block font-semibold">Fecha de {phaseLabel(entry.phase).toLocaleLowerCase("es")}
                        <input type="date" max={today} value={editing.date} onChange={e => setEditing({ index, date: e.target.value })} className="mt-1 block min-h-11 w-full min-w-0 appearance-none rounded-lg border border-[#d8d5e4] bg-white px-3 text-base" data-testid="implant-stage-date"/></label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => saveDate(index, entry, editing.date)} className="min-h-11 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white disabled:opacity-50">Guardar fecha</button>
                        <button type="button" disabled={busy} onClick={() => removeEntry(index, entry)} className="min-h-11 rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-800 disabled:opacity-50">Eliminar</button>
                        <button type="button" disabled={busy} onClick={() => setEditing(null)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-[#473a6d]">Cancelar</button>
                      </div>
                    </div> : <div className="flex items-center gap-2">
                      <span className="flex-1">{phaseLabel(entry.phase)}</span><span className="text-[#615f73]">{dayLabel(entry.date)}</span>
                      <button type="button" disabled={busy} onClick={() => setEditing({ index, date: entry.date })} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]" aria-label={`Corregir ${phaseLabel(entry.phase)} ${dayLabel(entry.date)}`}>{entry.date ? "Corregir" : "Poner fecha"}</button>
                    </div>}
                  </li>)}
                </ol>
              </section>

              {item.note && <p className="whitespace-pre-wrap break-words text-sm text-[#57566a]">{item.note}</p>}

              <section aria-label="Imágenes">
                <h3 className="text-sm font-semibold text-[#2b2540]">Imágenes</h3>
                {item.images.length ? <ul className="mt-1 grid grid-cols-2 gap-2">{item.images.map(link => {
                  const image = images.find(found => found.id === link.imageId);
                  return <li key={link.imageId} className="overflow-hidden rounded-xl border border-[#e6e4ee]">
                    {image ? <button type="button" onClick={() => onOpenImage(image)} className="block w-full text-left" aria-label={`Abrir ${link.view}`}>
                      <img src={thumbUrl(image.url)} loading="lazy" alt={`${link.view}, implante ${item.tooth}`} className="h-28 w-full bg-[#1f1b30] object-contain"/>
                      <span className="block px-2 py-1 text-xs font-medium">{link.view}</span></button>
                      : <p className="flex h-28 items-center justify-center text-xs text-[#615f73]">Cargando…</p>}
                  </li>;
                })}</ul> : <p className="mt-1 text-sm text-[#6b6a7c]">Sin imágenes todavía. Se agregan en la ficha completa.</p>}
              </section>
            </div>
          </div>

          <div className="space-y-2 border-t border-[#ebe9f2] px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">
            {warning && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="implant-sheet-warning">{warning}</p>}
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
            {notice && !error && <p role="status" className="rounded-lg bg-[#f3f1f7] p-2 text-sm text-[#473a6d]">{notice}</p>}
            {next && <button type="button" disabled={busy} onClick={advance} data-testid="implant-advance" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>}Pasar a {phaseLabel(next).toLocaleLowerCase("es")}</button>}
            <button type="button" disabled={busy} onClick={() => onOpenForm(item)} data-testid="implant-open-form" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#473a6d] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50">Abrir ficha completa</button>
          </div>
        </div>
      </div>
    </div>, document.body);
}
