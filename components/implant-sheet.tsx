"use client";
/* eslint-disable @next/next/no-img-element -- Las imágenes clínicas son rutas autenticadas que se cargan con la sesión del navegador. */
/**
 * Ventana de un implante (hoja que sube desde abajo en el teléfono): todo lo de ese implante está aquí, en dos secciones
 * (etapas, cada una con lo que se usó en ella, e imágenes). Se pasa de un implante a otro deslizando o con las flechas.
 * Nada cambia sin un toque del profesional; quitar una marca y descartar lo escrito piden confirmación.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDot, ImagePlus, Trash2, X } from "lucide-react";
import type { ClinicalImage } from "@/app/clinical-data";
import { thumbUrl } from "@/lib/image-compress";
import { pieceSummary, stagePieces, type Piece } from "@/lib/implant-pieces";
import { MAX_STAGE_NOTE, connectionText, implantSize, phaseLabel, stageMarks, stageOptions, type Implant, type RecordedPhase, type StageChange } from "@/lib/implants";

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
 * Las etapas del implante, cada una con lo que se usó en ella y su fecha. Tocar una abre su pantalla;
 * la actual es la más avanzada marcada.
 */
export function StageList({ item, pieces, onOpen }: { item: Implant; pieces: readonly Piece[]; onOpen: (phase: RecordedPhase) => void }) {
  const marks = stageMarks(item.history, item.phase, item.placedOn);
  const stages = stageOptions(listedStages(item, pieces, marks));
  return <div data-testid="implant-stages">
    <p className="text-sm text-[#615f73]">Toca una etapa para anotar lo que usaste y su fecha.</p>
    <ol className="mt-1 divide-y divide-[#ebe9f2]">{stages.map(phase => {
      const day = marks[phase.id], marked = day !== undefined, current = item.phase === phase.id;
      const installed = phase.id === "cirugia" ? item.placedOn : "";
      const images = item.images.filter(image => image.stage === phase.id).length;
      const summary = [pieceSummary(stagePieces(pieces, item, phase.id)), images && (images === 1 ? "1 imagen" : `${images} imágenes`), item.stageNotes[phase.id] && "nota"].filter(Boolean).join(" · ");
      const Icon = current ? CircleDot : marked ? CircleCheck : Circle;
      return <li key={phase.id}>
        <button type="button" onClick={() => onOpen(phase.id)} data-testid={`implant-stage-${phase.id}`} data-state={current ? "actual" : marked ? "marcada" : "sin-marcar"}
          className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-base ${current ? "text-[#473a6d]" : "text-[#2b2540]"}`}>
          <Icon className={`size-5 shrink-0 ${marked ? "text-[#473a6d]" : "text-[#b4b0c4]"}`} aria-hidden="true"/>
          <span className="min-w-0 flex-1">
            <span className={`block ${current ? "font-semibold" : ""}`}>{phase.label}{current && " (actual)"}</span>
            {summary && <span className="block break-words text-sm text-[#615f73]" data-testid="implant-stage-summary">{summary}</span>}
          </span>
          <span className={`shrink-0 text-right text-sm ${marked ? "text-[#615f73]" : "text-[#8a879b]"}`}>{marked ? dayLabel(day) : installed ? `instalado ${dayLabel(installed)}` : ""}</span>
          <ChevronRight className="size-4 shrink-0 text-[#8a879b]" aria-hidden="true"/>
        </button>
      </li>;
    })}</ol>
  </div>;
}

/** Una etapa retirada se sigue mostrando si está marcada o tiene algo anotado. */
function listedStages(item: Implant, pieces: readonly Piece[], marks: Partial<Record<RecordedPhase, string>>): string[] {
  return [...Object.keys(marks), ...Object.keys(item.stageNotes), ...item.images.flatMap(image => image.stage ?? []),
    ...pieces.filter(piece => piece.implantId === item.id).map(piece => piece.stage)];
}

/** Lo que se está escribiendo en la pantalla de una etapa; null = sin tocar. */
export type StageEdit = {
  phase: RecordedPhase; date: string | null; note: string | null;
  /** Lo que estaba guardado cuando se empezó a escribir: si cambió en otro lado, se muestra y no se pisa solo. */
  dateFrom?: string | null; noteFrom?: string;
  /** Imágenes pegadas en esta etapa que esperan que se diga qué son. */
  pasted?: File[];
};

/** Fecha que muestra una etapa: la escrita, la guardada o la que se propone (hoy; en cirugía, la de instalación si está). */
export function stageDate(item: Implant, edit: StageEdit, today: string): string {
  return edit.date ?? stageMarks(item.history, item.phase, item.placedOn)[edit.phase] ?? (edit.phase === "cirugia" && item.placedOn ? item.placedOn : today);
}

/** ¿Queda una fecha escrita, una nota o una imagen pegada sin guardar? */
export function stagePending(item: Implant, edit: StageEdit | null, today: string): boolean {
  if (!edit) return false;
  const shown = stageMarks(item.history, item.phase, item.placedOn)[edit.phase] ?? stageDate(item, { ...edit, date: null }, today);
  return !!edit.pasted?.length || (edit.note !== null && edit.note.trim() !== (item.stageNotes[edit.phase] ?? "")) || (edit.date !== null && edit.date !== shown);
}

/**
 * Pantalla de una etapa: su fecha, lo que se usó (lo pone quien la contiene), sus imágenes y su nota.
 * Nada es obligatorio; anotar algo nuevo marca la etapa.
 */
export function StagePage({ item, edit, today, busy, images, onEdit, onBack, onChange, onNote, onImages, onOpenImage, onRemoveImage, children }: {
  item: Implant; edit: StageEdit; today: string; busy: boolean;
  images: ClinicalImage[];
  onEdit: (change: Partial<StageEdit>) => void;
  onBack: () => void;
  /** Devuelve true si quedó guardado. */
  onChange: (change: StageChange) => Promise<boolean>;
  /** `was`: la nota guardada que el profesional vio y decidió reemplazar. */
  onNote: (was?: string) => void;
  onImages: (files: File[], view: "Radiografía" | "Foto clínica") => void;
  onOpenImage: (image: ClinicalImage) => void;
  onRemoveImage: (id: number) => void;
  children: ReactNode;
}) {
  const marks = stageMarks(item.history, item.phase, item.placedOn);
  const day = marks[edit.phase], marked = day !== undefined, label = phaseLabel(edit.phase);
  const date = stageDate(item, edit, today), installed = edit.phase === "cirugia" ? item.placedOn : "";
  const note = edit.note ?? item.stageNotes[edit.phase] ?? "";
  const saved = item.stageNotes[edit.phase] ?? "";
  const noteChanged = note.trim() !== saved;
  const noteConflict = noteChanged && edit.note !== null && edit.noteFrom !== undefined && edit.noteFrom !== saved;
  const dateConflict = edit.date !== null && edit.dateFrom !== undefined && edit.dateFrom !== (day ?? null) && edit.date !== day;
  const mine = item.images.filter(image => image.stage === edit.phase);
  const radiograph = useRef<HTMLInputElement | null>(null);
  const clinical = useRef<HTMLInputElement | null>(null);
  const save = async (change: StageChange) => { if (await onChange(change)) onEdit({ date: null }); };
  const remove = () => {
    const rest = stageOptions(Object.keys(marks)).filter(other => other.id !== edit.phase && marks[other.id] !== undefined).at(-1);
    const after = edit.phase !== item.phase ? "" : rest ? ` La etapa actual quedará en «${rest.label}».` : " El implante quedará sin etapa registrada.";
    const placed = installed ? ` También se borra la fecha de instalación (${dayLabel(installed)}).` : "";
    if (window.confirm(`¿Desea eliminar la marca de «${label}»?${after}${placed} Lo anotado en la etapa se conserva.`)) void save({ phase: edit.phase, was: day ?? null, remove: true });
  };
  const pick = (view: "Radiografía" | "Foto clínica") => (event: ChangeEvent<HTMLInputElement>) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) onImages(files, view); };
  const action = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] bg-white px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

  return <div className="space-y-4" data-testid="implant-stage-page" data-stage={edit.phase}>
    <div>
      <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#473a6d]" data-testid="implant-stage-back"><ChevronLeft className="size-5" aria-hidden="true"/>Etapas</button>
      <h3 className="text-lg font-bold text-[#2b2540]" data-testid="implant-stage-title">{label}{item.phase === edit.phase && <span className="ml-2 text-sm font-semibold text-[#473a6d]">etapa actual</span>}</h3>
    </div>
    <div className="space-y-2 rounded-xl bg-[#f3f1f7] p-3" data-testid="implant-stage-editor">
      <label className="block text-sm font-semibold text-[#473a6d]">{edit.phase === "cirugia" ? "Fecha de cirugía (instalación)" : `Fecha de ${label.toLocaleLowerCase("es")}`}
        <input type="date" max={today} value={date} onChange={e => onEdit({ date: e.target.value, ...(edit.date === null ? { dateFrom: day ?? null } : {}) })} className="mt-1 block min-h-11 w-full min-w-0 max-w-full appearance-none rounded-lg border border-[#d8d5e4] bg-white px-3 text-base font-normal text-[#2b2540]" data-testid="implant-stage-date"/></label>
      {!date && <p className="text-xs text-[#615f73]">Sin fecha: la etapa queda marcada sin día.</p>}
      {installed && marked && installed !== day && <button type="button" disabled={busy} onClick={() => void save({ phase: edit.phase, was: day, date: installed })} className="block min-h-11 text-left text-sm font-semibold text-[#473a6d] underline">La instalación dice {dayLabel(installed)}: usar esa fecha</button>}
      {dateConflict ? <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert" data-testid="stage-date-conflict">
        <p>Mientras escribías, esta etapa quedó guardada {marked ? (day ? `con fecha ${dayLabel(day)}` : "sin fecha") : "sin marca"}.</p>
        <button type="button" disabled={busy} className={`${action} w-full`} onClick={() => void save({ phase: edit.phase, was: day ?? null, date })}>Reemplazar con {date ? dayLabel(date) : "sin fecha"}</button>
        <button type="button" disabled={busy} className={`${action} w-full`} onClick={() => onEdit({ date: null })}>Dejar lo guardado</button>
      </div> : (!marked || date !== day) ? <button type="button" disabled={busy} onClick={() => void save({ phase: edit.phase, was: day ?? null, date })} data-testid="implant-stage-save"
        className="min-h-11 w-full rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{marked ? "Guardar fecha" : "Marcar etapa"}</button>
        : <p className="text-xs text-[#615f73]">Etapa marcada.</p>}
    </div>

    {children}

    <section className="space-y-2" data-testid="stage-images"><h4 className="font-semibold">Radiografías y fotos</h4>
      {mine.length > 0 && <ul className="grid grid-cols-2 gap-2">{mine.map(entry => {
        const image = images.find(found => found.id === entry.imageId);
        return <li key={entry.imageId} className="overflow-hidden rounded-xl border border-[#e6e4ee] bg-white">
          {image ? <button type="button" className="block h-24 w-full bg-[#1f1b30]" onClick={() => onOpenImage(image)} aria-label={`Abrir ${entry.view}`}><img src={thumbUrl(image.url)} loading="lazy" alt={`${entry.view}, ${label}, implante ${item.tooth}`} className="h-24 w-full object-contain"/></button> : <p className="flex h-24 items-center justify-center text-xs text-[#615f73]">Cargando…</p>}
          <div className="flex items-center justify-between gap-1 pl-2"><span className="truncate text-xs">{entry.view}</span><button type="button" disabled={busy} className="rounded-lg p-3 text-rose-800 hover:bg-rose-50" aria-label={`Eliminar imagen ${entry.view}`} onClick={() => onRemoveImage(entry.imageId)}><Trash2 className="size-4" aria-hidden="true"/></button></div>
        </li>;
      })}</ul>}
      {!!edit.pasted?.length && <div className="space-y-2 rounded-xl border border-[#473a6d] bg-[#f7f5fb] p-3" data-testid="stage-pasted" ref={node => node?.scrollIntoView({ block: "nearest" })}>
        <p className="text-sm font-semibold">{edit.pasted.length === 1 ? "Imagen pegada. ¿Qué es?" : `${edit.pasted.length} imágenes pegadas. ¿Qué son?`}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={action} disabled={busy} onClick={() => onImages(edit.pasted!, "Radiografía")}>Radiografía</button>
          <button type="button" className={action} disabled={busy} onClick={() => onImages(edit.pasted!, "Foto clínica")}>Foto clínica</button>
        </div>
        <button type="button" disabled={busy} className="min-h-11 w-full text-sm font-semibold text-rose-800" onClick={() => onEdit({ pasted: undefined })}>No guardar</button>
      </div>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={action} disabled={busy} onClick={() => radiograph.current?.click()}><ImagePlus className="size-4" aria-hidden="true"/>Radiografía</button>
        <button type="button" className={action} disabled={busy} onClick={() => clinical.current?.click()}><Camera className="size-4" aria-hidden="true"/>Foto clínica</button>
        <input ref={radiograph} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick("Radiografía")} data-testid="stage-radiograph-input"/>
        <input ref={clinical} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick("Foto clínica")} data-testid="stage-photo-input"/>
      </div>
    </section>

    <div className="space-y-2">
      <label className="block text-sm font-semibold">Nota de esta etapa (opcional)<textarea rows={3} value={note} maxLength={MAX_STAGE_NOTE} onChange={e => onEdit({ note: e.target.value, ...(edit.note === null ? { noteFrom: saved } : {}) })} className="mt-1 block w-full rounded-lg border border-[#d8d5e4] bg-white px-3 py-2 text-base font-normal" data-testid="stage-note"/></label>
      {noteConflict ? <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert" data-testid="stage-note-conflict">
        <p>Mientras escribías se guardó otra nota{saved ? ":" : " vacía (se borró)."}</p>
        {saved && <p className="whitespace-pre-wrap break-words rounded bg-white p-2">{saved}</p>}
        <button type="button" disabled={busy} className={`${action} w-full`} onClick={() => onNote(saved)}>Reemplazar con la mía</button>
        <button type="button" disabled={busy} className={`${action} w-full`} onClick={() => onEdit({ note: null })}>Dejar la guardada</button>
      </div> : noteChanged && <button type="button" disabled={busy} onClick={() => onNote()} className="min-h-11 w-full rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="stage-note-save">Guardar nota</button>}
    </div>
    {marked && <button type="button" disabled={busy} onClick={remove} data-testid="implant-stage-remove" className="min-h-11 w-full text-sm font-semibold text-rose-800">Quitar marca de la etapa</button>}
  </div>;
}

export type SheetTab = "etapas" | "datos" | "imagenes";

export function ImplantSheet({ title, patientName, position, summary, tabs, tab, onTab, scrollKey, covered, locked, onStep, canClose, onClosed, footer, children }: {
  title: string;
  patientName: string;
  /** Lugar de este implante entre los del paciente; null en una ficha nueva. */
  position: { at: number; total: number } | null;
  /** Recuadro de identificación: se ve en todas las secciones. */
  summary?: ReactNode;
  /** null en una ficha nueva (solo sus datos) y dentro de una etapa (se vuelve con «Etapas»). */
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
