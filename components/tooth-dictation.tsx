"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { createAudioTranscription, AUDIO_DICTATION_NOTICE } from "@/lib/dictation/audio-transcription";
import { fdiToChile } from "@/lib/tooth-numbering";
import { scopeToothProposal, toothDictationOperation, type ToothDictationOperation } from "@/lib/dictation/tooth-mode";
import type { OdontogramChange, StructureOutcome } from "@/lib/dictation/proposal";

type AudioStatus = "idle" | "starting" | "recording" | "transcribing";
type Preview = { outcome: StructureOutcome; changes: OdontogramChange[]; otherTeeth: number[] };

const conditionLabel: Record<string, string> = {
  not_examined: "sin examinar",
  sound: "sin lesión visible",
  caries: "caries",
  restored: "obturación",
  sealant: "sellante",
  other_restoration: "otra restauración",
};

function changeLabel(change: OdontogramChange, chart: OdontogramData) {
  if (change.kind === "status") {
    return `Estado general: ${chart.teeth[change.tooth] ?? "Sin hallazgos"} → ${change.status ?? "sin detalle"}`;
  }
  if (change.kind === "surface") {
    const current = chart.surfaces[change.tooth]?.[change.surface ?? "O"];
    const next = change.finding;
    const condition = next ? conditionLabel[next.condition] ?? next.condition : "sin detalle";
    const depth = next?.condition === "caries" && next.depth ? ` · ${next.depth.replaceAll("_", " ")}` : "";
    return `Cara ${change.surface ?? "?"}: ${conditionLabel[current?.condition ?? "not_examined"]} → ${condition}${depth}`;
  }
  const current = chart.crowns?.[change.tooth];
  const foundation = change.foundation === "implant" ? "sobre implante" : "sobre diente";
  const shade = change.shade ?? current?.shade;
  return `Corona: ${current?.material || "sin material"} → ${change.material ?? "sin detalle"} ${foundation}${shade ? ` · ${change.shade ? "color" : "se conserva color"} ${shade}` : ""}`;
}

export function ToothDictation({ tooth, chart, disabled = false, onApply }: {
  tooth: number;
  chart: OdontogramData;
  disabled?: boolean;
  onApply?: (tooth: number, operations: ToothDictationOperation[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [speechError, setSpeechError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const engine = useRef<ReturnType<typeof createAudioTranscription> | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  if (engine.current === null) engine.current = createAudioTranscription();

  useEffect(() => () => { engine.current?.abort(); analysisController.current?.abort(); }, []);

  const reset = () => {
    engine.current?.abort();
    analysisController.current?.abort();
    analysisController.current = null;
    setTranscript("");
    setAudioStatus("idle");
    setAnalyzing(false);
    setSpeechError("");
    setAnalysisError("");
    setPreview(null);
    setSelectedIds(new Set());
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const toggleRecording = () => {
    if (audioStatus === "recording" || audioStatus === "starting") {
      engine.current?.stop();
      return;
    }
    if (!engine.current?.isSupported()) {
      setSpeechError(engine.current?.unsupportedMessage() ?? "El micrófono no está disponible en este navegador.");
      return;
    }
    setSpeechError("");
    setAnalysisError("");
    engine.current.start(transcript, {
      onStatus: (status) => setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle"),
      onTranscript: (text) => { setTranscript(text); setPreview(null); },
      onError: (message) => { setSpeechError(message); setAudioStatus("idle"); },
      onEnd: () => setAudioStatus("idle"),
    });
  };

  const prepareProposal = async () => {
    const text = transcript.trim();
    if (text.length < 3) {
      setAnalysisError("Dicta o escribe el hallazgo de esta pieza.");
      return;
    }
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalyzing(true);
    setAnalysisError("");
    setPreview(null);
    try {
      const chartTooth = {
        tooth,
        status: chart.teeth[tooth] ?? "Sin hallazgos",
        ...(chart.crowns?.[tooth]?.foundation ? { foundation: chart.crowns[tooth].foundation } : {}),
        ...(chart.extras?.[tooth]?.length ? { extras: chart.extras[tooth] } : {}),
      };
      const response = await fetch("/api/dictation/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: `FDI ${formatFdi(tooth)}. ${text}`, chart: [chartTooth] }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      });
      const data = await response.json() as StructureOutcome & { error?: string };
      if (!response.ok || !data.proposal) throw new Error(data.error || "No se pudo preparar la propuesta.");
      const scoped = scopeToothProposal(data.proposal.odontogram ?? [], tooth);
      setPreview({ outcome: data, changes: scoped.changes, otherTeeth: scoped.otherTeeth });
      setSelectedIds(new Set(scoped.changes.filter((change) => toothDictationOperation(change)).map((change) => change.id)));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudo preparar la propuesta. Revisa la conexión y vuelve a intentarlo.");
    } finally {
      if (analysisController.current === controller) {
        analysisController.current = null;
        setAnalyzing(false);
      }
    }
  };

  const applyProposal = async () => {
    if (!preview || preview.otherTeeth.length || !onApply) return;
    const operations = preview.changes
      .filter((change) => selectedIds.has(change.id))
      .map(toothDictationOperation)
      .filter((operation): operation is ToothDictationOperation => operation !== null);
    if (!operations.length) return;
    setApplying(true);
    setAnalysisError("");
    try {
      await onApply(tooth, operations);
      changeOpen(false);
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudieron aplicar los cambios.");
    } finally {
      setApplying(false);
    }
  };

  const eligibleCount = preview?.changes.filter((change) => toothDictationOperation(change)).length ?? 0;

  return <>
    {onApply && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} data-testid="dictate-selected-tooth">
      <Mic className="mr-2 size-4"/>Dictar esta pieza
    </Button>}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto border-[#dddbe6] bg-white p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>Dictado de una pieza</DialogTitle>
          <DialogDescription>FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}. El modo se limita a esta pieza y solo guarda en el odontograma.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          Puedes nombrarla como <strong>FDI {formatFdi(tooth)}</strong> o <strong>chilena {fdiToChile(tooth)}</strong>. También puedes omitir el número: la pieza ya está seleccionada. Si mencionas otro número, se detendrá para revisar la pieza.
        </div>
        <label className="mt-3 block text-sm font-medium text-[#3b3355]" htmlFor={`tooth-dictation-${tooth}`}>Hallazgo clínico</label>
        <Textarea id={`tooth-dictation-${tooth}`} value={transcript} onChange={(event) => { setTranscript(event.target.value); setPreview(null); setAnalysisError(""); }} disabled={analyzing || applying || audioStatus !== "idle"} rows={4} maxLength={8000} placeholder="Ej.: caries oclusal de dentina profunda; distal obturada con resina…" className="text-base" />
        <p role="note" className="mt-2 rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950">{AUDIO_DICTATION_NOTICE}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={toggleRecording} disabled={audioStatus === "transcribing" || analyzing || applying} aria-pressed={audioStatus === "recording"}>
            {audioStatus === "recording" || audioStatus === "starting" ? <><MicOff className="mr-2 size-4"/>Detener dictado</> : <><Mic className="mr-2 size-4"/>{audioStatus === "transcribing" ? "Transcribiendo…" : "Dictar por voz"}</>}
          </Button>
          <Button type="button" onClick={prepareProposal} disabled={analyzing || applying || audioStatus !== "idle" || transcript.trim().length < 3}>
            <Sparkles className="mr-2 size-4"/>{analyzing ? "Preparando…" : "Preparar propuesta"}
          </Button>
          {preview && <Button type="button" variant="ghost" onClick={() => { setPreview(null); setAnalysisError(""); }} disabled={analyzing || applying}>Editar dictado</Button>}
        </div>
        {(audioStatus === "starting" || audioStatus === "recording" || audioStatus === "transcribing") && <p role="status" className="mt-2 text-xs text-[#615f73]">{audioStatus === "recording" ? "Grabando. Pulsa «Detener dictado» para transcribir." : audioStatus === "transcribing" ? "Transcribiendo el audio…" : "Preparando el micrófono…"}</p>}
        {speechError && <p role="alert" className="mt-2 text-sm text-rose-800">{speechError}</p>}
        {analysisError && <p role="alert" className="mt-2 text-sm text-rose-800">{analysisError}</p>}

        {preview && <section className="mt-4 space-y-3 border-t border-[#ebe9f2] pt-4" aria-live="polite">
          <div>
            <h3 className="font-semibold text-[#3b3355]">Propuesta para FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}</h3>
            <p className="text-xs text-[#615f73]">{preview.outcome.engine === "reglas-locales" ? "Interpretada por reglas locales" : "Preparada con el sistema de dictado"}. Revisa cada cambio antes de aplicarlo.</p>
          </div>
          {preview.outcome.proposal.corrected?.text && preview.outcome.proposal.corrected.text !== transcript.trim() && <details className="rounded-lg border border-[#e6e4ee] p-3 text-sm">
            <summary className="cursor-pointer font-medium text-[#473a6d]">Ver texto interpretado</summary>
            <p className="mt-2 whitespace-pre-wrap">{preview.outcome.proposal.corrected.text}</p>
          </details>}
          {preview.otherTeeth.length > 0 ? <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">El dictado también identifica {preview.otherTeeth.map((other) => `FDI ${formatFdi(other)} · Chile ${fdiToChile(other)}`).join(", ")}. No se guardó ninguna pieza. Corrige el texto para dictar solo la seleccionada.</p> : preview.changes.length ? <ul className="space-y-2">
            {preview.changes.map((change) => {
              const operation = toothDictationOperation(change);
              const blocked = !operation;
              const checked = selectedIds.has(change.id);
              return <li key={change.id} className={`rounded-lg border p-3 ${blocked ? "border-amber-200 bg-amber-50" : "border-[#e6e4ee] bg-white"}`}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 size-4 accent-[#473a6d]" checked={checked} disabled={blocked || applying} onChange={(event) => setSelectedIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(change.id); else next.delete(change.id); return next; })} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[#3b3355]">{changeLabel(change, chart)}</span>
                    <span className="mt-1 block text-xs text-[#615f73]">Mención: {change.numberingLabel}. {change.evidence || change.sourceText}</span>
                    {blocked && <span className="mt-1 block text-xs font-medium text-amber-900">{change.conflict ? "Reglas e IA discrepan." : change.advisory ?? (change.coherence === "incoherente" ? "La propuesta no es coherente con el registro." : "Faltan datos para aplicar este cambio." )} No se puede aplicar desde aquí.</span>}
                  </span>
                </label>
              </li>;
            })}
          </ul> : <p className="rounded-lg bg-[#f7f6fa] p-3 text-sm text-[#615f73]">No se detectaron hallazgos actuales para guardar en el odontograma de esta pieza.</p>}
          {preview.outcome.proposal.clarifications?.length ? <details className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-950">
            <summary className="cursor-pointer font-medium">Aclaraciones del dictado ({preview.outcome.proposal.clarifications.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{preview.outcome.proposal.clarifications.slice(0, 6).map((question, index) => <li key={`${index}:${question}`}>{question}</li>)}</ul>
          </details> : null}
          <p className="text-xs text-[#615f73]">Los planes y las notas de evolución no se guardan en este modo. El odontograma registra caries por superficie y profundidad; no se reemplazan por ICDAS.</p>
          {onApply && <div className="flex flex-wrap justify-end gap-2 border-t border-[#ebe9f2] pt-3">
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={applying}>Cancelar</Button>
            <Button type="button" onClick={() => void applyProposal()} disabled={applying || analyzing || !eligibleCount || !selectedIds.size || Boolean(preview.otherTeeth.length)}>{applying ? "Aplicando…" : `Aplicar ${selectedIds.size} cambio${selectedIds.size === 1 ? "" : "s"}`}</Button>
          </div>}
        </section>}
      </DialogContent>
    </Dialog>
  </>;
}
