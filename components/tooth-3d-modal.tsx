"use client";

import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { formatFdi, type OdontogramSurface, type PerioSiteKey, type PerioTooth, type SurfaceFinding } from "@/app/clinical-data";
import { cariesDetail } from "@/lib/caries";
import { bitingFaceName, chileLabel, innerFaceName, surfaceMarkColor, toothKind, toothKindLabel } from "@/app/tooth-3d-map";

const Tooth3DStage = lazy(() => import("@/components/tooth-3d-stage").then((module) => ({ default: module.Tooth3DStage })));

const CONDITION_LABEL: Record<SurfaceFinding["condition"], string> = {
  not_examined: "Sin examinar",
  sound: "Sin lesión visible",
  caries: "Lesión de caries",
  restored: "Obturación",
  sealant: "Sellante",
  other_restoration: "Otra restauración",
};

type Origin = { top: number; left: number; width: number; height: number };

export function Tooth3DModal({
  tooth,
  status,
  surfaces,
  hasCrown,
  origin,
  onClose,
  returnFocusTo,
  periodontalSites,
}: {
  tooth: number;
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding | undefined>>;
  hasCrown: boolean;
  origin: Origin | null;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
  periodontalSites?: PerioTooth["sites"];
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const focusFrame = useRef<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [grown, setGrown] = useState(reducedMotion);
  const [showPeriodontium, setShowPeriodontium] = useState(true);
  const naturalTooth = status !== "Ausente" && status !== "Implante" && status !== "Implante con pilar";
  useLayoutEffect(() => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    return () => {
      const target = returnFocusTo;
      focusFrame.current = requestAnimationFrame(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [returnFocusTo]);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(media.matches);
    media.addEventListener("change", apply);
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, [tabindex]:not([tabindex='-1'])") ?? []);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const frame = reducedMotion ? 0 : requestAnimationFrame(() => setGrown(true));
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("keydown", onKey);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);
  const dx = origin ? origin.left + origin.width / 2 - window.innerWidth / 2 : 0;
  const dy = origin ? origin.top + origin.height / 2 - window.innerHeight / 2 : 0;
  const placed = reducedMotion || grown || !origin;

  const findings = (["O", "V", "P", "M", "D"] as OdontogramSurface[])
    .filter((surface) => surfaces[surface] && surfaces[surface]?.condition !== "not_examined")
    .map((surface) => {
      const finding = surfaces[surface]!;
      const face = surface === "O" ? bitingFaceName(tooth) : surface === "P" ? innerFaceName(tooth) : surface === "V" ? "Vestibular" : surface === "M" ? "Mesial" : "Distal";
      const detail = finding.condition === "caries" ? ` · ${cariesDetail(finding)}` : "";
      return `${face}: ${CONDITION_LABEL[finding.condition]}${detail}`;
    });
  if (status && status !== "Sin hallazgos") findings.unshift((status === "Implante" || status === "Implante con pilar") && hasCrown ? "Implante con corona" : status === "Implante con pilar" ? "Implante con pilar (sin corona)" : status === "Corona" ? "Corona" : status === "Ausente" ? "Ausente / extraído" : status);
  return <div className="fixed inset-0 z-50" role="presentation">
    <button type="button" className="absolute inset-0 bg-[#10343a]/45" aria-label="Cerrar vista 3D" onClick={onClose} />
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-3d-title"
      className="fixed top-1/2 left-1/2 z-10 flex max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] w-[min(48rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#d5e4e2] bg-white shadow-xl"
      style={{ transform: placed ? "translate(-50%, -50%) scale(1)" : `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.18)`, transition: reducedMotion ? "none" : "transform 480ms ease" }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#e4eeed] px-4 py-3 sm:px-5">
        <div>
          <p id="tooth-3d-title" className="text-lg font-semibold text-[#16343a]">FDI {formatFdi(tooth)} · {chileLabel(tooth)}</p>
          <p className="mt-0.5 text-sm text-[#5d7579]">{toothKindLabel(toothKind(tooth))} · {periodontalSites ? "seis sitios periodontales · solo lectura" : "solo lectura"}</p>
        </div>
        <button ref={closeRef} type="button" className="rounded-lg p-2 text-[#31575b] hover:bg-[#e7f3f1]" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        {naturalTooth && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e2d7d0] bg-[#fffaf7] px-3 py-2">
          <div className="text-xs leading-5 text-[#6b5550]">
            <span className="font-semibold">Periodonto 3D</span>
            <span className="ml-1">{showPeriodontium ? "Hueso alveolar translúcido y ligamento periodontal." : "Vista de la pieza sin capas periodontales."}</span>
          </div>
          <button type="button" aria-pressed={showPeriodontium} onClick={() => setShowPeriodontium((visible) => !visible)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#d5aaa7] bg-white px-3 py-1.5 text-xs font-semibold text-[#6e4144] hover:bg-[#fff0ee]">
            {showPeriodontium ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {showPeriodontium ? "Ocultar periodonto" : "Mostrar periodonto"}
          </button>
        </div>}
        {periodontalSites ? <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-xs sm:gap-2" aria-label="Seis sitios periodontales">
          {(["MV", "V", "DV", "ML", "L", "DL"] as PerioSiteKey[]).map(key => { const reading = periodontalSites[key]; const depth = reading?.depth; const measured = depth !== null && depth !== undefined; const color = !measured ? "#94a3b8" : depth >= 6 ? "#be123c" : depth >= 4 ? "#b45309" : "#047857"; return <div key={key} className="rounded-lg border border-[#e2eaeb] bg-white px-1 py-1.5"><span className="font-semibold">{key}</span><span className="ml-1 font-medium" style={{color}}>{measured ? `${depth} mm` : "sin medir"}</span>{reading?.bleeding && <span className="block text-red-700">Sangrado</span>}{reading?.suppuration && <span className="block text-violet-700">Supuración</span>}</div>; })}
        </div> : findings.length > 0 ? <ul className="mb-3 flex flex-wrap gap-2">{findings.map((line) => <li key={line} className="rounded-full bg-[#f3f7f7] px-3 py-1 text-xs font-medium text-[#31575b]">{line}</li>)}</ul> : <p className="mb-3 text-sm text-[#71858b]">Sin hallazgos registrados en esta pieza.</p>}
        <Suspense fallback={<p className="grid h-[min(52vh,420px)] min-h-64 place-items-center text-sm text-[#71858b]" role="status">Preparando el diente…</p>}>
          {placed && <Tooth3DStage tooth={tooth} status={status} surfaces={surfaces} hasCrown={hasCrown} reducedMotion={reducedMotion} periodontalSites={periodontalSites} showPeriodontium={showPeriodontium} />}
        </Suspense>
        <p className="mt-2 text-xs leading-5 text-[#71858b]">{reducedMotion ? "Arrastra para girar. Acerca con la rueda o con dos dedos. La rotación automática está desactivada." : "El diente gira solo. Arrastra para orientarlo y acerca con la rueda o con dos dedos."}</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-[#52666c]" aria-label="Leyenda de colores">
          {([
            ["Lesión de caries", surfaceMarkColor("caries")],
            ["Obturación", surfaceMarkColor("restored")],
            ["Sellante", surfaceMarkColor("sealant")],
            ["Sin lesión visible", surfaceMarkColor("sound")],
            ["Sin examinar", surfaceMarkColor("not_examined")],
          ] as const).map(([label, color]) => <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-[#e2eaeb] bg-white px-2.5 py-1"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</li>)}
        </ul>
      </div>
    </div>
  </div>;
}
