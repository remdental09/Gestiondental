"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type ClinicalImage, type OdontogramData, type PerioExam } from "@/app/clinical-data";
import { createWebSpeechTranscription, IOS_DICTATION_HINT } from "@/lib/dictation/transcription";
import {
  finalizeEvolution,
  parseDisplayedFdi,
  planFichaUpdate,
  planChartWrites,
  reviewIssue,
  verifyDictationSave,
  type BudgetChange,
  type CrownMaterial,
  type FichaChange,
  type ItemOrigin,
  type OdontogramChange,
  type OdontogramSurface,
  type StructureOutcome,
  type SurfaceFinding,
  type ToothStatus,
  CROWN_MATERIALS,
  ODONTOGRAM_SURFACES,
  TOOTH_STATUSES,
} from "@/lib/dictation/proposal";

type Reload = {
  patients: { id: number; name: string; birthDate: string; rut: string; phone: string; email: string; reason: string; status: string; allergies: string; history: string }[];
  notes: { id: number; patientId: number; date: string; title: string; body: string; backupStatus?: string; sourceDocumentId?: string | null; recordedAt?: string }[];
  budgets: { id: number; patientId: number; title: string; items: { label: string; amount: number }[]; status: string; date: string }[];
  appointments: { id: number; patientId: number; day: string; time: string; reason: string }[];
  calendarEvents: { id: number; title: string; startAt: string; endAt: string; sourceTimeZone: string; htmlLink: string | null; status: string; allDay: boolean; patientId: number | null }[];
  calendarSnapshotAt?: string | null;
  periodontalExams: Record<number, PerioExam[]>;
  toothStatuses: Record<number, OdontogramData>;
  clinicalImages: ClinicalImage[];
};

type ReviewTooth = OdontogramChange & { decision: "accepted" | "rejected"; toothText: string; incompleteCaries?: boolean };
type ReviewFicha = FichaChange & { decision: "accepted" | "rejected" };
type PatientFicha = { name: string; rut: string; phone: string; email: string; allergies: string; history: string };

const originLabel: Record<ItemOrigin, string> = { ia: "IA", reglas: "Reglas", "ia+reglas": "IA + reglas" };
const fichaLabel: Record<FichaChange["field"], string> = { allergies: "Alergias", history: "Antecedentes", medications: "Medicamentos" };

function OriginBadge({ origin, conflict }: { origin?: ItemOrigin; conflict?: boolean }) {
  if (!origin && !conflict) return null;
  return <span className="ml-2 inline-flex gap-1 align-middle">
    {origin && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${origin === "ia+reglas" ? "bg-emerald-100 text-emerald-900" : origin === "ia" ? "bg-sky-100 text-sky-900" : "bg-slate-100 text-slate-700"}`}>{originLabel[origin]}</span>}
    {conflict && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">IA y reglas no coinciden</span>}
  </span>;
}

function Evidence({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-1 text-xs text-[#71858b]"><span className="font-medium">Dicho: </span>«{text}»</p>;
}
type ReviewBudget = BudgetChange & { decision: "accepted" | "rejected"; amountText: string };

const EXAMPLE = "El paciente refiere dolor al frío. Se observa caries en la cara oclusal de la pieza FDI 3.6, ICDAS 3, lesión activa. Pieza 12 con obturación oclusal. Niega alergia a penicilina. Presupuesto de corona de zirconio, 350000 pesos. Sondaje de 4 mm en mesial vestibular de FDI 1.6.";

const surfaceLabel: Record<OdontogramSurface, string> = {
  V: "Vestibular",
  P: "Lingual / palatina",
  M: "Mesial",
  D: "Distal",
  O: "Oclusal / incisal",
};
const conditionLabel: Record<SurfaceFinding["condition"], string> = {
  not_examined: "Sin examinar",
  sound: "Sin lesión visible",
  caries: "Lesión de caries",
  restored: "Obturación",
  sealant: "Sellante",
  other_restoration: "Otra restauración",
};
const activityLabel = { active: "Activa", inactive: "Inactiva", uncertain: "Incierta" };

function findingText(finding?: { condition: SurfaceFinding["condition"]; icdas?: SurfaceFinding["icdas"]; activity?: SurfaceFinding["activity"] }): string {
  if (!finding) return "Sin registrar";
  if (finding.condition !== "caries") return conditionLabel[finding.condition];
  return `${conditionLabel.caries} · ICDAS ${finding.icdas ?? "sin registrar"} · ${finding.activity ? activityLabel[finding.activity] : "actividad sin registrar"}`;
}

function ChangeHighlight({ current, next }: { current: string; next: string }) {
  if (current === next) return <span>{current}</span>;
  return <span className="inline-flex flex-wrap items-center gap-2">
    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-950 line-through">{current}</span>
    <span aria-hidden="true">→</span>
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-950">{next}</span>
  </span>;
}

export function ClinicalDictation({
  patientId,
  patientName,
  odontogram,
  latestNote,
  patient,
  persist,
  onApplied,
}: {
  patientId: number;
  patientName: string;
  odontogram: OdontogramData;
  latestNote: { title: string; body: string } | null;
  patient?: PatientFicha | null;
  persist: (input: Record<string, unknown>) => Promise<{ note?: { id: number; title: string; body: string }; budget?: { id: number } }>;
  onApplied: (data: Reload) => void;
}) {
  const engine = useRef(createWebSpeechTranscription());
  const requestId = useRef("");
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(true);
  const [unsupportedMessage, setUnsupportedMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [outcome, setOutcome] = useState<StructureOutcome | null>(null);
  const [evolutionTitle, setEvolutionTitle] = useState("");
  const [evolutionBody, setEvolutionBody] = useState("");
  const [evolutionDecision, setEvolutionDecision] = useState<"accepted" | "rejected">("accepted");
  const [teeth, setTeeth] = useState<ReviewTooth[]>([]);
  const [budgets, setBudgets] = useState<ReviewBudget[]>([]);
  const [fichaItems, setFichaItems] = useState<ReviewFicha[]>([]);
  const [notRecorded, setNotRecorded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; messages: string[] } | null>(null);

  useEffect(() => {
    const transcription = engine.current;
    setSupported(transcription.isSupported());
    setUnsupportedMessage(transcription.unsupportedMessage());
    return () => transcription.abort();
  }, []);

  const resetReview = () => {
    setOutcome(null);
    setTeeth([]);
    setBudgets([]);
    setFichaItems([]);
    setNotRecorded([]);
    setResult(null);
    setFormError("");
  };

  const close = () => {
    engine.current.abort();
    setListening(false);
    setInterim("");
    setOpen(false);
  };

  const start = async () => {
    setSpeechError("");
    setResult(null);
    if (!engine.current.isSupported()) {
      setSupported(false);
      setSpeechError(engine.current.unsupportedMessage());
      return;
    }
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      setSpeechError("Chrome no autorizó el micrófono. Puedes escribir o pegar el texto y preparar la propuesta igual.");
      return;
    }
    setListening(true);
    engine.current.start(transcript, {
      onTranscript: (text, spokenInterim) => {
        setTranscript(text);
        setInterim(spokenInterim);
        resetReview();
      },
      onError: (message) => {
        setSpeechError(message);
        setListening(false);
        setInterim("");
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
      },
    });
  };

  const stop = () => {
    engine.current.stop();
    setListening(false);
    setInterim("");
  };

  const structure = async () => {
    setFormError("");
    setResult(null);
    setStructuring(true);
    try {
      const response = await fetch("/api/dictation/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          chart: Object.entries(odontogram.teeth).map(([tooth, status]) => ({ tooth: Number(tooth), status })),
        }),
      });
      const data = await response.json() as StructureOutcome & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo preparar la propuesta.");
      setOutcome(data);
      setEvolutionTitle(data.proposal.evolution?.title ?? "");
      setEvolutionBody(data.proposal.evolution?.body ?? "");
      setEvolutionDecision(data.proposal.evolution ? "accepted" : "rejected");
      // Lo que IA y reglas no comparten, o la caries sin ICDAS/actividad, parte rechazado.
      setTeeth([
        ...data.proposal.odontogram.map((item) => ({ ...item, decision: item.conflict ? "rejected" as const : "accepted" as const, toothText: formatFdi(item.tooth) })),
        ...(data.proposal.incomplete ?? []).map((item) => ({ ...item, decision: "rejected" as const, toothText: formatFdi(item.tooth), incompleteCaries: true })),
      ]);
      setBudgets(data.proposal.budget.map((item) => ({ ...item, decision: "accepted", amountText: item.amount > 0 ? String(item.amount) : "" })));
      setFichaItems((data.proposal.ficha ?? []).map((item) => ({ ...item, decision: patient ? "accepted" : "rejected" })));
      setNotRecorded([]);
    } catch (cause) {
      setOutcome(null);
      setFormError(cause instanceof Error ? cause.message : "No se pudo preparar la propuesta.");
    } finally {
      setStructuring(false);
    }
  };

  const reload = async () => {
    const response = await fetch("/api/clinical", { cache: "no-store" });
    const data = await response.json() as Reload & { error?: string };
    if (!response.ok) throw new Error(data.error || "No se pudo releer la ficha.");
    return data;
  };

  const confirm = async () => {
    if (!outcome || saving) return;
    const acceptedTeeth: OdontogramChange[] = [];
    for (const item of teeth) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText);
      if (!tooth) {
        setFormError("Revisa las piezas en nomenclatura FDI con punto, por ejemplo 3.6.");
        return;
      }
      const next = { ...item, tooth, numberingLabel: tooth === item.tooth ? item.numberingLabel : `FDI ${formatFdi(tooth)}`, numbering: tooth === item.tooth ? item.numbering : "FDI" as const };
      const issue = reviewIssue(next);
      if (issue) {
        setFormError(issue);
        return;
      }
      acceptedTeeth.push(next);
    }
    const acceptedBudgets: BudgetChange[] = [];
    for (const item of budgets) {
      if (item.decision !== "accepted") continue;
      const amount = Number(item.amountText);
      if (!item.label.trim() || !Number.isSafeInteger(amount) || amount < 1) {
        setFormError("Revisa la prestación y el monto en pesos, sin decimales.");
        return;
      }
      acceptedBudgets.push({ ...item, label: item.label.trim(), amount });
    }
    const acceptedFicha = fichaItems.filter((item) => item.decision === "accepted");
    const fichaUpdate = patient ? planFichaUpdate(patient, acceptedFicha) : null;
    const saveEvolution = evolutionDecision === "accepted" && evolutionBody.trim().length > 0;
    // El registro del odontograma de la nota se rehace con lo aceptado y se agrega la transcripción completa.
    const finalBody = saveEvolution ? finalizeEvolution(evolutionBody, acceptedTeeth, outcome.proposal.transcript ?? transcript) : "";
    if (!saveEvolution && !acceptedTeeth.length && !acceptedBudgets.length && !fichaUpdate) {
      setFormError("No hay nada aceptado para guardar.");
      return;
    }
    setSaving(true);
    setFormError("");
    setResult(null);
    const before = odontogram;
    let after = odontogram;
    let savedNote: { id?: number; title: string; body: string } | null = null;
    const savedBudgetIds: number[] = [];
    try {
      if (saveEvolution) {
        requestId.current ||= crypto.randomUUID();
        const saved = await persist({ action: "addNote", patientId, title: evolutionTitle.trim() || "Evolución dictada", body: finalBody, requestId: requestId.current });
        savedNote = { id: saved.note?.id, title: evolutionTitle.trim() || "Evolución dictada", body: saved.note?.body ?? finalBody };
        const readBack = await reload();
        after = readBack.toothStatuses[patientId] ?? before;
        onApplied(readBack);
      }
      for (const action of planChartWrites(patientId, before, after, acceptedTeeth)) await persist(action);
      for (const item of acceptedBudgets) {
        const saved = await persist({ action: "addBudget", patientId, title: item.title, label: item.label, amount: item.amount });
        if (saved.budget?.id) savedBudgetIds.push(saved.budget.id);
      }
      if (fichaUpdate && patient) {
        await persist({ action: "updatePatient", patientId, name: patient.name, rut: patient.rut, phone: patient.phone, email: patient.email, allergies: fichaUpdate.allergies, history: fichaUpdate.history });
      }
      const finalRead = await reload();
      let check = verifyDictationSave({
        patientId,
        before,
        note: savedNote,
        accepted: acceptedTeeth,
        budgets: acceptedBudgets,
        savedBudgetIds,
      }, {
        notes: finalRead.notes,
        budgets: finalRead.budgets,
        toothStatuses: finalRead.toothStatuses,
      });
      if (fichaUpdate) {
        const reread = finalRead.patients.find((entry) => entry.id === patientId);
        if (!reread || reread.allergies !== fichaUpdate.allergies || reread.history !== fichaUpdate.history) check = { ok: false, messages: [...check.messages, "Alergias o antecedentes releídos no coinciden con lo aceptado."] };
        else check = { ...check, messages: [...check.messages, "Alergias y antecedentes de la ficha actualizados y releídos."] };
      }
      onApplied(finalRead);
      setResult(check);
      setNotRecorded([
        ...teeth.filter((item) => item.decision !== "accepted").map((item) => `${item.numberingLabel}${item.surface ? ` · ${surfaceLabel[item.surface]}` : ""}: ${item.kind === "surface" ? findingText(item.finding) : item.kind === "crown" ? "Corona" : item.status} — ${item.incompleteCaries ? "caries sin ICDAS o actividad" : "rechazado"}.`),
        ...budgets.filter((item) => item.decision !== "accepted").map((item) => `Presupuesto: ${item.label} — rechazado.`),
        ...fichaItems.filter((item) => item.decision !== "accepted" || !patient).map((item) => `${fichaLabel[item.field]}: ${item.text} — no se pasó a la ficha.`),
        ...(outcome.proposal.perio.length ? [`Sondaje (${outcome.proposal.perio.length} sitios): queda solo en la nota.`] : []),
        ...outcome.proposal.clarifications,
        ...(!saveEvolution ? ["La evolución no se guardó."] : []),
      ]);
      if (!check.ok) setFormError("La relectura no confirmó todo lo aceptado. Revisa la ficha antes de dictar de nuevo.");
    } catch (cause) {
      try { onApplied(await reload()); } catch { /* la ficha visible puede seguir en el estado anterior */ }
      setFormError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const proposal = outcome?.proposal;

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="dictation-open"><Mic className="mr-2 size-4" />Dictar</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-white sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dictado de la ficha</DialogTitle>
          <DialogDescription>Paciente: {patientName}. Nada se guarda hasta que aceptes cada cambio. El ingreso manual sigue disponible.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {!supported && <p className="rounded-lg bg-[#f4f7f8] p-3 leading-6 text-[#31575b]" role="status">{unsupportedMessage}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={listening ? "default" : "outline"} className={listening ? "bg-[#087f83] hover:bg-[#07676b]" : ""} onClick={listening ? stop : () => void start()} aria-pressed={listening} data-testid="dictation-mic">
              {listening ? <MicOff className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}
              {listening ? "Detener" : "Dictar"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { stop(); setTranscript(EXAMPLE); setInterim(""); resetReview(); }} data-testid="dictation-example">Cargar ejemplo</Button>
            <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={structuring || listening || transcript.trim().length < 3} onClick={() => void structure()} data-testid="dictation-structure">{structuring ? "Preparando…" : "Preparar propuesta"}</Button>
          </div>
          {listening && <p role="status" className="font-medium text-[#087f83]">Escuchando en español de Chile…</p>}
          {speechError && <p role="alert" className="text-[#a43542]">{speechError}</p>}
          <label className="block space-y-1.5 font-medium">Transcripción
            <Textarea data-testid="dictation-transcript" lang="es-CL" rows={5} className="min-h-32 field-sizing-fixed" value={interim ? `${transcript} ${interim}`.trim() : transcript} onChange={(event) => { if (listening) stop(); setTranscript(event.target.value); setInterim(""); resetReview(); }} placeholder="Habla o escribe el dictado. Revisa piezas y dosis antes de proponer cambios." />
          </label>
          {IOS_DICTATION_HINT && <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950" role="note">{IOS_DICTATION_HINT}</p>}
          <p className="text-xs leading-5 text-[#60757a]">Dicta libre: «punto» o «punto aparte» separa frases. La IA redacta la nota y propone los cambios con la frase dicha como respaldo; nada se aplica sin tu aceptación. Chrome usa el reconocimiento del navegador en es-CL. El audio no se envía a una API de transcripción de pago. La propuesta pasa por revisión y la ficha manual no cambia sola.</p>
          {formError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950">{formError}</p>}
          {outcome && <p className="rounded-lg bg-[#f4f7f8] p-3 leading-6 text-[#31575b]" role="status">{outcome.notice ?? "La evolución y las piezas salen de lo resuelto en el dictado. Sigue sujeta a tu revisión."}</p>}
          {proposal && <div className="space-y-4" data-testid="dictation-review">
            <section className="rounded-xl border border-[#dce5e7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Evolución</h3>
                <Decision value={proposal.evolution ? evolutionDecision : "rejected"} disabled={!proposal.evolution} onChange={setEvolutionDecision} />
              </div>
              <p className="mt-2 text-xs text-[#71858b]">Última evolución guardada, no se reemplaza</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[#f7f4f4] p-3 text-[#71858b]">{latestNote ? `${latestNote.title}\n${latestNote.body}` : "Sin evoluciones registradas"}</p>
              {proposal.evolution ? <>
                <p className="mt-3 text-xs text-[#71858b]">Nota redactada (editable). Al guardar, el bloque «Examen (odontograma)» se rehace con lo aceptado abajo y se agrega la transcripción completa.</p>
                <Input className="mt-1" aria-label="Título de la evolución" value={evolutionTitle} onChange={(event) => setEvolutionTitle(event.target.value)} disabled={evolutionDecision !== "accepted"} />
                <Textarea className="mt-2 border-emerald-200 bg-emerald-50" aria-label="Cuerpo de la evolución" rows={12} value={evolutionBody} onChange={(event) => setEvolutionBody(event.target.value)} disabled={evolutionDecision !== "accepted"} />
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-[#087f83]">Ver el texto final que se guardará</summary>
                  <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f4f7f8] p-3 text-xs leading-5 text-[#31575b]" data-testid="dictation-final-preview">{finalizeEvolution(evolutionBody, teeth.filter((item) => item.decision === "accepted" && !reviewIssue(item)), proposal.transcript ?? transcript)}</p>
                </details>
              </> : <p className="mt-3 text-[#71858b]">El dictado no produjo una evolución.</p>}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Odontograma</h3>
              {teeth.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin cambios de odontograma.</p>}
              {teeth.map((item, index) => {
                const currentStatus = odontogram.teeth[item.tooth] || "Sin hallazgos";
                const nextStatus = item.kind === "crown" ? "Corona" : item.status || currentStatus;
                return <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-tooth">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.numberingLabel}<OriginBadge origin={item.origin} conflict={item.conflict} /></p>
                      <Evidence text={item.evidence ?? item.sourceText} />
                      {item.incompleteCaries && <p className="mt-1 text-xs font-medium text-amber-800">Caries sin ICDAS o actividad dictados: complétalos para aceptarla.</p>}
                    </div>
                    <Decision value={item.decision} onChange={(decision) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                  </div>
                  {item.kind === "surface" ? <p className="mt-3"><span className="text-[#71858b]">Cara {item.surface ? surfaceLabel[item.surface] : "sin registrar"}: </span><ChangeHighlight current={findingText(item.surface ? odontogram.surfaces[item.tooth]?.[item.surface] : undefined)} next={findingText(item.finding)} /></p>
                    : <p className="mt-3"><span className="text-[#71858b]">Estado general: </span><ChangeHighlight current={currentStatus} next={nextStatus} /></p>}
                  {item.material && <p className="mt-2"><span className="text-[#71858b]">Material: </span><ChangeHighlight current={odontogram.crowns?.[item.tooth]?.material || "Sin registrar"} next={`${item.material}${item.shade ? ` · color ${item.shade}` : ""}`} /></p>}
                  {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">Pieza FDI<input className="flex h-9 w-full rounded-md border px-3" aria-label={`Pieza ${item.numberingLabel}`} value={item.toothText} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, toothText: event.target.value } : entry))} /></label>
                    {item.kind === "surface" ? <>
                      <label className="space-y-1">Superficie<select className="h-9 w-full rounded-md border px-2" value={item.surface} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, surface: event.target.value as OdontogramSurface } : entry))}>{ODONTOGRAM_SURFACES.map((surface) => <option key={surface} value={surface}>{surfaceLabel[surface]}</option>)}</select></label>
                      <label className="space-y-1">Hallazgo<select className="h-9 w-full rounded-md border px-2" value={item.finding?.condition ?? "sound"} onChange={(event) => {
                        const condition = event.target.value as SurfaceFinding["condition"];
                        const finding: SurfaceFinding = condition === "caries"
                          ? { condition: "caries", icdas: item.finding?.icdas ?? 1, activity: item.finding?.activity ?? "uncertain" }
                          : { condition, icdas: null, activity: null };
                        setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, finding } : entry));
                      }}>{Object.entries(conditionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      {item.finding?.condition === "caries" && <>
                        <label className="space-y-1">ICDAS<select className="h-9 w-full rounded-md border px-2" value={item.finding.icdas ?? ""} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index && entry.finding?.condition === "caries" ? { ...entry, finding: { condition: "caries", icdas: event.target.value ? Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 : null, activity: entry.finding.activity ?? null } } : entry))}><option value="">Sin dictar</option>{[1, 2, 3, 4, 5, 6].map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                        <label className="space-y-1">Actividad<select className="h-9 w-full rounded-md border px-2" value={item.finding.activity ?? ""} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index && entry.finding?.condition === "caries" ? { ...entry, finding: { condition: "caries", icdas: entry.finding.icdas ?? null, activity: (event.target.value || null) as "active" | "inactive" | "uncertain" | null } } : entry))}><option value="">Sin dictar</option>{Object.entries(activityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      </>}
                    </> : <>
                      <label className="space-y-1">Estado<select className="h-9 w-full rounded-md border px-2" value={item.kind === "crown" ? "Corona" : item.status} onChange={(event) => {
                        const status = event.target.value as ToothStatus;
                        setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, kind: status === "Corona" ? "crown" : "status", status } : entry));
                      }}>{TOOTH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                      {(item.kind === "crown" || item.status === "Corona") && <>
                        <label className="space-y-1">Material<select className="h-9 w-full rounded-md border px-2" value={item.material ?? ""} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, material: event.target.value as CrownMaterial } : entry))}><option value="">Sin registrar</option>{CROWN_MATERIALS.map((material) => <option key={material} value={material}>{material}</option>)}</select></label>
                        <label className="space-y-1">Color<input className="flex h-9 w-full rounded-md border px-3" value={item.shade ?? ""} placeholder="A2" onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, shade: event.target.value } : entry))} /></label>
                      </>}
                    </>}
                  </div>}
                </article>;
              })}
            </section>
            {(proposal.procedures ?? []).length > 0 && <section className="rounded-xl border border-[#dce5e7] p-4">
              <h3 className="font-semibold">Procedimientos realizados (según la IA)</h3>
              <p className="mt-1 text-xs text-[#60757a]">Van en la nota; revísalos ahí.</p>
              <ul className="mt-2 space-y-2">{(proposal.procedures ?? []).map((item) => <li key={item.id} className="rounded-lg bg-[#f4f7f8] p-3">{item.text}{!item.verified && <span className="ml-2 text-xs font-medium text-amber-800">Sin cita literal en el dictado</span>}<Evidence text={item.verified ? item.evidence : undefined} /></li>)}</ul>
            </section>}
            {fichaItems.length > 0 && <section className="space-y-3">
              <h3 className="font-semibold">Ficha del paciente</h3>
              {!patient && <p className="text-xs text-[#71858b]">No hay ficha cargada para actualizar; quedan solo en la nota.</p>}
              {fichaItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-ficha">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p><span className="text-[#71858b]">{fichaLabel[item.field]}{item.field === "medications" ? " (se agrega a antecedentes)" : ""}: </span><span className="font-medium">{item.text}</span><OriginBadge origin={item.origin} /></p>
                    <Evidence text={item.evidence} />
                  </div>
                  <Decision value={item.decision} disabled={!patient} onChange={(decision) => setFichaItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <Input className="mt-2" aria-label={`Texto de ${fichaLabel[item.field]}`} value={item.text} onChange={(event) => setFichaItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, text: event.target.value } : entry))} />}
              </article>)}
            </section>}
            <section className="space-y-3">
              <h3 className="font-semibold">Presupuesto</h3>
              {budgets.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin prestaciones.</p>}
              {budgets.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p><span className="text-[#71858b]">Nueva prestación: </span><ChangeHighlight current="Sin esta prestación" next={`${item.label} · ${Number(item.amountText) > 0 ? `${Number(item.amountText).toLocaleString("es-CL")} pesos` : "monto pendiente"}`} /><OriginBadge origin={item.origin} /></p><Evidence text={item.evidence ?? item.sourceText} /></div>
                  <Decision value={item.decision} onChange={(decision) => setBudgets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">Prestación<input className="flex h-9 w-full rounded-md border px-3" value={item.label} onChange={(event) => setBudgets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Monto CLP<input className="flex h-9 w-full rounded-md border px-3" inputMode="numeric" value={item.amountText} onChange={(event) => setBudgets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amountText: event.target.value } : entry))} /></label>
                </div>}
              </article>)}
            </section>
            <section className="rounded-xl border border-dashed border-[#dce5e7] p-4">
              <h3 className="font-semibold">Periodontograma</h3>
              <p className="mt-1 text-xs leading-5 text-[#60757a]">En este prototipo el sondaje se muestra y no se guarda. Sigue pendiente el examen de seis sitios, margen, sangrado, supuración, movilidad, furcación, EPB por sextante, Löe-Silness y la clasificación AAP/EFP, que no se infieren.</p>
              {proposal.perio.length === 0 ? <p className="mt-2 text-[#71858b]">Sin sondaje en el dictado.</p> : <ul className="mt-2 space-y-2">{proposal.perio.map((item) => <li key={item.id} className="rounded-lg bg-[#f4f7f8] p-3">{item.numberingLabel} · {item.siteLabel}: {item.depth} mm. <span className="font-medium">No se guarda.</span></li>)}</ul>}
            </section>
            {proposal.clarifications.length > 0 && <section className="rounded-xl bg-amber-50 p-4 text-amber-950">
              <h3 className="font-semibold">Para aclarar, sin aplicar</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">{proposal.clarifications.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>}
          </div>}
          {result && <div role="status" className={`rounded-lg p-3 ${result.ok ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950"}`}>
            <p className="font-semibold">{result.ok ? "Guardado y releído." : "La relectura encontró diferencias."}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{result.messages.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>}
          {result && notRecorded.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-amber-950" data-testid="dictation-not-recorded">
            <p className="font-semibold">No consignado en la ficha estructurada</p>
            <p className="mt-1 text-xs">Sigue en la transcripción completa de la nota. Regístralo a mano si corresponde.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{notRecorded.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
          <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={!outcome || saving} onClick={() => void confirm()} data-testid="dictation-confirm">{saving ? "Guardando y releyendo…" : "Guardar lo aceptado"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function Decision({ value, onChange, disabled = false }: { value: "accepted" | "rejected"; onChange: (value: "accepted" | "rejected") => void; disabled?: boolean }) {
  return <div className="flex gap-2">
    <Button type="button" size="sm" variant={value === "accepted" ? "default" : "outline"} className={value === "accepted" ? "bg-[#087f83] hover:bg-[#07676b]" : ""} disabled={disabled} onClick={() => onChange("accepted")}>Aceptar</Button>
    <Button type="button" size="sm" variant={value === "rejected" ? "default" : "outline"} disabled={disabled} onClick={() => onChange("rejected")}>Rechazar</Button>
  </div>;
}
