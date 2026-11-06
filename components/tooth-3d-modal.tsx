"use client";

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FullArch3DStage } from "@/components/full-arch-3d-stage";
import { Eye, EyeOff, X } from "lucide-react";
import { formatFdi, type CrownDetails, type OdontogramSurface, type PerioExam, type PerioSiteKey, type PerioTooth, type SurfaceFinding, type ToothHistoryEvent } from "@/app/clinical-data";
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

const formatHistoryDate = (clinicalDate: string | undefined, recordedAt: string) => {
  const source = clinicalDate ? `${clinicalDate}T12:00:00` : recordedAt;
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(date) : "Fecha no consignada";
};

export function Tooth3DModal({
  tooth,
  status,
  surfaces,
  hasCrown,
  origin,
  onClose,
  returnFocusTo,
  periodontalSites,
  toothHistory = [],
  periodontalHistory,
  crown,
  onSetCrownDetails,
}: {
  tooth: number;
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding | undefined>>;
  hasCrown: boolean;
  origin: Origin | null;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
  periodontalSites?: PerioTooth["sites"];
  toothHistory?: ToothHistoryEvent[];
  periodontalHistory?: PerioExam[];
  crown?: CrownDetails;
  onSetCrownDetails?: (tooth: number, material: string, shade: string, foundation: "tooth" | "implant") => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const focusFrame = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [grown, setGrown] = useState(reducedMotion);
  const [showPeriodontium, setShowPeriodontium] = useState(true);
  const [periodontiumOpacity, setPeriodontiumOpacity] = useState(1);
  const [fullArch, setFullArch] = useState(false);
  const propCrownFoundation = crown?.foundation === "implant" ? "implant" : "tooth";
  const crownFoundationKey = `${tooth}|${propCrownFoundation}|${crown?.material ?? ""}|${crown?.shade ?? ""}|${crown?.source ?? ""}`;
  const [crownFoundationDraft, setCrownFoundationDraft] = useState<{ key: string; value: "tooth" | "implant" } | null>(null);
  const crownFoundation = crownFoundationDraft?.key === crownFoundationKey ? crownFoundationDraft.value : propCrownFoundation;
  const [savingCrown, setSavingCrown] = useState(false);
  const [crownMessage, setCrownMessage] = useState("");
  const saveCrownFoundation = async () => {
    if (!onSetCrownDetails || !crown) return;
    setSavingCrown(true);
    setCrownMessage("");
    try {
      await onSetCrownDetails(tooth, crown.material, crown.shade ?? "", crownFoundation);
      setCrownMessage("Corrección guardada y releída en el odontograma.");
    } catch (error) {
      setCrownMessage(error instanceof Error ? error.message : "No se pudo guardar la corrección.");
    } finally {
      setSavingCrown(false);
    }
  };
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
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
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
  const sortedToothHistory = [...toothHistory].filter(event => event.tooth === tooth).sort((a,b) => new Date(b.clinicalDate ? `${b.clinicalDate}T12:00:00` : b.recordedAt).getTime() - new Date(a.clinicalDate ? `${a.clinicalDate}T12:00:00` : a.recordedAt).getTime());
  const sortedPerioHistory = [...(periodontalHistory ?? [])].filter(exam => exam.teeth?.[tooth]).sort((a,b) => b.recordedAt.localeCompare(a.recordedAt));
  const findingLabel = (finding?: SurfaceFinding) => {
    if (!finding) return "Sin registro";
    const caries = finding.condition === "caries" ? " · " + cariesDetail(finding) : "";
    const restoration = finding.condition === "restored" ? [
      finding.restorationStage === "provisional" ? "provisoria" : finding.restorationStage === "definitive" ? "definitiva" : "",
      finding.restorationMaterial ?? "",
    ].filter(Boolean) : [];
    return CONDITION_LABEL[finding.condition] + caries + (restoration.length ? " · " + restoration.join(" · ") : "");
  };
  const eventDescription = (event: ToothHistoryEvent) => {
    const after = event.after;
    if (event.eventType === "diagnosis") return [event.title ? `Diagnóstico: ${event.title}` : "Diagnóstico consignado", event.detail].filter(Boolean).join(" · ");
    if (event.eventType === "surface" && event.surface) {
      const face = event.surface === "O" ? bitingFaceName(tooth) : event.surface === "P" ? innerFaceName(tooth) : event.surface === "V" ? "Vestibular" : event.surface === "M" ? "Mesial" : "Distal";
      const transition = findingLabel(event.before?.surfaces[event.surface]) + " → " + findingLabel(after?.surfaces[event.surface]);
      return face + ": " + (event.title ? event.title + " · " : "") + transition;
    }
    if (event.eventType === "status") return `${event.before?.status ?? "Sin hallazgos"} → ${after?.status ?? "Sin hallazgos"}`;
    if (event.eventType === "missing_reason") return event.title ?? `Causa de ausencia: ${after?.missingReason ?? "sin especificar"}`;
    if (event.eventType === "crown") return `${event.title ?? "Corona"}${after?.crown?.material ? ` · ${after.crown.material}` : ""}`;
    const state = after?.status && after.status !== "Sin hallazgos" ? after.status : "Estado actualizado";
    return `${event.title ?? state}${after?.crown?.material ? ` · ${after.crown.material}` : ""}`;
  };
  const perioDetails = (exam: PerioExam) => {
    const record = exam.teeth?.[tooth];
    if (!record) return [];
    const sites: PerioSiteKey[] = ["MV", "V", "DV", "ML", "L", "DL"];
    const readings = sites.flatMap(key => {
      const reading = record.sites?.[key];
      if (!reading) return [];
      const parts = [`${key}: ${reading.depth === null || reading.depth === undefined ? "—" : `${reading.depth} mm`}`];
      if (reading.margin !== null && reading.margin !== undefined) parts.push(`margen ${reading.margin} mm`);
      if (reading.bleeding) parts.push("sangrado");
      if (reading.suppuration) parts.push("supuración");
      return [parts.join(" · ")];
    });
    const gingival = Object.entries(record.gingivalIndex ?? {}).map(([site,score]) => `IG ${site}: ${score}`);
    return [...readings, ...gingival, record.mobility ? `Movilidad: ${record.mobility}` : "", record.furcation ? `Furcación: ${record.furcation}` : ""].filter(Boolean);
  };
  return <div className="fixed inset-0 z-50" role="presentation">
    <button type="button" className="absolute inset-0 bg-[#10343a]/45" aria-label="Cerrar vista 3D" onClick={onClose} />
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-3d-title"
      className="fixed top-1/2 left-1/2 z-10 flex max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] w-[min(68rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#d5e4e2] bg-white shadow-xl"
      style={{ transform: placed ? "translate(-50%, -50%) scale(1)" : `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.18)`, transition: reducedMotion ? "none" : "transform 480ms ease" }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#e4eeed] px-4 py-3 sm:px-5">
        <div>
          <p id="tooth-3d-title" className="text-lg font-semibold text-[#16343a]">FDI {formatFdi(tooth)} · {chileLabel(tooth)}</p>
          <p className="mt-0.5 text-sm text-[#5d7579]">{toothKindLabel(toothKind(tooth))} · {periodontalSites ? "seis sitios periodontales · solo lectura" : onSetCrownDetails ? "vista 3D · odontograma editable" : "solo lectura"}</p>
        </div>
        <button ref={closeRef} type="button" className="rounded-lg p-2 text-[#31575b] hover:bg-[#e7f3f1]" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div className="min-w-0">
        {naturalTooth && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e2d7d0] bg-[#fffaf7] px-3 py-2">
          <div className="text-xs leading-5 text-[#6b5550]">
            <span className="font-semibold">Periodonto 3D</span>
            <span className="ml-1">{showPeriodontium ? "Encía, hueso alveolar y ligamento periodontal translúcidos." : "Vista de la pieza sin capas periodontales."}</span>
          </div>
          <button type="button" aria-pressed={showPeriodontium} onClick={() => setShowPeriodontium((visible) => !visible)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#d5aaa7] bg-white px-3 py-1.5 text-xs font-semibold text-[#6e4144] hover:bg-[#fff0ee]">
            {showPeriodontium ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {showPeriodontium ? "Ocultar periodonto" : "Mostrar periodonto"}
          </button>
          {showPeriodontium && <label className="flex w-full items-center gap-2 text-xs font-medium text-[#6b5550]">
            <span className="shrink-0">Ver el diente por dentro</span>
            <input type="range" min={10} max={100} step={5} value={Math.round(periodontiumOpacity * 100)} onChange={(event) => setPeriodontiumOpacity(Number(event.target.value) / 100)} className="h-2 min-w-0 flex-1 accent-[#b85c64]" aria-label="Opacidad del periodonto" />
            <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(periodontiumOpacity * 100)} %</span>
          </label>}
        </div>}
        {periodontalSites ? <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-xs sm:gap-2" aria-label="Seis sitios periodontales">
          {(["MV", "V", "DV", "ML", "L", "DL"] as PerioSiteKey[]).map(key => { const reading = periodontalSites[key]; const depth = reading?.depth; const measured = depth !== null && depth !== undefined; const color = !measured ? "#94a3b8" : depth >= 6 ? "#be123c" : depth >= 4 ? "#b45309" : "#047857"; return <div key={key} className="rounded-lg border border-[#e2eaeb] bg-white px-1 py-1.5"><span className="font-semibold">{key}</span><span className="ml-1 font-medium" style={{color}}>{measured ? `${depth} mm` : "sin medir"}</span>{reading?.bleeding && <span className="block text-red-700">Sangrado</span>}{reading?.suppuration && <span className="block text-violet-700">Supuración</span>}</div>; })}
        </div> : findings.length > 0 ? <ul className="mb-3 flex flex-wrap gap-2">{findings.map((line) => <li key={line} className="rounded-full bg-[#f3f7f7] px-3 py-1 text-xs font-medium text-[#31575b]">{line}</li>)}</ul> : <p className="mb-3 text-sm text-[#71858b]">Sin hallazgos registrados en esta pieza.</p>}
        <div className="mb-2 flex gap-2" role="group" aria-label="Vista del odontograma 3D"><button type="button" onClick={() => setFullArch(false)} aria-pressed={!fullArch} className={`rounded-lg border px-3 py-1.5 text-sm ${!fullArch ? "border-[#087f83] bg-[#e7f5f3] text-[#075b60]" : "border-[#d8e3e3] bg-white text-[#52666c]"}`}>Pieza seleccionada</button><button type="button" onClick={() => setFullArch(true)} aria-pressed={fullArch} className={`rounded-lg border px-3 py-1.5 text-sm ${fullArch ? "border-[#087f83] bg-[#e7f5f3] text-[#075b60]" : "border-[#d8e3e3] bg-white text-[#52666c]"}`}>Todas las piezas en hueso</button></div>
        {fullArch ? <FullArch3DStage reducedMotion={reducedMotion} /> : <Suspense fallback={<p className="grid h-[min(42vh,360px)] min-h-56 place-items-center text-sm text-[#71858b]" role="status">Preparando el diente…</p>}>
          {placed && <Tooth3DStage tooth={tooth} status={status} surfaces={surfaces} hasCrown={hasCrown} reducedMotion={reducedMotion} periodontalSites={periodontalSites} showPeriodontium={showPeriodontium} periodontiumOpacity={periodontiumOpacity} />}
        </Suspense>}
        <p className="mt-2 text-xs leading-5 text-[#71858b]">{reducedMotion ? "Arrastra para girar. Acerca con la rueda o con dos dedos. La rotación automática está desactivada." : "Las piezas giran juntas con la arcada. Arrastra para orientarlas y acerca con la rueda o con dos dedos."}</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-[#52666c]" aria-label="Leyenda de colores">
          {([
            ["Lesión de caries", surfaceMarkColor("caries")],
            ["Obturación", surfaceMarkColor("restored")],
            ["Restauración provisoria", "#e6a14a"],
            ["Sellante", surfaceMarkColor("sealant")],
            ["Sin lesión visible", surfaceMarkColor("sound")],
            ["Sin examinar", surfaceMarkColor("not_examined")],
          ] as const).map(([label, color]) => <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-[#e2eaeb] bg-white px-2.5 py-1"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</li>)}
        </ul>
        </div>
        <aside className="min-w-0 space-y-4" aria-label={`Historia clínica de la pieza FDI ${formatFdi(tooth)}`}>
          <section className="rounded-xl border border-[#dbe8e7] bg-[#f8fbfb] p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-[#16343a]">Evolución de la pieza</h3>
            <p className="mt-1 text-xs leading-5 text-[#71858b]">Estado actual en 3D e hitos clínicos fechados registrados para esta pieza.</p>
            {sortedToothHistory.length ? <ol className="relative mt-3 space-y-0 border-l border-[#b8d2cf] pl-4">
              {sortedToothHistory.map(event => <li key={event.id} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[1.31rem] top-1.5 size-2 rounded-full bg-[#087f83]" aria-hidden="true" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#087f83]">{formatHistoryDate(event.clinicalDate, event.recordedAt)}{event.source === "evolution" ? " · Evolución" : ""}</p>
                <p className="mt-0.5 text-sm font-medium text-[#26474d]">{eventDescription(event)}</p>
              </li>)}
            </ol> : <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-[#71858b]">Aún no hay cambios históricos registrados para esta pieza.</p>}
          </section>
          {onSetCrownDetails && hasCrown && crown && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4" aria-label="Corregir soporte de la corona">
            <h3 className="text-sm font-semibold text-amber-950">¿La corona está clasificada incorrectamente?</h3>
            <p className="mt-1 text-xs leading-5 text-amber-900">Puedes corregir si va sobre un diente natural o sobre un implante. La aplicación conserva el material y registra la corrección en el historial.</p>
            <label className="mt-3 block text-xs font-medium text-amber-950">Soporte de la corona
              <select value={crownFoundation} disabled={savingCrown} onChange={event => setCrownFoundationDraft({ key: crownFoundationKey, value: event.target.value === "implant" ? "implant" : "tooth" })} className="mt-1 block h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-[#26474d]">
                <option value="tooth">Diente natural</option>
                <option value="implant">Implante</option>
              </select>
            </label>
            <button type="button" disabled={savingCrown || (crownFoundation === (crown.foundation === "implant" ? "implant" : "tooth") && crown.source !== "evolution")} onClick={() => void saveCrownFoundation()} className="mt-3 min-h-9 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {savingCrown ? "Guardando corrección…" : "Guardar corrección"}
            </button>
            {crownMessage && <p role="status" className="mt-2 text-xs text-amber-950">{crownMessage}</p>}
          </section>}
          {periodontalHistory !== undefined && <section className="rounded-xl border border-[#dbe8e7] bg-[#f8fbfb] p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-[#16343a]">Mediciones periodontales</h3>
            <p className="mt-1 text-xs leading-5 text-[#71858b]">Sondaje y hallazgos por sitio, conservados por fecha.</p>
            {sortedPerioHistory.length ? <ol className="relative mt-3 space-y-0 border-l border-[#b8d2cf] pl-4">
              {sortedPerioHistory.map(exam => {
                const details = perioDetails(exam);
                return <li key={exam.id} className="relative pb-4 last:pb-0">
                  <span className="absolute -left-[1.31rem] top-1.5 size-2 rounded-full bg-[#c0784b]" aria-hidden="true" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#a25d36]">{formatHistoryDate(undefined, exam.recordedAt)}</p>
                  {details.length ? <ul className="mt-1 space-y-1 text-xs leading-5 text-[#405a60]">{details.map((detail,index) => <li key={index}>{detail}</li>)}</ul> : <p className="mt-1 text-xs text-[#71858b]">Examen guardado sin mediciones consignadas para esta pieza.</p>}
                </li>;
              })}
            </ol> : <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-[#71858b]">No hay exámenes guardados para esta pieza.</p>}
          </section>}
        </aside>
        </div>
      </div>
    </div>
  </div>;
}
