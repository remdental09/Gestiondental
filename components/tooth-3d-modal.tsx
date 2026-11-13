"use client";

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FullArch3DStage } from "@/components/full-arch-3d-stage";
import { Eye, EyeOff, X } from "lucide-react";
import { ToothTimeline } from "@/components/tooth-timeline";
import { formatFdi, type CrownDetails, type OdontogramSurface, type PerioExam, type PerioSiteKey, type PerioTooth, type SurfaceFinding, type ToothHistoryEvent } from "@/app/clinical-data";
import { cariesDetail } from "@/lib/caries";
import { toothPhotoFor } from "@/lib/tooth-photos";
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
  editableEventIds,
  onDeleteEvent,
  onEditEvent,
  onDeleteReading,
  onEditReading,
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
  editableEventIds?: string[];
  onDeleteEvent?: (tooth: number, eventId: string, title: string) => Promise<void>;
  onEditEvent?: (tooth: number, eventId: string, fields: { title: string; detail: string; clinicalDate: string }) => Promise<void>;
  onDeleteReading?: (tooth: number, examId: number, day: string) => Promise<void>;
  onEditReading?: (tooth: number, examId: number, reading: PerioTooth, clinicalDate: string) => Promise<void>;
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
  const [show3d, setShow3d] = useState(false);
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
  // Pieza sana (sin hallazgos ni lectura periodontal): foto realista, invertida si es superior; el modelo 3D queda a un clic.
  const healthyPhoto = status === "Sin hallazgos" && findings.length === 0 && !periodontalSites ? toothPhotoFor({ fdi: tooth, status }) : null;
  const showHealthyPhoto = Boolean(healthyPhoto) && !show3d;
  if (status && status !== "Sin hallazgos") findings.unshift((status === "Implante" || status === "Implante con pilar") && hasCrown ? "Implante con corona" : status === "Implante con pilar" ? "Implante con pilar (sin corona)" : status === "Corona" ? "Corona" : status === "Ausente" ? "Ausente / extraído" : status);
  const sortedToothHistory = [...toothHistory].filter(event => event.tooth === tooth).sort((a,b) => new Date(b.clinicalDate ? `${b.clinicalDate}T12:00:00` : b.recordedAt).getTime() - new Date(a.clinicalDate ? `${a.clinicalDate}T12:00:00` : a.recordedAt).getTime());
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
  return <div className="fixed inset-0 z-50" role="presentation">
    <button type="button" className="absolute inset-0 bg-[#10343a]/45" aria-label="Cerrar vista 3D" onClick={onClose} />
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-3d-title"
      className="fixed top-1/2 left-1/2 z-10 flex max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] w-[min(68rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-[#d5e4e2] bg-white shadow-xl"
      style={{ transform: placed ? "translate(-50%, -50%) scale(1)" : `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.18)`, transition: reducedMotion ? "none" : "transform 480ms ease" }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#e4eeed] px-4 py-3 sm:px-5">
        <div>
          <p id="tooth-3d-title" className="text-lg font-semibold text-[#2a2540]">FDI {formatFdi(tooth)} · {chileLabel(tooth)}</p>
          <p className="mt-0.5 text-sm text-[#5d7579]">{toothKindLabel(toothKind(tooth))} · {periodontalSites ? "seis sitios periodontales · solo lectura" : onSetCrownDetails ? "vista 3D · odontograma editable" : "solo lectura"}</p>
        </div>
        <button ref={closeRef} type="button" className="rounded-lg p-2 text-[#3b3355] hover:bg-[#e7f3f1]" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        <div className={`grid grid-cols-1 gap-4 ${periodontalHistory !== undefined ? "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]"}`}>
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
          {(["MV", "V", "DV", "ML", "L", "DL"] as PerioSiteKey[]).map(key => { const reading = periodontalSites[key]; const depth = reading?.depth; const measured = depth !== null && depth !== undefined; const color = !measured ? "#94a3b8" : depth >= 6 ? "#be123c" : depth >= 4 ? "#b45309" : "#047857"; return <div key={key} className="rounded-lg border border-[#e5e2ec] bg-white px-1 py-1.5"><span className="font-semibold">{key}</span><span className="ml-1 font-medium" style={{color}}>{measured ? `${depth} mm` : "sin medir"}</span>{reading?.bleeding && <span className="block text-red-700">Sangrado</span>}{reading?.suppuration && <span className="block text-violet-700">Supuración</span>}</div>; })}
        </div> : findings.length > 0 ? <ul className="mb-3 flex flex-wrap gap-2">{findings.map((line) => <li key={line} className="rounded-full bg-[#f3f7f7] px-3 py-1 text-xs font-medium text-[#3b3355]">{line}</li>)}</ul> : <p className="mb-3 text-sm text-[#6b6a7c]">Sin hallazgos registrados en esta pieza.</p>}
        <div className="mb-2 flex gap-2" role="group" aria-label="Vista del odontograma 3D"><button type="button" onClick={() => setFullArch(false)} aria-pressed={!fullArch} className={`rounded-lg border px-3 py-1.5 text-sm ${!fullArch ? "border-[#473a6d] bg-[#efeef4] text-[#473a6d]" : "border-[#dfdbe8] bg-white text-[#57566a]"}`}>Pieza seleccionada</button><button type="button" onClick={() => setFullArch(true)} aria-pressed={fullArch} className={`rounded-lg border px-3 py-1.5 text-sm ${fullArch ? "border-[#473a6d] bg-[#efeef4] text-[#473a6d]" : "border-[#dfdbe8] bg-white text-[#57566a]"}`}>Todas las piezas en hueso</button></div>
        {fullArch ? <FullArch3DStage reducedMotion={reducedMotion} /> : showHealthyPhoto && healthyPhoto ? <figure className="relative m-0 mx-auto w-[min(70vw,280px)] overflow-hidden rounded-xl bg-[#14161b]" data-testid="tooth-modal-photo" data-upper={healthyPhoto.upper ? "true" : "false"}><img src={healthyPhoto.src} alt={`Imagen referencial de la pieza ${formatFdi(tooth)}: sin hallazgos registrados`} width={420} height={576} decoding="async" className="block h-auto w-full" style={{ transform: healthyPhoto.transform }} /><p className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-center text-[10px] text-white/80">Imagen referencial, no es el paciente</p></figure> : <Suspense fallback={<p className="grid h-[min(42vh,360px)] min-h-56 place-items-center text-sm text-[#6b6a7c]" role="status">Preparando el diente…</p>}>
          {placed && <Tooth3DStage tooth={tooth} status={status} surfaces={surfaces} hasCrown={hasCrown} reducedMotion={reducedMotion} periodontalSites={periodontalSites} showPeriodontium={showPeriodontium} periodontiumOpacity={periodontiumOpacity} />}
        </Suspense>}
        {healthyPhoto && !fullArch && <button type="button" onClick={() => setShow3d(v => !v)} aria-pressed={show3d} className="mt-2 rounded-lg border border-[#dfdbe8] bg-white px-3 py-1.5 text-sm text-[#57566a]" data-testid="tooth-modal-toggle3d">{show3d ? "Ver foto realista" : "Ver modelo 3D"}</button>}
        <p className="mt-2 text-xs leading-5 text-[#6b6a7c]">{reducedMotion ? "Arrastra para girar. Acerca con la rueda o con dos dedos. La rotación automática está desactivada." : "Las piezas giran juntas con la arcada. Arrastra para orientarlas y acerca con la rueda o con dos dedos."}</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-[#57566a]" aria-label="Leyenda de colores">
          {([
            ["Lesión de caries", surfaceMarkColor("caries")],
            ["Obturación", surfaceMarkColor("restored")],
            ["Restauración provisoria", "#e6a14a"],
            ["Sellante", surfaceMarkColor("sealant")],
            ["Sin lesión visible", surfaceMarkColor("sound")],
            ["Sin examinar", surfaceMarkColor("not_examined")],
          ] as const).map(([label, color]) => <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e2ec] bg-white px-2.5 py-1"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</li>)}
        </ul>
        </div>
        <aside className="min-w-0 space-y-4" aria-label={`Historia clínica de la pieza FDI ${formatFdi(tooth)}`}>
          <section className="rounded-xl border border-[#dbe8e7] bg-[#f7f6fa] p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-[#2a2540]">Evolución de la pieza</h3>
            <p className="mt-1 text-xs leading-5 text-[#6b6a7c]">Estado actual en 3D e hitos clínicos fechados registrados para esta pieza.</p>
            {periodontalHistory === undefined && onEditEvent ? <ToothTimeline tooth={tooth} history={toothHistory} exams={[]} mode="odontograma" editableIds={editableEventIds} onDeleteEvent={onDeleteEvent} onEditEvent={onEditEvent} /> : sortedToothHistory.length ? <ol className="relative mt-3 space-y-0 border-l border-[#b8d2cf] pl-4">
              {sortedToothHistory.map(event => <li key={event.id} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[1.31rem] top-1.5 size-2 rounded-full bg-[#473a6d]" aria-hidden="true" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#473a6d]">{formatHistoryDate(event.clinicalDate, event.recordedAt)}{event.source === "evolution" ? " · Evolución" : ""}</p>
                <p className="mt-0.5 text-sm font-medium text-[#3b3355]">{eventDescription(event)}</p>
              </li>)}
            </ol> : <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-[#6b6a7c]">Aún no hay cambios históricos registrados para esta pieza.</p>}
          </section>
          {onSetCrownDetails && hasCrown && crown && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4" aria-label="Corregir soporte de la corona">
            <h3 className="text-sm font-semibold text-amber-950">¿La corona está clasificada incorrectamente?</h3>
            <p className="mt-1 text-xs leading-5 text-amber-900">Puedes corregir si va sobre un diente natural o sobre un implante. La aplicación conserva el material y registra la corrección en el historial.</p>
            <label className="mt-3 block text-xs font-medium text-amber-950">Soporte de la corona
              <select value={crownFoundation} disabled={savingCrown} onChange={event => setCrownFoundationDraft({ key: crownFoundationKey, value: event.target.value === "implant" ? "implant" : "tooth" })} className="mt-1 block h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-[#3b3355]">
                <option value="tooth">Diente natural</option>
                <option value="implant">Implante</option>
              </select>
            </label>
            <button type="button" disabled={savingCrown || (crownFoundation === (crown.foundation === "implant" ? "implant" : "tooth") && crown.source !== "evolution")} onClick={() => void saveCrownFoundation()} className="mt-3 min-h-9 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {savingCrown ? "Guardando corrección…" : "Guardar corrección"}
            </button>
            {crownMessage && <p role="status" className="mt-2 text-xs text-amber-950">{crownMessage}</p>}
          </section>}
          {periodontalHistory !== undefined && <ToothTimeline tooth={tooth} history={toothHistory} exams={periodontalHistory} mode="periodontograma" onDeleteReading={onDeleteReading} onEditReading={onEditReading} />}
        </aside>
        </div>
      </div>
    </div>
  </div>;
}
