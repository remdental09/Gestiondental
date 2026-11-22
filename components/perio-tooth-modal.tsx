"use client";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Mic, X } from "lucide-react";
import { formatFdi, type PerioExam, type PerioSiteKey, type PerioTooth, type ToothHistoryEvent } from "@/app/clinical-data";
import { depthTone } from "@/app/perio-arch-layout";
import { PerioToothScene } from "@/components/perio-arch";
import { ToothTimeline } from "@/components/tooth-timeline";
import { ToothStory } from "@/components/tooth-story";

const KIND = ["Incisivo central", "Incisivo lateral", "Canino", "Primer premolar", "Segundo premolar", "Primer molar", "Segundo molar", "Tercer molar"];
const TONE = { none: "text-slate-500", ok: "text-emerald-700", warn: "text-amber-700", crit: "text-rose-700" } as const;

/** Análisis unitario de una pieza del periodontograma: la misma imagen de la arcada, aislada y ampliada. Solo lectura. */
export function PerioToothModal({ tooth, chile, status, data, exams, toothHistory, onClose, returnFocusTo, onDeleteReading, onEditReading, onDictate, live, face }: {
  tooth: number; chile: number; status: string; data: PerioTooth | undefined; exams: PerioExam[]; toothHistory: ToothHistoryEvent[];
  onClose: () => void; returnFocusTo: HTMLElement | null;
  /** Cierra la ventana y dicta el periodontograma solo de esta pieza. */
  onDictate?: (tooth: number) => void;
  /** Dictado guiado en curso: panel grande de lectura en lugar de la evolución de la pieza. */
  live?: ReactNode;
  /** Cara que pide el dictado (cambia sola la vista). */
  face?: "vestibular" | "lingual";
  onDeleteReading?: (tooth: number, examId: number, day: string) => Promise<void>;
  onEditReading?: (tooth: number, examId: number, reading: PerioTooth, clinicalDate: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => () => { const target = returnFocusTo; requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); }); }, [returnFocusTo]);
  useLayoutEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key === "Tab") {
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <div className="fixed inset-0 z-50" role="presentation">
    <button type="button" className="absolute inset-0 bg-[#171127]/55" aria-label="Cerrar la pieza" onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="perio-tooth-title" className="fixed top-1/2 left-1/2 z-10 flex max-h-[92vh] w-[min(68rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-[#dddbe6] bg-white shadow-xl supports-[height:1dvh]:max-h-[92dvh]">
      <div className="flex items-start justify-between gap-3 border-b border-[#e6e4ee] px-4 py-3 sm:px-5">
        <div>
          {onDictate && !live && <button type="button" onClick={() => onDictate(tooth)} data-testid="perio-modal-dictate" className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#473a6d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3a2f5a]"><Mic className="size-4" aria-hidden="true" />Dictar periodontograma de esta pieza</button>}
          <p id="perio-tooth-title" className="text-lg font-semibold text-[#2a2540]">FDI {formatFdi(tooth)} · Chile {chile}</p>
          <p className="mt-0.5 text-sm text-[#615f73]">{KIND[(tooth % 10) - 1]} · {live ? "dictado guiado en curso" : "análisis periodontal de la pieza · solo lectura"}</p>
        </div>
        <button ref={closeRef} type="button" className="rounded-lg p-2 text-[#3b3355] hover:bg-[#efeef4]" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        <div className={`grid grid-cols-1 gap-4 ${live ? "md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"}`}>
          <div className="min-w-0 space-y-3">
            <PerioToothScene tooth={tooth} data={data} status={status} requestedFace={face} />
            <div className="grid grid-cols-3 gap-1.5 text-center text-xs" aria-label="Seis sitios periodontales">
              {(["DV", "V", "MV", "DL", "L", "ML"] as PerioSiteKey[]).map(key => {
                const reading = data?.sites[key], depth = reading?.depth ?? null, margin = reading?.margin ?? null;
                return <div key={key} className="rounded-lg border border-[#e6e4ee] px-1 py-1.5">
                  <span className="font-semibold text-[#3b3355]">{key}</span>{" "}
                  {depth === null ? <span className="text-slate-400">2 mm (normal)</span> : <span className={`font-semibold ${TONE[depthTone(depth)]}`}>{depth} mm</span>}
                  <span className="block text-[11px] text-[#615f73]">{depth === null ? "sin medir" : `margen ${margin ?? 0} · inserción ${depth + (margin ?? 0)}`}{reading?.bleeding ? " · sangra" : ""}{reading?.suppuration ? " · supura" : ""}</span>
                </div>;
              })}
            </div>
            <p className="text-[11px] leading-4 text-[#615f73]">La cresta ósea es una estimación (nivel de inserción; 2 mm bajo la UAC si está sano); la altura real se confirma con radiografía. Las medidas se editan en el panel de la pieza.</p>
          </div>
          {live ? <div className="order-first min-w-0 md:order-none">{live}</div> : <div className="min-w-0"><ToothStory tooth={tooth} history={toothHistory} size="compact" /><ToothTimeline tooth={tooth} history={toothHistory} exams={exams} mode="periodontograma" onDeleteReading={onDeleteReading} onEditReading={onEditReading} /></div>}
        </div>
      </div>
    </div>
  </div>;
}
