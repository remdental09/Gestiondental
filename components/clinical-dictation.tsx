"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type ClinicalImage, type OdontogramData, type PerioExam } from "@/app/clinical-data";
import { createAudioTranscription, AUDIO_DICTATION_NOTICE } from "@/lib/dictation/audio-transcription";
import { checkPatientMentions, patientVariantNote, patientWarning } from "@/lib/dictation/patient-check";
import { WordDiffView } from "@/components/text-correction";
import { VoiceCommandCard, type AnnulHandler } from "@/components/evolution-annul";
import { chileTodayIso, parseVoiceCommand, type CommandNote } from "@/lib/dictation/voice-command";
import {
  answerLines,
  buildDictatedPerio,
  CARIES_DEPTHS,
  CARIES_DEPTH_SHORT,
  cariesDetail,
  cariesDiagnoses,
  cariesIcd11,
  diagnosisLabel,
  icd11Label,
  isRootCaries,
  type DiagnosisItem,
  finalizeEvolution,
  withAnswers,
  SITE_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  PERIO_SITES,
  type AppointmentChange,
  type MobilityChange,
  type PerioClassificationChange,
  type RecessionChange,
  type PaymentChange,
  type PaymentMethod,
  type PerioSite,
  type TranscriptCorrection,
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
  missingData,
} from "@/lib/dictation/proposal";
import { searchDiagnoses } from "@/lib/icd11";
import { prestacionName, withPrestacionesSection, type PrestacionItem } from "@/lib/dictation/prestaciones";
import { searchPrestaciones } from "@/lib/prestaciones-catalog";
import { sameDiagnosisTags, sanitizeDiagnosisTags, type EvolutionDiagnosisTag } from "@/lib/evolution-diagnoses";
import { evolutionNotices, type EvolutionNoticeKey } from "@/lib/dictation/evolution-notices";
import { buildFeedback, type ReviewGroup } from "@/lib/dictation/feedback";
import { spokenAlerts } from "@/lib/dictation/spoken-alerts";
import { speakPhrases, unlockSpeech } from "@/lib/dictation/speech";

type Reload = {
  patients: { id: number; name: string; birthDate: string; rut: string; phone: string; email: string; reason: string; status: string; allergies: string; history: string }[];
  notes: { id: number; patientId: number; date: string; title: string; body: string; backupStatus?: string; sourceDocumentId?: string | null; recordedAt?: string; diagnoses?: (EvolutionDiagnosisTag & { id?: number })[] }[];
  budgets: { id: number; patientId: number; title: string; items: { label: string; amount: number }[]; status: string; date: string; isAlternative: boolean; parentBudgetId: number | null }[];
  appointments: { id: number; patientId: number; day: string; time: string; reason: string }[];
  calendarEvents: { id: number; title: string; startAt: string; endAt: string; sourceTimeZone: string; htmlLink: string | null; status: string; allDay: boolean; patientId: number | null }[];
  calendarSnapshotAt?: string | null;
  periodontalExams: Record<number, PerioExam[]>;
  toothStatuses: Record<number, OdontogramData>;
  clinicalImages: ClinicalImage[];
  payments?: { id: number; patientId: number; amount: number; method: string; concept: string; paidOn: string; date: string; budgetId: number | null }[];
};

type ReviewTooth = OdontogramChange & { decision: "accepted" | "rejected"; toothText: string; incompleteCaries?: boolean };
type ReviewFicha = FichaChange & { decision: "accepted" | "rejected" };
type Decided = "accepted" | "rejected";
type ReviewPerio = { id: string; toothText: string; site: PerioSite | ""; depthText: string; bleeding: boolean; suppuration: boolean; decision: Decided; evidence?: string; origin?: ItemOrigin; pending: boolean };
type ReviewMobility = MobilityChange & { decision: Decided; toothText: string };
type ReviewRecession = RecessionChange & { decision: Decided; toothText: string; mmText: string };
type ReviewPayment = PaymentChange & { decision: Decided; amountText: string; methodValue: PaymentMethod | ""; budgetId: string };
const normalizeBudgetMatch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function suggestedPaymentBudget(
  payment: PaymentChange,
  proposed: ReviewBudget[],
  existing: { id: number; title: string }[],
): string {
  const byId = proposed.find((budget) => budget.id === payment.budgetRef && budget.decision === "accepted");
  if (byId) return "proposal:" + byId.id;

  const concepts = normalizeBudgetMatch(payment.concept).split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["presupuesto", "tratamiento"].includes(word));
  const proposedCandidates = proposed.filter((budget) => budget.decision === "accepted");
  if (payment.baseAmount) {
    const exact = proposedCandidates.filter((budget) => budget.amount === payment.baseAmount);
    if (exact.length === 1) return "proposal:" + exact[0].id;
    if (exact.length > 1 && concepts.length) {
      const matched = exact.filter((budget) => concepts.some((word) => normalizeBudgetMatch(budget.title + " " + budget.label).includes(word)));
      if (matched.length === 1) return "proposal:" + matched[0].id;
    }
  }

  if (concepts.length) {
    const candidates = [
      ...proposedCandidates.map((budget) => ({ value: "proposal:" + budget.id, text: budget.title + " " + budget.label })),
      ...existing.map((budget) => ({ value: "existing:" + budget.id, text: budget.title })),
    ].filter((budget) => concepts.some((word) => normalizeBudgetMatch(budget.text).includes(word)));
    if (candidates.length === 1) return candidates[0].value;
    if (candidates.length > 1) return "";
    const onlyAvailable = [
      ...proposedCandidates.map((budget) => "proposal:" + budget.id),
      ...existing.map((budget) => "existing:" + budget.id),
    ];
    return onlyAvailable.length === 1 ? onlyAvailable[0] : "";
  }

  const all = [
    ...proposedCandidates.map((budget) => "proposal:" + budget.id),
    ...existing.map((budget) => "existing:" + budget.id),
  ];
  return all.length === 1 ? all[0] : "";
}

type ReviewAppointment = AppointmentChange & { decision: Decided; dayValue: string; timeValue: string };
/** Etiqueta de diagnóstico en revisión: la sugerida (AAE o caries pulpar) parte sin aceptar. */
type ReviewDiagnosis = DiagnosisItem & { decision: Decided; toothText: string; findingsText: string; codeSearch: string };
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

const EXAMPLE = "El paciente refiere dolor al frío. Se observa caries en la cara oclusal de la pieza FDI 3.6, de dentina profunda. Pieza 2.6 con pulpitis. Pieza 12 con obturación oclusal. Niega alergia a penicilina. Presupuesto de corona de zirconio, 350000 pesos. Sondaje de 4 mm en mesial vestibular de FDI 1.6.";

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
const DEPTH_QUESTION = /¿profundidad de la caries/i;

function findingText(finding?: { condition: SurfaceFinding["condition"]; depth?: SurfaceFinding["depth"]; icdas?: SurfaceFinding["icdas"]; activity?: SurfaceFinding["activity"] }): string {
  if (!finding) return "Sin registrar";
  if (finding.condition !== "caries") return conditionLabel[finding.condition];
  // Profundidad (o el ICDAS de un registro anterior) y su código CIE-11.
  return `${conditionLabel.caries} · ${cariesDetail(finding)} · CIE-11 ${cariesIcd11(finding.depth).code}`;
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
  budgetOptions = [],
  request = null,
  notes = [],
  onAnnul,
  prominent = false,
}: {
  patientId: number;
  patientName: string;
  odontogram: OdontogramData;
  latestNote: { title: string; body: string } | null;
  patient?: PatientFicha | null;
  persist: (input: Record<string, unknown>) => Promise<{ note?: { id: number; title: string; body: string; clinicalDate?: string }; budget?: { id: number }; payment?: { id: number }; appointment?: { id: number }; exam?: { id: number } }>;
  budgetOptions?: { id: number; title: string }[];
  onApplied: (data: Reload) => void;
  /** Abre el dictado desde otro lugar (p. ej. «Nueva evolución») con un texto ya escrito o dictado, y lo corrige con IA. */
  request?: { nonce: number; text: string; ignoreCommand?: boolean; incorporate?: boolean } | null;
  /** Evoluciones del paciente, para resolver órdenes dictadas («elimina el último dictado…»). */
  notes?: (CommandNote & { diagnoses?: Partial<EvolutionDiagnosisTag>[] })[];
  onAnnul?: AnnulHandler;
  /** Botón grande «Dictar en esta ficha» (barra fija de la ficha abierta). */
  prominent?: boolean;
}) {
  const engine = useRef(createAudioTranscription());
  const answerEngine = useRef(createAudioTranscription());
  const requestId = useRef("");
  const session = useRef("");
  // Avisos ya dichos en voz alta en este dictado: no se repiten al volver a procesar tras tus correcciones.
  const spokenBefore = useRef(new Set<string>());
  // Lo que propuso el sistema, para registrar después qué corrigió el profesional.
  const originalProposal = useRef<{ text: string; proposal: StructureOutcome["proposal"] } | null>(null);
  // Lo ya guardado en este dictado no se repite si hay que reintentar tras un error.
  const savedOnce = useRef(new Map<string, number>());
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(true);
  const [unsupportedMessage, setUnsupportedMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioRetry, setAudioRetry] = useState<"main" | "answer" | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [outcome, setOutcome] = useState<StructureOutcome | null>(null);
  const [evolutionTitle, setEvolutionTitle] = useState("");
  const [attentionDate, setAttentionDate] = useState("");
  const [evolutionBody, setEvolutionBody] = useState("");
  const [teeth, setTeeth] = useState<ReviewTooth[]>([]);
  const [budgets, setBudgets] = useState<ReviewBudget[]>([]);
  const [fichaItems, setFichaItems] = useState<ReviewFicha[]>([]);
  const [notRecorded, setNotRecorded] = useState<string[]>([]);
  const [workingText, setWorkingText] = useState("");
  const [corrections, setCorrections] = useState<TranscriptCorrection[]>([]);
  const [perioItems, setPerioItems] = useState<ReviewPerio[]>([]);
  const [mobilityItems, setMobilityItems] = useState<ReviewMobility[]>([]);
  const [recessionItems, setRecessionItems] = useState<ReviewRecession[]>([]);
  const [classItem, setClassItem] = useState<(PerioClassificationChange & { decision: Decided }) | null>(null);
  const [paymentItems, setPaymentItems] = useState<ReviewPayment[]>([]);
  const [appointmentItems, setAppointmentItems] = useState<ReviewAppointment[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [patientConfirmed, setPatientConfirmed] = useState(false);
  const [dxItems, setDxItems] = useState<ReviewDiagnosis[]>([]);
  const [prestItems, setPrestItems] = useState<Array<PrestacionItem & { decision: Decided }>>([]);
  const [prestSearch, setPrestSearch] = useState("");
  const [dxSearch, setDxSearch] = useState("");
  // Avisos descartados con «No es necesario ahora»: valen solo para esta evolución.
  const [dismissedNotices, setDismissedNotices] = useState<Set<EvolutionNoticeKey>>(new Set());
  // Al terminar un dictado (Detener, corte de Safari o error) se corrige solo con IA, una vez por dictado.
  const autoPending = useRef(false);
  const heard = useRef({ text: "", interim: "" });
  const [lastStructured, setLastStructured] = useState("");
  const stopFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Una orden dictada (anular/reemplazar una evolución) no se corrige como nota: se muestra su tarjeta.
  const [commandIgnored, setCommandIgnored] = useState(false);
  const isCommand = (text: string) => !!onAnnul && !!parseVoiceCommand(text, chileTodayIso());
  const command = useMemo(() => listening || commandIgnored || !onAnnul ? null : parseVoiceCommand(transcript, chileTodayIso()), [transcript, listening, commandIgnored, onAnnul]);
  // Chequeo de paciente en el navegador: el nombre y el RUT de la ficha no viajan a la IA.
  const patientCheck = outcome ? checkPatientMentions([transcript, workingText].filter(Boolean).join("\n"), { name: patientName, rut: patient?.rut }) : null;
  const patientWarnings = patientCheck ? patientWarning(patientCheck, patientName, patient?.rut) : [];
  const patientBlocked = patientWarnings.length > 0 && !patientConfirmed;
  const patientVariants = patientCheck ? patientVariantNote(patientCheck, patientName) : [];

  useEffect(() => {
    const transcription = engine.current;
    const answerTranscription = answerEngine.current;
    setSupported(transcription.isSupported());
    setUnsupportedMessage(transcription.unsupportedMessage());
    return () => { transcription.abort(); answerTranscription.abort(); };
  }, []);

  const resetReview = () => {
    setOutcome(null);
    setPatientConfirmed(false);
    setTeeth([]);
    setBudgets([]);
    setFichaItems([]);
    setNotRecorded([]);
    setWorkingText("");
    setCorrections([]);
    setPerioItems([]);
    setMobilityItems([]);
    setClassItem(null);
    setRecessionItems([]);
    setPaymentItems([]);
    setAppointmentItems([]);
    setDxItems([]);
    setDxSearch("");
    setPrestItems([]);
    setPrestSearch("");
    setDismissedNotices(new Set());
    setAnswers({});
    setResult(null);
    setFormError("");
  };

  const close = () => {
    spokenBefore.current.clear();
    autoPending.current = false;
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    engine.current.abort();
    answerEngine.current.abort();
    setAnswering(null);
    setListening(false);
    setInterim("");
    setTranscribing(false);
    setAudioRetry(null);
    setOpen(false);
  };

  const start = async () => {
    unlockSpeech();
    if (transcribing || answering) return;
    setSpeechError("");
    setResult(null);
    if (!engine.current.isSupported()) {
      setSupported(false);
      setSpeechError(engine.current.unsupportedMessage());
      return;
    }

    setListening(true);
    autoPending.current = true;
    heard.current = { text: transcript, interim: "" };
    engine.current.start(transcript, {
      onStatus: (status) => { setTranscribing(status === "transcribing"); setListening(status === "starting" || status === "recording"); if (status !== "error") setAudioRetry(null); },
      onTranscript: (text, spokenInterim) => {
        heard.current = { text, interim: spokenInterim };
        setTranscript(text);
        setInterim(spokenInterim);
        resetReview();
      },
      onError: (message) => {
        setSpeechError(message);
        setAudioRetry(engine.current.hasPendingAudio?.() ? "main" : null);
        setListening(false);
        setInterim("");
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
        correctAfterDictation();
      },
    });
  };

  const dictateAnswer = async (question: string) => {
    if (transcribing || listening) return;
    if (answering === question) {
      answerEngine.current.stop();
      setAnswering(null);
      return;
    }
    answerEngine.current.abort();
    if (listening) stop();
    autoPending.current = false;
    setSpeechError("");
    if (!answerEngine.current.isSupported()) {
      setSpeechError(answerEngine.current.unsupportedMessage());
      return;
    }

    setAnswering(question);
    answerEngine.current.start(answers[question] ?? "", {
      onStatus: (status) => { setTranscribing(status === "transcribing"); if (status !== "error") setAudioRetry(null); },
      onTranscript: (text, spoken) => setAnswers((current) => ({ ...current, [question]: spoken ? `${text} ${spoken}`.trim() : text })),
      onError: (message) => { setSpeechError(message); setAudioRetry(answerEngine.current.hasPendingAudio?.() ? "answer" : null); setAnswering(null); },
      onEnd: () => setAnswering(null),
    });
  };

  const structure = async (text = transcript) => {
    if (transcribing || answering) return;
    setFormError("");
    setResult(null);
    if (answering) { answerEngine.current.stop(); setAnswering(null); }
    setLastStructured(text);
    setStructuring(true);
    setPatientConfirmed(false);
    try {
      const response = await fetch("/api/dictation/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          chart: Object.entries(odontogram.teeth).map(([tooth, status]) => ({ tooth: Number(tooth), status })),
        }),
      });
      const data = await response.json() as StructureOutcome & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo corregir el dictado.");
      setOutcome(data);
      originalProposal.current = { text, proposal: data.proposal };
      setEvolutionTitle(data.proposal.evolution?.title ?? "");
      setEvolutionBody(data.proposal.evolution?.body ?? "");
      // Lo que IA y reglas no comparten, o un hallazgo incompleto, parte rechazado. La caries sin profundidad sí se propone.
      setTeeth([
        // Un cambio con advertencia (p. ej. volver a marcar un implante en un control) también parte sin aceptar.
        ...data.proposal.odontogram.map((item) => ({ ...item, decision: item.conflict || item.advisory ? "rejected" as const : "accepted" as const, toothText: formatFdi(item.tooth) })),
        ...(data.proposal.incomplete ?? []).map((item) => ({ ...item, decision: "rejected" as const, toothText: formatFdi(item.tooth), incompleteCaries: true })),
      ]);
      setBudgets(data.proposal.budget.map((item) => ({ ...item, decision: "accepted", amountText: item.amount > 0 ? String(item.amount) : "" })));
      setFichaItems((data.proposal.ficha ?? []).map((item) => ({ ...item, decision: patient ? "accepted" : "rejected" })));
      setNotRecorded([]);
      requestId.current = "";
      session.current = crypto.randomUUID();
      savedOnce.current.clear();
      setWorkingText(data.proposal.corrected?.text ?? text);
      setCorrections(data.proposal.corrected?.corrections ?? []);
      setAnswers({});
      setPerioItems([
        ...data.proposal.perio.map((item) => ({ id: item.id, toothText: formatFdi(item.tooth), site: item.site, depthText: String(item.depth), bleeding: item.bleeding ?? false, suppuration: item.suppuration ?? false, decision: "accepted" as const, evidence: item.evidence ?? item.sourceText, origin: item.origin, pending: false })),
        ...(data.proposal.perioPending ?? []).map((item) => ({ id: item.id, toothText: formatFdi(item.tooth), site: item.site ?? "" as const, depthText: item.depth === null ? "" : String(item.depth), bleeding: item.bleeding, suppuration: item.suppuration, decision: "rejected" as const, evidence: item.evidence, origin: item.origin, pending: true })),
      ]);
      setRecessionItems((data.proposal.recession ?? []).map((item) => ({ ...item, decision: "accepted" as const, toothText: formatFdi(item.tooth), mmText: String(item.mm) })));
      setClassItem(data.proposal.perioClassification ? { ...data.proposal.perioClassification, decision: "accepted" } : null);
      setMobilityItems((data.proposal.mobility ?? []).map((item) => ({ ...item, decision: "accepted", toothText: formatFdi(item.tooth) })));
      setPaymentItems((data.proposal.payments ?? []).map((item) => ({
        ...item,
        decision: "accepted",
        amountText: String(item.amount),
        methodValue: item.method ?? "",
        budgetId: suggestedPaymentBudget(item, (data.proposal.budget ?? []).map((budget) => ({ ...budget, decision: "accepted" as const, amountText: String(budget.amount) })), budgetOptions),
      })));
      // Las caries se derivan en vivo de lo aceptado en el odontograma; el resto se revisa una por una.
      setPrestItems((data.proposal.prestaciones ?? []).map((item) => ({ ...item, decision: "accepted" as const })));
      setDxItems((data.proposal.diagnoses ?? []).filter((item) => !item.code.startsWith("DA08.0")).map((item) => ({ ...item, decision: item.suggested ? "rejected" as const : "accepted" as const, toothText: item.tooth ? formatFdi(item.tooth) : "", findingsText: item.findings ?? "", codeSearch: "" })));
      setDxSearch("");
      setDismissedNotices(new Set());
      setAppointmentItems((data.proposal.appointments ?? []).map((item) => ({ ...item, decision: item.day && item.time && !item.timeDoubt ? "accepted" : "rejected", dayValue: item.day ?? "", timeValue: item.time ?? "" })));
    } catch (cause) {
      setOutcome(null);
      setFormError(`No se pudo corregir con IA: ${cause instanceof Error && !/failed to fetch|load failed|network/i.test(cause.message) ? cause.message : "sin conexión con el servidor"}. Nada se guardó.`);
    } finally {
      setStructuring(false);
    }
  };

  /** Corrige con IA lo dictado apenas termina el dictado, sin esperar a «Preparar propuesta». */
  const correctAfterDictation = () => {
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    if (!autoPending.current) return;
    autoPending.current = false;
    const text = [heard.current.text, heard.current.interim].filter(Boolean).join(" ").trim();
    heard.current = { text, interim: "" };
    if (text.length < 3) return;
    setTranscript(text);
    if (!commandIgnored && isCommand(text)) return;
    void structure(text);
  };

  const stop = () => {
    unlockSpeech();
    setTranscribing(true);
    setListening(false);
    engine.current.stop();
  };

  /** Escribir a mano o cargar el ejemplo detiene el dictado sin corregir solo. */
  const stopWithoutCorrecting = () => {
    autoPending.current = false;
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    engine.current.abort();
    setTranscribing(false);
    setAudioRetry(null);
    setListening(false);
    setInterim("");
  };

  const lastRequest = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === lastRequest.current) return;
    // Diferido para no encadenar renders dentro del efecto (y sobrevivir al doble efecto de StrictMode).
    const pending = setTimeout(() => {
      lastRequest.current = request.nonce;
      setOpen(true);
      const text = request.text.trim();
      if (text.length >= 3) {
        setTranscript(text);
        setInterim("");
        resetReview();
        setCommandIgnored(!!request.ignoreCommand);
        if (request.ignoreCommand || !isCommand(text)) void structure(text);
      }
    }, 0);
    return () => clearTimeout(pending);
    // structure depende del estado actual del odontograma; solo se dispara con cada pedido nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  /** Responde una aclaración por voz: el texto dictado llena su campo. */
  const applyAnswers = () => {
    if (!outcome) return;
    const lines = answerLines(outcome.proposal.clarifications.map((question) => ({ question, answer: answers[question] ?? "" })));
    if (!lines.length) {
      setFormError("Escribe o dicta al menos una respuesta.");
      return;
    }
    const next = withAnswers(workingText || outcome.proposal.corrected?.text || transcript, lines);
    void structure(next);
  };

  const reload = async () => {
    const response = await fetch("/api/clinical", { cache: "no-store" });
    const data = await response.json() as Reload & { error?: string };
    if (!response.ok) throw new Error(data.error || "No se pudo releer la ficha.");
    return data;
  };

  const confirm = async () => {
    if (!outcome || saving || result?.ok) return;
    if (patientBlocked) {
      setFormError(`El dictado nombra a otra persona o a otro RUT. Confirma que corresponde a ${patientName} antes de guardar.`);
      return;
    }
    const reviewWarnings: string[] = [];
    let acceptedTeeth: OdontogramChange[] = [];
    for (const item of teeth) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText);
      if (!tooth) {
        reviewWarnings.push(`${item.numberingLabel}: la pieza no está en nomenclatura FDI válida; no se actualizó el odontograma.`);
        continue;
      }
      const next = { ...item, tooth, numberingLabel: tooth === item.tooth ? item.numberingLabel : `FDI ${formatFdi(tooth)}`, numbering: tooth === item.tooth ? item.numbering : "FDI" as const };
      const issue = reviewIssue(next);
      if (issue) {
        reviewWarnings.push(`${item.numberingLabel}: ${issue} El hallazgo quedó fuera del odontograma.`);
        continue;
      }
      acceptedTeeth.push(next);
    }
    const targets = new Map<string, OdontogramChange[]>();
    for (const item of acceptedTeeth) {
      const target = item.kind === "surface" && item.surface
        ? `surface:${item.tooth}:${item.surface}`
        : `${item.kind}:${item.tooth}`;
      targets.set(target, [...(targets.get(target) ?? []), item]);
    }
    const duplicateTargets = new Set([...targets].filter(([, items]) => items.length > 1).map(([target]) => target));
    if (duplicateTargets.size) {
      reviewWarnings.push("Hay propuestas duplicadas para una pieza o superficie. Se omitieron del odontograma para evitar conflictos.");
      acceptedTeeth = acceptedTeeth.filter((item) => {
        const target = item.kind === "surface" && item.surface
          ? `surface:${item.tooth}:${item.surface}`
          : `${item.kind}:${item.tooth}`;
        return !duplicateTargets.has(target);
      });
    }
    const acceptedBudgets: BudgetChange[] = [];
    for (const item of budgets) {
      if (item.decision !== "accepted") continue;
      const amount = Number(item.amountText);
      if (!item.label.trim() || !Number.isSafeInteger(amount) || amount < 1) {
        reviewWarnings.push(`Presupuesto «${item.label || "sin prestación"}»: revisa prestación y monto en pesos; no se registró.`);
        continue;
      }
      acceptedBudgets.push({ ...item, label: item.label.trim(), amount });
    }
    const acceptedPayments: { key: string; amount: number; method: PaymentMethod; concept: string; budgetSelection: string }[] = [];
    for (const item of paymentItems) {
      if (item.decision !== "accepted") continue;
      const amount = Number(item.amountText.replace(/\./g, ""));
      const method = item.methodValue;
      if (!Number.isSafeInteger(amount) || amount < 1) {
        reviewWarnings.push("Un abono dictado necesita un monto válido; quedó pendiente de revisión.");
        continue;
      }
      if (!method) {
        reviewWarnings.push(`Abono de $${amount.toLocaleString("es-CL")}: falta confirmar el medio de pago; quedó pendiente y no detiene la evolución.`);
        continue;
      }
      let budgetSelection = item.budgetId;
      const proposalMatch = /^proposal:(.+)$/.exec(budgetSelection);
      if (proposalMatch && !acceptedBudgets.some((budget) => budget.id === proposalMatch[1])) {
        reviewWarnings.push(`Abono de $${amount.toLocaleString("es-CL")}: se guardará sin vincular a un presupuesto que no fue aceptado.`);
        budgetSelection = "";
      }
      const existingMatch = /^existing:(\d+)$/.exec(budgetSelection);
      if (existingMatch && !budgetOptions.some((budget) => budget.id === Number(existingMatch[1]))) {
        reviewWarnings.push(`Abono de $${amount.toLocaleString("es-CL")}: el presupuesto vinculado ya no está disponible; se guardará sin vínculo.`);
        budgetSelection = "";
      }
      acceptedPayments.push({ key: "pay:" + item.id + ":" + amount + ":" + method + ":" + budgetSelection, amount, method, concept: item.concept.trim(), budgetSelection });
    }
    const acceptedAppointments: { key: string; day: string; time: string; reason: string }[] = [];
    for (const item of appointmentItems) {
      if (item.decision !== "accepted") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dayValue) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.timeValue) || !item.reason.trim()) {
        reviewWarnings.push(`Próxima cita «${item.said || item.evidence}»: revisa fecha, hora y motivo; no se agendó.`);
        continue;
      }
      acceptedAppointments.push({ key: `cita:${item.id}:${item.dayValue}:${item.timeValue}`, day: item.dayValue, time: item.timeValue, reason: item.reason.trim() });
    }
    const perioReadings: { tooth: number; site: PerioSite; depth: number; bleeding: boolean; suppuration: boolean }[] = [];
    for (const item of perioItems) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText), depth = Number(item.depthText);
      if (!tooth || !item.site || item.depthText.trim() === "" || !Number.isInteger(depth) || depth < 0 || depth > 20) {
        reviewWarnings.push(`Sondaje FDI ${item.toothText || "sin pieza"}: revisa pieza, sitio y profundidad; no se incorporó al periodontograma.`);
        continue;
      }
      if (perioReadings.some((reading) => reading.tooth === tooth && reading.site === item.site)) {
        reviewWarnings.push(`El sitio ${item.site} de FDI ${formatFdi(tooth)} está repetido; se omitió el dato duplicado.`);
        continue;
      }
      perioReadings.push({ tooth, site: item.site, depth, bleeding: item.bleeding, suppuration: item.suppuration });
    }
    const perioMobility: { tooth: number; grade: string; kind?: "furcacion" }[] = [];
    for (const item of mobilityItems) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText);
      if (!tooth) {
        reviewWarnings.push(`Movilidad «${item.toothText}»: revisa la pieza FDI; no se incorporó al periodontograma.`);
        continue;
      }
      perioMobility.push({ tooth, grade: item.grade, ...(item.kind ? { kind: item.kind } : {}) });
    }
    const perioRecessions: { tooth: number; site: PerioSite; mm: number }[] = [];
    for (const item of recessionItems) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText), mm = Number(item.mmText);
      if (!tooth || !Number.isInteger(mm) || mm < 1 || mm > 10) {
        reviewWarnings.push(`Recesión «${item.toothText} ${item.mmText}»: revisa la pieza y los milímetros (1 a 10); no se incorporó al periodontograma.`);
        continue;
      }
      perioRecessions.push({ tooth, site: item.site, mm });
    }
    const perioClassification = classItem && classItem.decision === "accepted" && (classItem.stage || classItem.grade) ? { system: "AAP-EFP 2017" as const, ...(classItem.stage ? { stage: classItem.stage } : {}), ...(classItem.grade ? { grade: classItem.grade } : {}), ...(classItem.extent ? { extent: classItem.extent } : {}) } : null;
    const savePerio = perioReadings.length > 0 || perioMobility.length > 0 || perioRecessions.length > 0 || perioClassification !== null;
    const diagnosis = diagnosisPlan(acceptedTeeth);
    const dxPlan = "error" in diagnosis ? null : diagnosis;
    if (!dxPlan) reviewWarnings.push((diagnosis as { error: string }).error + " Los datos estructurados de diagnóstico quedaron pendientes; la nota clínica se guarda.");
    const acceptedFicha = fichaItems.filter((item) => item.decision === "accepted");
    const fichaUpdate = patient ? planFichaUpdate(patient, acceptedFicha) : null;
    const saveEvolution = evolutionBody.trim().length > 0;
    const finalBody = saveEvolution ? withPrestacionesSection(finalizeEvolution(evolutionBody, acceptedTeeth, dxPlan?.items.length ? dxPlan.items : undefined), prestItems.filter((item) => item.decision === "accepted")) : "";
    const dxTags = saveEvolution ? dxPlan?.tags ?? [] : [];
    if (!saveEvolution && !acceptedTeeth.length && !acceptedBudgets.length && !fichaUpdate && !acceptedPayments.length && !acceptedAppointments.length && !savePerio) {
      setFormError("No hay una evolución ni cambios estructurados listos para guardar. Revisa la nota o los campos opcionales.");
      return;
    }
    const logFeedback = async () => {
      // Registro de correcciones: nunca debe interferir con el guardado clínico.
      try {
        const original = originalProposal.current;
        if (!original) return;
        const p = original.proposal;
        const groups: ReviewGroup[] = [
          { category: "odontograma", proposed: [...p.odontogram, ...(p.incomplete ?? [])] as ReviewGroup["proposed"], final: teeth as ReviewGroup["final"] },
          { category: "presupuesto", proposed: p.budget as ReviewGroup["proposed"], final: budgets.map((item) => ({ ...item, amount: Number(item.amountText) || 0 })) as ReviewGroup["final"] },
          { category: "ficha", proposed: (p.ficha ?? []) as ReviewGroup["proposed"], final: fichaItems as ReviewGroup["final"] },
          { category: "periodontal", proposed: [...p.perio, ...(p.perioPending ?? [])].map((item) => ({ id: item.id, site: item.site ?? "", depth: item.depth ?? null, bleeding: Boolean(item.bleeding), suppuration: Boolean(item.suppuration), origin: item.origin })), final: perioItems.map((item) => ({ id: item.id, decision: item.decision, site: item.site, depth: item.depthText === "" ? null : Number(item.depthText), bleeding: item.bleeding, suppuration: item.suppuration, origin: item.origin })) },
          { category: "movilidad", proposed: (p.mobility ?? []) as ReviewGroup["proposed"], final: mobilityItems as ReviewGroup["final"] },
          { category: "pago", proposed: (p.payments ?? []) as ReviewGroup["proposed"], final: paymentItems.map((item) => ({ ...item, amount: Number(item.amountText) || 0, method: item.methodValue })) as ReviewGroup["final"] },
          { category: "cita", proposed: (p.appointments ?? []) as ReviewGroup["proposed"], final: appointmentItems.map((item) => ({ ...item, day: item.dayValue, time: item.timeValue })) as ReviewGroup["final"] },
          { category: "diagnostico", proposed: (p.diagnoses ?? []).filter((item) => !item.code.startsWith("DA08.0")) as ReviewGroup["proposed"], final: dxItems as ReviewGroup["final"] },
        ];
        const entries = buildFeedback(groups);
        if (!entries.length) return;
        await fetch("/api/dictation/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, session: session.current, transcript: original.text, correctedText: workingText, entries }),
        });
      } catch { /* el registro es opcional */ }
    };
    setSaving(true);
    setFormError("");
    setResult(null);
    const before = odontogram;
    let after = odontogram;
    let savedNote: { id?: number; title: string; body: string; clinicalDate?: string } | null = null;
    const savedBudgetByProposal = new Map<string, number>();
    const savedPayments: { amount: number; method: string; savedId?: number }[] = [];
    const savedAppointments: { day: string; time: string; reason: string; savedId?: number }[] = [];
    let examId: number | undefined;
    const once = async (key: string, run: () => Promise<number | undefined>) => {
      const known = savedOnce.current.get(key);
      if (known !== undefined) return known;
      const id = await run();
      if (id !== undefined) savedOnce.current.set(key, id);
      return id;
    };
    try {
      if (saveEvolution) {
        requestId.current ||= crypto.randomUUID();
        const saved = await persist({ action: "addNote", patientId, title: evolutionTitle.trim() || "Evolución dictada", body: finalBody, requestId: requestId.current, ...(attentionDate ? { clinicalDate: attentionDate } : {}) });
        savedNote = { id: saved.note?.id, title: evolutionTitle.trim() || "Evolución dictada", body: saved.note?.body ?? finalBody, clinicalDate: saved.note?.clinicalDate };
        if (saved.note?.id && dxTags.length) await persist({ action: "setEvolutionDiagnoses", patientId, evolutionId: saved.note.id, tags: dxTags });
        const readBack = await reload();
        after = readBack.toothStatuses[patientId] ?? before;
        onApplied(readBack);
      }
      for (const [index, action] of planChartWrites(patientId, before, after, acceptedTeeth).entries()) {
        const linkedAction = savedNote?.id
          ? { ...action, sourceEvolutionId: savedNote.id, sourceActionId: (savedNote.id + ":" + (action.sourceActionId || "chart-" + index)).slice(0, 180) }
          : action;
        await persist(linkedAction);
      }
      // Un plan por opción dictada (la primera es el principal, las demás son alternativas), con todas sus prestaciones y fases.
      const budgetGroups = new Map<string, typeof acceptedBudgets>();
      for (const item of acceptedBudgets) budgetGroups.set(item.option ?? "", [...(budgetGroups.get(item.option ?? "") ?? []), item]);
      let mainBudgetId: number | undefined;
      for (const [option, group] of budgetGroups) {
        const items = group.map((entry) => ({ label: entry.label, amount: entry.amount, ...(entry.phase ? { phase: entry.phase } : {}), ...(entry.catalogCode ? { code: entry.catalogCode } : {}) }));
        const title = option ? `${group[0].title} · Opción ${option}` : group[0].title;
        const parentBudgetId = mainBudgetId;
        const id = await once("budget:" + option + ":" + group.map((entry) => entry.id + ":" + entry.label + ":" + entry.amount).join("|"), async () => (await persist({ action: "addBudget", patientId, title, items, ...(attentionDate ? { clinicalDate: attentionDate } : {}), ...(parentBudgetId ? { parentBudgetId } : {}) })).budget?.id);
        if (id) {
          if (!mainBudgetId) mainBudgetId = id;
          for (const entry of group) savedBudgetByProposal.set(entry.id, id);
        }
      }
      for (const item of acceptedPayments) {
        const proposalMatch = /^proposal:(.+)$/.exec(item.budgetSelection);
        const existingMatch = /^existing:(\d+)$/.exec(item.budgetSelection);
        const budgetId = proposalMatch ? savedBudgetByProposal.get(proposalMatch[1]) ?? null : existingMatch ? Number(existingMatch[1]) : null;
        const savedId = await once(item.key, async () => (await persist({ action: "addPayment", patientId, amount: item.amount, method: item.method, concept: item.concept, budgetId, requestId: (session.current + ":" + item.key).slice(0, 80) })).payment?.id);
        savedPayments.push({ amount: item.amount, method: item.method, savedId });
      }
      for (const item of acceptedAppointments) {
        const savedId = await once(item.key, async () => (await persist({ action: "addAppointment", patientId, day: item.day, time: item.time, reason: item.reason })).appointment?.id);
        savedAppointments.push({ day: item.day, time: item.time, reason: item.reason, savedId });
      }
      if (savePerio) {
        const key = `perio:${JSON.stringify(perioReadings)}:${JSON.stringify(perioMobility)}:${JSON.stringify(perioRecessions)}:${JSON.stringify(perioClassification)}`;
        examId = await once(key, async () => (await persist({ action: "savePerio", patientId, teeth: buildDictatedPerio(perioReadings, perioMobility, perioRecessions), ...(perioClassification ? { classification: perioClassification } : {}), ...(attentionDate ? { clinicalDate: attentionDate } : {}) })).exam?.id);
      }
      if (fichaUpdate && patient) {
        await persist({ action: "updatePatient", patientId, name: patient.name, rut: patient.rut, phone: patient.phone, email: patient.email, allergies: fichaUpdate.allergies, history: fichaUpdate.history });
      }
      const finalRead = await reload();
      const noteConfirmed = !!savedNote && finalRead.notes.some((note) => note.patientId === patientId && (savedNote?.id ? note.id === savedNote.id : note.title === savedNote?.title) && note.body === savedNote?.body);
      let check = verifyDictationSave({
        patientId,
        before,
        note: savedNote,
        accepted: acceptedTeeth,
        budgets: acceptedBudgets,
        savedBudgetIds: acceptedBudgets.map((entry) => savedBudgetByProposal.get(entry.id)),
        payments: savedPayments,
        appointments: savedAppointments,
        perio: savePerio ? { examId, readings: perioReadings, mobility: perioMobility, recessions: perioRecessions } : null,
      }, {
        notes: finalRead.notes,
        budgets: finalRead.budgets,
        toothStatuses: finalRead.toothStatuses,
        payments: finalRead.payments ?? [],
        appointments: finalRead.appointments,
        periodontalExams: finalRead.periodontalExams,
      });
      if (savedNote?.id && dxTags.length) {
        const rereadNote = finalRead.notes.find((entry) => entry.id === savedNote?.id);
        if (!rereadNote || !sameDiagnosisTags(dxTags, rereadNote.diagnoses ?? [])) check = { ok: false, messages: [...check.messages, "Los diagnósticos releídos de la evolución no coinciden con los aceptados."] };
        else check = { ...check, messages: [...check.messages, `${dxTags.length} diagnóstico(s) de la evolución guardados y releídos.`] };
      }
      if (fichaUpdate) {
        const reread = finalRead.patients.find((entry) => entry.id === patientId);
        if (!reread || reread.allergies !== fichaUpdate.allergies || reread.history !== fichaUpdate.history) check = { ok: false, messages: [...check.messages, "Alergias o antecedentes releídos no coinciden con lo aceptado."] };
        else check = { ...check, messages: [...check.messages, "Alergias y antecedentes de la ficha actualizados y releídos."] };
      }
      if (reviewWarnings.length) check = { ...check, messages: [...check.messages, `${saveEvolution ? "La evolución" : "La ficha"} quedó guardada; algunos campos opcionales siguen pendientes de revisión.`] };
      onApplied(finalRead);
      setResult(check);
      void logFeedback();
      setNotRecorded([
        ...reviewWarnings,
        ...teeth.filter((item) => item.decision !== "accepted").map((item) => `${item.numberingLabel}${item.surface ? ` · ${surfaceLabel[item.surface]}` : ""}: ${item.kind === "surface" ? findingText(item.finding) : item.kind === "crown" ? "Corona" : item.status} — ${item.incompleteCaries ? "incompleto" : "rechazado"}.`),
        ...budgets.filter((item) => item.decision !== "accepted").map((item) => `Presupuesto: ${item.label} — rechazado.`),
        ...fichaItems.filter((item) => item.decision !== "accepted" || !patient).map((item) => `${fichaLabel[item.field]}: ${item.text} — no se pasó a la ficha.`),
        ...perioItems.filter((item) => item.decision !== "accepted").map((item) => `Sondaje FDI ${item.toothText}${item.site ? ` ${item.site}` : ""}${item.depthText ? ` ${item.depthText} mm` : ""} — ${item.pending ? "incompleto, no se guardó" : "rechazado"}.`),
        ...paymentItems.filter((item) => item.decision !== "accepted").map((item) => `Pago $${Number(item.amountText || 0).toLocaleString("es-CL")} — no se registró.`),
        ...appointmentItems.filter((item) => item.decision !== "accepted").map((item) => `Cita «${item.said || item.evidence}» — no se agendó.`),
        ...dxItems.filter((item) => item.decision !== "accepted").map((item) => `Diagnóstico ${item.code || "sin código"} ${item.title}${item.toothText ? ` (FDI ${item.toothText})` : ""} — ${item.suggested ? "sugerencia no confirmada" : "rechazado"}.`),
        ...(!saveEvolution && dxPlan?.tags.length ? ["Los diagnósticos aceptados no se guardaron porque no se generó evolución."] : []),
        ...outcome.proposal.clarifications.filter((question) => !DEPTH_QUESTION.test(question)),
        ...(!saveEvolution ? ["El dictado no generó texto de evolución; los campos estructurados aceptados se guardaron por separado."] : []),
      ]);
      if (!check.ok) setFormError(noteConfirmed ? "La evolución se guardó y se releyó. Revisa las diferencias en los campos opcionales." : "La relectura no confirmó todo lo aceptado. Revisa el estado detallado antes de volver a guardar.");
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "No se pudo completar el guardado.";
      let recovered: Awaited<ReturnType<typeof reload>> | null = null;
      try { recovered = await reload(); onApplied(recovered); } catch { /* la ficha visible puede seguir en el estado anterior */ }
      const noteRecovered = !!savedNote && !!recovered?.notes.some((note) => note.patientId === patientId && (savedNote?.id ? note.id === savedNote.id : note.title === savedNote?.title) && note.body === savedNote?.body);
      if (noteRecovered) {
        setResult({ ok: false, messages: ["La evolución clínica se guardó y se releyó; algunos datos opcionales no se completaron.", errorMessage] });
        setNotRecorded([...reviewWarnings, "Hay campos estructurados pendientes. Revisa la ficha antes de volver a guardar."]);
        setFormError("");
      } else {
        setFormError(errorMessage);
      }
    } finally {
      setSaving(false);
    }
  };

  const proposal = outcome?.proposal;
  const missing = useMemo(() => proposal ? missingData(proposal) : [], [proposal]);
  // Avisos en voz alta cuando algo falta o genera duda. Interruptor guardado en este navegador; por defecto activado.
  const [speakAlerts, setSpeakAlerts] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { if (window.localStorage.getItem("dictation.speakAlerts") === "off") setSpeakAlerts(false); } catch { /* sin almacenamiento */ } }, []);
  const toggleSpeak = () => {
    const next = !speakAlerts;
    setSpeakAlerts(next);
    try { window.localStorage.setItem("dictation.speakAlerts", next ? "on" : "off"); } catch { /* sin almacenamiento */ }
    if (!next && typeof window !== "undefined") window.speechSynthesis?.cancel();
  };
  const alertPhrases = useMemo(() => proposal ? spokenAlerts(proposal.clarifications, missing) : [], [proposal, missing]);
  const [speechBlocked, setSpeechBlocked] = useState(false);
  const speakNow = () => {
    setSpeechBlocked(false);
    speakPhrases(alertPhrases, () => setSpeechBlocked(true));
  };
  const announced = useRef<unknown>(null);
  useEffect(() => {
    if (!speakAlerts || !proposal || listening || announced.current === proposal) return;
    announced.current = proposal;
    const isTail = (phrase: string) => /^Y \d+ avisos? más en pantalla\.$/.test(phrase);
    const fresh = alertPhrases.filter((phrase) => !isTail(phrase) && !spokenBefore.current.has(phrase.toLowerCase()));
    if (!fresh.length) return;
    for (const phrase of fresh) spokenBefore.current.add(phrase.toLowerCase());
    setSpeechBlocked(false);
    speakPhrases([...fresh, ...alertPhrases.filter(isTail)], () => setSpeechBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, speakAlerts, listening]);
  useEffect(() => () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);
  // Diagnósticos de la última evolución vigente de la ficha: se pueden vincular sin volver a dictarlos.
  const currentChartDiagnoses = useMemo(
    () => (notes.find((note) => (note.diagnoses?.length ?? 0) > 0 && !/anul/i.test(note.status ?? ""))?.diagnoses ?? [])
      .filter((tag): tag is Partial<EvolutionDiagnosisTag> & { title: string } => typeof tag.title === "string" && tag.title.length > 0),
    [notes],
  );
  const noticeList = proposal ? evolutionNotices({
    procedures: proposal.procedures?.length ?? 0,
    acceptedTeeth: teeth.filter((item) => item.decision === "accepted").length,
    perio: perioItems.filter((item) => item.decision === "accepted").length,
    diagnoses: dxItems.filter((item) => item.decision === "accepted").length + cariesDiagnoses(teeth.filter((item) => item.decision === "accepted")).filter((item) => item.code.startsWith("DA08.0")).length,
    budget: proposal.budget.length,
    planInBody: /^Plan de tratamiento$/m.test(proposal.evolution?.body ?? ""),
    chartHasPlan: budgetOptions.length > 0,
    hasBody: Boolean(proposal.evolution?.body?.trim()),
  }, dismissedNotices) : [];
  const dismissNotice = (key: EvolutionNoticeKey) => setDismissedNotices((current) => new Set(current).add(key));
  const linkChartDiagnosis = (tag: Partial<EvolutionDiagnosisTag> & { title: string }) => {
    setDxItems((current) => current.some((entry) => entry.code === (tag.code ?? "") && entry.title === tag.title && entry.toothText === (tag.tooth ? formatFdi(tag.tooth) : ""))
      ? current
      : [...current, { id: `dx-ficha-${Date.now()}-${current.length}`, code: tag.code ?? "", title: tag.title, label: tag.title, evidence: "Diagnóstico vigente de la ficha", origin: "manual" as const, decision: "accepted" as const, tooth: tag.tooth ?? undefined, toothText: tag.tooth ? formatFdi(tag.tooth) : "", findings: tag.findings ?? "", findingsText: tag.findings ?? "", codeSearch: "" }]);
  };

  /** Diagnósticos aceptados: caries derivadas del odontograma aceptado + etiquetas revisadas. */
  function diagnosisPlan(acceptedTeeth: OdontogramChange[]): { items: DiagnosisItem[]; tags: EvolutionDiagnosisTag[] } | { error: string } {
    const caries = cariesDiagnoses(acceptedTeeth).filter((item) => item.code.startsWith("DA08.0"));
    const pulpTeeth = new Set(acceptedTeeth.filter((item) => item.finding?.condition === "caries" && item.finding.depth === "pulpar").map((item) => item.tooth));
    const reviewed: DiagnosisItem[] = [];
    for (const item of dxItems) {
      if (item.decision !== "accepted") continue;
      const tooth = item.toothText.trim() ? parseDisplayedFdi(item.toothText) : undefined;
      if (tooth === null || tooth === 0) return { error: `Revisa la pieza FDI del diagnóstico «${item.title}» (por ejemplo 2.6) o déjala vacía.` };
      // La sugerencia por caries pulpar solo vale si esa caries pulpar sigue aceptada.
      if (item.suggested?.from === "caries-pulpar" && (!tooth || !pulpTeeth.has(tooth))) continue;
      // These review-only fields are deliberately dropped from the persisted diagnosis.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { decision: _d, toothText: _t, findingsText, codeSearch: _c, ...rest } = item;
      reviewed.push({ ...rest, tooth, findings: findingsText.trim() });
    }
    const items = [...caries, ...reviewed].map((item) => ({ ...item, label: diagnosisLabel(item) }));
    const parsed = sanitizeDiagnosisTags(items.map((item) => ({ code: item.code, title: item.title, tooth: item.tooth ?? null, findings: item.findings ?? "", evidence: item.evidence ?? "", origin: item.origin ?? "manual", suggestedFrom: item.suggested?.from ?? null })));
    if ("error" in parsed) return parsed;
    return { items, tags: parsed.tags };
  }

  const addManualDiagnosis = (code: string, title: string) => {
    setDxItems((current) => [...current, { id: `dx-manual-${Date.now()}`, code, title, label: title, evidence: "", origin: "manual", decision: "accepted", toothText: "", findingsText: "", codeSearch: "" }]);
    setDxSearch("");
  };
  const updateDx = (id: string, patch: Partial<ReviewDiagnosis>) => setDxItems((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));

  return <>
    {prominent
      ? <Button type="button" size="lg" className="h-auto min-h-12 shrink-0 whitespace-normal bg-[#087f83] px-5 text-base hover:bg-[#07676b]" onClick={() => setOpen(true)} data-testid="dictation-open" aria-label={`Dictar en la ficha de ${patientName}`}><Mic className="mr-2 size-5" />Dictar</Button>
      : <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="dictation-open"><Mic className="mr-2 size-4" />Dictar</Button>}
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogContent className="max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] overflow-y-auto overscroll-contain bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dictado de la ficha</DialogTitle>
          <DialogDescription>Paciente: {patientName}. Nada se guarda hasta que aceptes cada cambio. El ingreso manual sigue disponible.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {!supported && <p className="rounded-lg bg-[#f4f7f8] p-3 leading-6 text-[#31575b]" role="status">{unsupportedMessage}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={listening ? "default" : "outline"} className={listening ? "bg-[#087f83] hover:bg-[#07676b]" : ""} disabled={transcribing || !!answering} onClick={listening ? stop : () => void start()} aria-pressed={listening} data-testid="dictation-mic">
              {listening ? <MicOff className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}
              {listening ? "Detener" : "Dictar"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { stopWithoutCorrecting(); setTranscript(EXAMPLE); setInterim(""); resetReview(); }} data-testid="dictation-example">Cargar ejemplo</Button>
            <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={transcribing || structuring || listening || transcript.trim().length < 3} onClick={() => void structure(transcript)} data-testid="dictation-structure"><Sparkles className="mr-2 size-4" aria-hidden="true" />{structuring ? "Corrigiendo texto…" : outcome ? "Volver a corregir texto" : "Corregir texto"}</Button>
          </div>
          {listening && <p role="status" className="font-medium text-[#087f83]">Escuchando en español de Chile… Al detener, el texto se corrige solo con IA.</p>}
          {structuring && <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 font-medium text-sky-950" data-testid="dictation-correcting"><span className="size-4 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />Corrigiendo con IA… redactando la nota por secciones.</p>}
          <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950" role="note">{AUDIO_DICTATION_NOTICE}</p>
          {listening && <p role="status" className="text-[#087f83]">Grabando el audio. Al detener, aparecerá la transcripción para revisar.</p>}
          {transcribing && <p role="status" aria-live="polite" className="rounded-lg bg-sky-50 p-3 font-medium text-sky-950">Transcribiendo el audio con OpenAI… Espera que aparezca el texto antes de corregirlo.</p>}
          {audioRetry && <Button type="button" variant="outline" disabled={transcribing} onClick={() => { setSpeechError(""); (audioRetry === "answer" ? answerEngine.current : engine.current).retry?.(); }}>Reintentar la transcripción del audio</Button>}
          {speechError && <p role="alert" className="text-[#a43542]">{speechError}</p>}
          <label className="block space-y-1.5 font-medium">Transcripción del dictado (editable; se usa como referencia y no se incorpora a la evolución clínica)
            <Textarea data-testid="dictation-transcript" lang="es-CL" rows={5} className="min-h-32 field-sizing-fixed text-base sm:text-sm" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} value={interim ? `${transcript} ${interim}`.trim() : transcript} onChange={(event) => { if (listening || transcribing) stopWithoutCorrecting(); setTranscript(event.target.value); setInterim(""); resetReview(); setCommandIgnored(false); }} placeholder="Habla o escribe el dictado. Revisa piezas y dosis antes de proponer cambios." />
          </label>
          {command && onAnnul && !structuring && <VoiceCommandCard key={command.evidence} command={command} notes={notes} patientName={patientName} onConfirm={onAnnul} onDismiss={() => { setCommandIgnored(true); void structure(transcript); }} />}
          <p className="text-xs leading-5 text-[#60757a]">Dicta libre: «punto» o «punto aparte» separa frases. La IA redacta la nota y propone los cambios con la frase dicha como respaldo; nada se aplica sin tu aceptación. La propuesta pasa por revisión y la ficha manual no cambia sola.</p>
          {formError && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950" data-testid="dictation-error">
            <p>{formError}</p>
            {!outcome && !structuring && lastStructured.trim().length >= 3 && <Button type="button" size="sm" variant="outline" className="mt-2 bg-white" onClick={() => void structure(lastStructured)} data-testid="dictation-retry">Reintentar corrección</Button>}
          </div>}
          {outcome?.aiError && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="dictation-ai-failed">
            <p className="font-medium">La IA no corrigió este dictado: {outcome.aiError}.</p>
            <p className="mt-1 text-xs leading-5">La nota de abajo salió solo de las reglas locales (diccionario y secciones por palabras clave). Revísala con más cuidado o reintenta.</p>
            <Button type="button" size="sm" variant="outline" className="mt-2 bg-white" disabled={transcribing || structuring} onClick={() => void structure(lastStructured || transcript)} data-testid="dictation-retry-ai">{structuring ? "Corrigiendo con IA…" : "Reintentar con IA"}</Button>
          </div>}
          {outcome && !outcome.aiError && outcome.aiNote && <p className="text-xs text-[#71858b]" data-testid="dictation-ai-provider">{outcome.aiNote}</p>}
          {outcome && !outcome.aiError && <p className="rounded-lg bg-[#f4f7f8] p-3 leading-6 text-[#31575b]" role="status">{outcome.notice ?? "Revisa la evolución clínica redactada. Los campos estructurados son opcionales y no detienen su guardado."}</p>}
          {proposal && <div className="space-y-4" data-testid="dictation-review">
            {patientVariants.length > 0 && patientWarnings.length === 0 && <p className="rounded-lg bg-[#f4f7f8] p-3 text-xs text-[#31575b]" role="status" data-testid="dictation-patient-variant">{patientVariants.join(" ")}</p>}
            {patientWarnings.length > 0 && <section role="alert" className="rounded-xl border-2 border-rose-400 bg-rose-50 p-4 text-rose-950" data-testid="dictation-patient-warning">
              <h3 className="text-base font-semibold">¿Es el paciente correcto?</h3>
              <p className="mt-1 text-sm">La ficha abierta es de <strong>{patientName}</strong>{patient?.rut ? ` (RUT ${patient.rut})` : ""}.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{patientWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              <label className="mt-3 flex items-start gap-2 text-sm font-medium">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={patientConfirmed} onChange={(event) => setPatientConfirmed(event.target.checked)} data-testid="dictation-patient-confirm" />
                <span>Confirmo que este dictado corresponde a {patientName}. Si no, cierra y abre la ficha correcta.</span>
              </label>
            </section>}
            <section className="rounded-xl border border-[#dce5e7] p-4" data-testid="dictation-evolution">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Evolución clínica de hoy{proposal.evolutionKind ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">{proposal.evolutionKind.label}</span> : null}</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#60757a]">Revisa la redacción del diagnóstico, los procedimientos y el plan indicado. Las preguntas y los datos de pago o presupuesto quedan abajo y no bloquean el guardado.</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-[#087f83]">Ver última evolución guardada (no se reemplaza)</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#f7f4f4] p-3 text-sm text-[#71858b]">{latestNote ? `${latestNote.title}\n${latestNote.body}` : "Sin evoluciones registradas"}</p>
              </details>
              {proposal.evolution ? <>
                <p className="mt-3 text-xs text-[#71858b]">Nota clínica redactada (editable).</p>
                <Input className="mt-1" aria-label="Título de la evolución" value={evolutionTitle} onChange={(event) => setEvolutionTitle(event.target.value)} />
                <label className="mt-2 block text-xs text-[#71858b]">Fecha de atención (opcional; vacío = hoy)
                  <Input className="mt-1" type="date" aria-label="Fecha de atención" max={new Date().toISOString().slice(0, 10)} value={attentionDate} onChange={(event) => setAttentionDate(event.target.value)} />
                </label>
                <Textarea className="mt-2 border-emerald-200 bg-emerald-50" aria-label="Cuerpo de la evolución" rows={9} value={evolutionBody} onChange={(event) => setEvolutionBody(event.target.value)} />
              </> : <p className="mt-3 text-[#71858b]">El dictado no produjo una evolución.</p>}
            </section>
            <section className="rounded-xl border border-[#dce5e7] p-4" data-testid="dictation-prestaciones">
              <h3 className="font-semibold">Prestaciones realizadas (arancel)</h3>
              <p className="mt-1 text-xs text-[#60757a]">Prestaciones del arancel que la app identificó en lo que dictaste hoy (sin montos). Se guardan en la nota. Quita las que no correspondan o agrega otra.</p>
              <ul className="mt-2 space-y-2">
                {prestItems.length === 0 && <li className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-xs text-[#71858b]">No se detectó ninguna prestación; puedes agregarla abajo.</li>}
                {prestItems.map((item) => <li key={item.id} className={`rounded-lg border p-3 ${item.decision === "accepted" ? "border-emerald-200 bg-white" : "border-[#e4ebed] bg-[#f9fbfb] opacity-80"}`} data-testid="dictation-prestacion">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="font-semibold">{prestacionName(item)}</p>{item.evidence && <Evidence text={item.evidence} />}</div>
                    <div className="flex gap-2"><Decision value={item.decision} onChange={(decision) => setPrestItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, decision } : entry))} /><Button type="button" size="sm" variant="outline" onClick={() => setPrestItems((current) => current.filter((entry) => entry.id !== item.id))}>Quitar</Button></div>
                  </div>
                </li>)}
              </ul>
              <label className="mt-3 block space-y-1 text-xs">Agregar prestación (nombre o código)
                <input className="flex h-9 w-full rounded-md border px-3 text-sm" aria-label="Buscar prestación para agregar" value={prestSearch} onChange={(event) => setPrestSearch(event.target.value)} />
              </label>
              {prestSearch.trim().length >= 2 && <ul className="mt-2 space-y-1">{searchPrestaciones(prestSearch, 6).map((result) => <li key={result.code}><button type="button" className="w-full rounded-md border px-2 py-1 text-left text-xs hover:bg-emerald-50" onClick={() => { setPrestItems((current) => current.some((entry) => entry.code === result.code) ? current : [...current, { id: `pr-manual-${Date.now()}`, code: result.code, name: result.name, tooth: null, evidence: "", decision: "accepted" as const }]); setPrestSearch(""); }}>{result.code} · {result.name}</button></li>)}</ul>}
            </section>
            {missing.length > 0 && <section className="rounded-xl border border-[#dbe7e8] bg-white p-3 text-sm text-[#31575b]" data-testid="dictation-missing">
              <p><strong>Falta (opcional):</strong> {missing.join(" · ")}</p>
              <p className="mt-1 text-xs text-[#60757a]">No es obligatorio y no impide guardar la evolución. Puedes aclararlo después.</p>
            </section>}
            {noticeList.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950" data-testid="dictation-notices">
              <h3 className="font-semibold">Avisos (no impiden guardar)</h3>
              <ul className="mt-2 space-y-3">{noticeList.map((notice) => <li key={notice.key} data-testid={`dictation-notice-${notice.key}`}>
                <p>{notice.text}</p>
                {notice.key === "diagnostico" && currentChartDiagnoses.length > 0 && <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium">Diagnóstico vigente en la ficha:</p>
                  <ul className="flex flex-wrap gap-2">{currentChartDiagnoses.map((tag, index) => <li key={`${tag.code ?? ""}|${tag.title}|${tag.tooth ?? ""}|${index}`}>
                    <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal bg-white text-left" onClick={() => { linkChartDiagnosis(tag); dismissNotice("diagnostico"); }}>
                      Vincular: {tag.tooth ? `FDI ${formatFdi(tag.tooth)} · ` : ""}{tag.title}{tag.code ? ` (${tag.code})` : ""}
                    </Button>
                  </li>)}</ul>
                </div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {notice.key === "diagnostico" && <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Buscar diagnóstico para agregar"]')?.focus()}>Agregarlo ahora</Button>}
                  <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => dismissNotice(notice.key)} data-testid={`dictation-notice-dismiss-${notice.key}`}>No es necesario ahora</Button>
                </div>
              </li>)}</ul>
            </section>}
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="dictation-speak-alerts">
              <Button type="button" size="sm" variant="outline" className="bg-white" aria-pressed={speakAlerts} onClick={toggleSpeak}>{speakAlerts ? "🔊 Avisos en voz alta: sí" : "🔇 Avisos en voz alta: no"}</Button>
              {alertPhrases.length > 0 && <Button type="button" size="sm" variant="outline" className="bg-white" onClick={speakNow}>Repetir avisos</Button>}
              {speechBlocked && <span className="text-xs text-amber-800">El móvil bloqueó el audio automático: toca «Repetir avisos».</span>}
            </div>
            {proposal.clarifications.length > 0 && <section className="rounded-xl bg-amber-50 p-4 text-amber-950" data-testid="dictation-clarifications">
              <h3 className="font-semibold">Aclaraciones opcionales ({proposal.clarifications.length})</h3>
              <p className="mt-1 text-xs leading-5">Responde escribiendo o con el micrófono y pulsa «Aplicar respuestas». Lo no respondido no se aplica.</p>
              <ul className="mt-3 space-y-3">{proposal.clarifications.map((question) => <li key={question}>
                <p className="text-sm">{question}</p>
                <div className="mt-1 flex gap-2">
                  <Input className="bg-white text-base sm:text-sm" disabled={transcribing || answering === question} aria-label={`Respuesta: ${question}`} value={answers[question] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value }))} placeholder="Respuesta" />
                  <Button type="button" variant={answering === question ? "default" : "outline"} size="icon" className={`shrink-0 ${answering === question ? "bg-[#087f83] hover:bg-[#07676b]" : ""}`} disabled={transcribing || listening} aria-label={answering === question ? "Detener respuesta dictada" : "Dictar respuesta"} aria-pressed={answering === question} onClick={() => void dictateAnswer(question)}>{answering === question ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>
                </div>
              </li>)}</ul>
              <Button type="button" className="mt-3 bg-[#087f83] hover:bg-[#07676b]" disabled={transcribing || structuring || !Object.values(answers).some((value) => value.trim())} onClick={applyAnswers} data-testid="dictation-apply-answers">{structuring ? "Aplicando…" : "Aplicar respuestas"}</Button>
            </section>}
            <details className="rounded-xl border border-[#dce5e7] bg-white p-3" data-testid="dictation-transcript-review">
              <summary className="cursor-pointer font-medium text-[#31575b]">Ver transcripción y correcciones (opcional)</summary>
              <div className="mt-3">
            <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4" data-testid="dictation-corrected">
              <h3 className="font-semibold">Texto corregido</h3>
              <p className="mt-1 text-xs leading-5 text-[#60757a]">Diccionario clínico e IA corrigen lo mal oído sin agregar datos. Cada cambio queda marcado; lo que la IA quiso cambiar sin respaldo se descarta. Puedes editarlo y volver a proponer.</p>
              {corrections.length > 0 ? <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Correcciones">
                {corrections.map((item, index) => <li key={`${item.original}-${index}`} className={`rounded-lg px-2 py-1 ${item.applied ? "bg-white" : "bg-amber-50 text-amber-950"}`} title={item.reason}>
                  <span className="text-rose-800 line-through">{item.original}</span> → {item.corrected ? <span className={item.applied ? "font-medium text-emerald-900" : "text-amber-900"}>{item.corrected}</span> : <span className="italic text-[#60757a]">omitido</span>}
                  <span className="ml-1 text-[10px] uppercase text-[#71858b]">{item.origin === "ia" ? "IA" : "diccionario"}{item.applied ? "" : " · no aplicado"}</span>
                  {!item.applied && item.reason && <span className="block text-[11px]">{item.reason}</span>}
                </li>)}
              </ul> : null}
              <div className="mt-2"><WordDiffView before={lastStructured || transcript} after={proposal.corrected?.text ?? workingText} testId="dictation-diff" /></div>
              <Textarea className="mt-2 bg-white text-base sm:text-sm" aria-label="Texto corregido (editable)" rows={4} value={workingText} onChange={(event) => setWorkingText(event.target.value)} data-testid="dictation-corrected-text" />
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={transcribing || structuring || workingText.trim().length < 3} onClick={() => void structure(workingText)}>Volver a proponer con este texto</Button>
              <p className="mt-1 text-[11px] text-[#71858b]">Si editas la transcripción, vuelve a proponer antes de guardar.</p>
            </section>
              </div>
            </details>
            <details className="rounded-xl border border-[#dce5e7] bg-white p-3" data-testid="dictation-structured-review">
              <summary className="cursor-pointer font-medium text-[#31575b]">Revisar campos estructurados (opcional)</summary>
              <div className="mt-4 space-y-4">
            <section className="space-y-3">
              <h3 className="font-semibold">Odontograma</h3>
              {teeth.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin cambios de odontograma.</p>}
              {(proposal.policyNotes ?? []).map((note) => <p key={note} className="rounded-lg bg-sky-50 p-3 text-xs text-sky-950">{note}</p>)}
              {teeth.map((item, index) => {
                const currentStatus = odontogram.teeth[item.tooth] || "Sin hallazgos";
                const nextStatus = item.kind === "crown" ? "Corona" : item.status || currentStatus;
                return <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-tooth">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.numberingLabel}<OriginBadge origin={item.origin} conflict={item.conflict} /></p>
                      <Evidence text={item.evidence ?? item.sourceText} />
                      {item.incompleteCaries && <p className="mt-1 text-xs font-medium text-amber-800">Hallazgo incompleto: complétalo para aceptarlo.</p>}
                      {item.advisory && <p className="mt-1 text-xs font-medium text-amber-800">{item.advisory}</p>}
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
                          ? { condition: "caries", depth: item.finding?.depth ?? null, icdas: item.finding?.icdas ?? null, activity: item.finding?.activity ?? null }
                          : { condition, depth: null, icdas: null, activity: null };
                        setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, finding } : entry));
                      }}>{Object.entries(conditionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      {item.finding?.condition === "caries" && <>
                        <label className="space-y-1">Profundidad (opcional)<select className="h-9 w-full rounded-md border px-2" value={item.finding.depth ?? ""} onChange={(event) => setTeeth((current) => current.map((entry, entryIndex) => entryIndex === index && entry.finding?.condition === "caries" ? { ...entry, finding: { ...entry.finding, depth: (event.target.value || null) as SurfaceFinding["depth"] } } : entry))}><option value="">Sin dictar</option>{CARIES_DEPTHS.map((depth) => <option key={depth} value={depth}>{CARIES_DEPTH_SHORT[depth]}</option>)}</select></label>
                        <p className="self-end pb-2 text-xs text-[#60757a]" data-testid="dictation-caries-icd11">{icd11Label(cariesIcd11(item.finding.depth, isRootCaries(item.sourceText)))}</p>
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
            <section className="rounded-xl border border-[#dce5e7] p-4" data-testid="dictation-diagnoses">
              <h3 className="font-semibold">Diagnósticos de la evolución (CIE-11 OMS)</h3>
              <p className="mt-1 text-xs text-[#60757a]">Etiquetas del catálogo CIE-11 verificado (MMS 2026-01). La pieza y los hallazgos se guardan aparte del código. Las equivalencias sugeridas (AAE, caries con compromiso pulpar) parten sin aceptar: confírmalas solo si corresponden. Las caries siguen lo aceptado en el odontograma.</p>
              <ul className="mt-2 space-y-2">
                {cariesDiagnoses(teeth.filter((item) => item.decision === "accepted")).filter((item) => item.code.startsWith("DA08.0")).map((item) => <li key={item.id} className="rounded-lg bg-[#f4f7f8] p-3" data-testid="dictation-diagnosis-caries">{item.label}<span className="ml-2 text-xs text-[#71858b]">(desde el odontograma)</span><Evidence text={item.evidence} /></li>)}
                {dxItems.map((item) => {
                  const results = item.codeSearch.trim().length >= 2 ? searchDiagnoses(item.codeSearch, 6) : [];
                  return <li key={item.id} className={`rounded-lg border p-3 ${item.decision === "accepted" ? "border-emerald-200 bg-white" : "border-[#e4ebed] bg-[#f9fbfb] opacity-80"}`} data-testid="dictation-diagnosis">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{item.code ? <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{item.code}</span> : <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">Sin código</span>}{item.title}
                          {item.origin && item.origin !== "manual" && <OriginBadge origin={item.origin} />}
                          {item.origin === "manual" && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Agregado a mano</span>}
                        </p>
                        {item.suggested && <p className="mt-1 text-xs font-medium text-amber-800" data-testid="dictation-diagnosis-suggested">{item.suggested.from === "AAE" ? `Sugerido: equivalencia de «${item.suggested.term}» (AAE). Confírmalo si corresponde.` : item.suggested.from === "nota" ? `Sugerido a partir de lo que describiste («${item.suggested.term}»): no dictaste un diagnóstico. Confírmalo si corresponde o déjalo fuera.` : item.suggested.from === "aproximado" ? `Aproximado: «${item.suggested.term}» no figura tal cual en la CIE-11; este es el más cercano. Confírmalo o cámbialo.` : "Sugerido por caries con compromiso pulpar: confirma o cambia el diagnóstico pulpar."}</p>}
                        <Evidence text={item.evidence} />
                      </div>
                      <div className="flex gap-2">
                        <Decision value={item.decision} onChange={(decision) => updateDx(item.id, { decision })} />
                        <Button type="button" size="sm" variant="outline" onClick={() => setDxItems((current) => current.filter((entry) => entry.id !== item.id))}>Quitar</Button>
                      </div>
                    </div>
                    {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="space-y-1 text-xs">Pieza FDI (opcional)<input className="flex h-9 w-full rounded-md border px-3 text-sm" placeholder="2.6" aria-label={`Pieza del diagnóstico ${item.title}`} value={item.toothText} onChange={(event) => updateDx(item.id, { toothText: event.target.value })} /></label>
                      <label className="space-y-1 text-xs">Hallazgos (opcional)<input className="flex h-9 w-full rounded-md border px-3 text-sm" placeholder="p. ej. dolor a la percusión" aria-label={`Hallazgos del diagnóstico ${item.title}`} value={item.findingsText} onChange={(event) => updateDx(item.id, { findingsText: event.target.value })} /></label>
                      <label className="space-y-1 text-xs">Cambiar diagnóstico<input className="flex h-9 w-full rounded-md border px-3 text-sm" placeholder="Buscar: pulpitis, absceso…" aria-label={`Cambiar el diagnóstico ${item.title}`} value={item.codeSearch} onChange={(event) => updateDx(item.id, { codeSearch: event.target.value })} /></label>
                    </div>}
                    {results.length > 0 && <ul className="mt-2 space-y-1">{results.map((result) => <li key={`${result.code}|${result.title}`}><button type="button" className="w-full rounded-md border px-2 py-1 text-left text-xs hover:bg-emerald-50" onClick={() => updateDx(item.id, { code: result.code, title: result.title, label: result.title, suggested: undefined, term: undefined, origin: "manual", codeSearch: "" })}>{result.code || "Sin código"} · {result.title}{result.matched && result.matched !== result.title ? ` («${result.matched}»)` : ""}</button></li>)}</ul>}
                  </li>;
                })}
              </ul>
              <label className="mt-3 block space-y-1 text-xs">Agregar diagnóstico (sinónimos chilenos: «caries», «absceso», «muela del juicio», «bruxismo»…)
                <input className="flex h-9 w-full rounded-md border px-3 text-sm" aria-label="Buscar diagnóstico para agregar" value={dxSearch} onChange={(event) => setDxSearch(event.target.value)} />
              </label>
              {dxSearch.trim().length >= 2 && <ul className="mt-2 space-y-1" data-testid="dictation-diagnosis-search">{searchDiagnoses(dxSearch, 8).map((result) => <li key={`${result.code}|${result.title}`}><button type="button" className="w-full rounded-md border px-2 py-1 text-left text-xs hover:bg-emerald-50" onClick={() => addManualDiagnosis(result.code, result.title)}>{result.code || "Sin código"} · {result.title}{result.matched && result.matched !== result.title ? ` («${result.matched}»)` : ""}</button></li>)}</ul>}
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
                  <label className="space-y-1">Prestación{item.phase && <span className="ml-2 rounded bg-[#eef1f8] px-1.5 py-0.5 text-xs font-medium text-[#33466f]">{item.phase}</span>}{item.option && <span className="ml-2 rounded bg-[#f8efe4] px-1.5 py-0.5 text-xs font-medium text-[#7a4a12]" title="La opción B y siguientes se guardan como alternativas del plan principal">Opción {item.option}</span>}{item.catalogCode && <span className="ml-2 rounded bg-[#e7f5f3] px-1.5 py-0.5 text-xs font-medium text-[#075b60]" title="Coincide con una prestación del catálogo">Catálogo {item.catalogCode}</span>}<input className="flex h-9 w-full rounded-md border px-3" value={item.label} onChange={(event) => setBudgets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value, catalogCode: undefined } : entry))} /></label>
                  <label className="space-y-1">Monto CLP<input className="flex h-9 w-full rounded-md border px-3" inputMode="numeric" value={item.amountText} onChange={(event) => setBudgets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amountText: event.target.value } : entry))} /></label>
                </div>}
              </article>)}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Pagos y abonos</h3>
              {paymentItems.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin pagos en el dictado.</p>}
              {paymentItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-payment">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p><span className="text-[#71858b]">Pago de hoy: </span><span className="font-medium">${Number(item.amountText || 0).toLocaleString("es-CL")}</span> · {item.methodValue ? PAYMENT_METHOD_LABEL[item.methodValue] : <span className="text-amber-800">medio sin indicar</span>}<OriginBadge origin={item.origin} /></p><Evidence text={item.evidence} />{item.baseAmount && item.percentage === 50 && <p className="mt-1 text-sm font-medium text-[#0a7779]">Cálculo detectado: 50 % de {item.baseAmount.toLocaleString("es-CL")} = {Number(item.amountText || 0).toLocaleString("es-CL")}</p>}</div>
                  <Decision value={item.decision} onChange={(decision) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">Monto CLP<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" inputMode="numeric" value={item.amountText} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amountText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Medio de pago<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.methodValue} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, methodValue: event.target.value as PaymentMethod | "" } : entry))}><option value="">Elegir…</option>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABEL[method]}</option>)}</select></label>
                  <label className="space-y-1">Concepto<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.concept} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, concept: event.target.value } : entry))} /></label>
                  {(budgetOptions.length > 0 || budgets.length > 0) && <label className="space-y-1">Abona al presupuesto<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.budgetId} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, budgetId: event.target.value } : entry))}><option value="">Sin asociar</option>{budgetOptions.map((budget) => <option key={"existing:" + budget.id} value={"existing:" + budget.id}>{budget.title}</option>)}{budgets.map((budget) => <option key={"proposal:" + budget.id} value={"proposal:" + budget.id} disabled={budget.decision !== "accepted"}>{budget.label} · {"$" + Number(budget.amountText || 0).toLocaleString("es-CL")}{budget.decision !== "accepted" ? " (rechazado)" : " (dictado)"}</option>)}</select></label>}
                </div>}
              </article>)}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Próxima cita</h3>
              {appointmentItems.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin cita en el dictado.</p>}
              {appointmentItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-appointment">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p><span className="text-[#71858b]">Agendar: </span><span className="font-medium">{item.dayValue ? new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${item.dayValue}T12:00:00Z`)) : "fecha pendiente"}</span>{item.timeValue ? ` · ${item.timeValue}` : " · hora pendiente"}<OriginBadge origin={item.origin} /></p>
                    {item.said && <p className="mt-1 text-xs text-[#71858b]">Dicho como «{item.said}» (calculado en hora de Chile).</p>}
                    <Evidence text={item.evidence} />
                    {(item.note || item.timeDoubt) && <p className="mt-1 text-xs font-medium text-amber-800">{item.timeDoubt ?? item.note}</p>}
                  </div>
                  <Decision value={item.decision} onChange={(decision) => setAppointmentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1">Fecha<input type="date" className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.dayValue} onChange={(event) => setAppointmentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, dayValue: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Hora<input type="time" step={300} className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.timeValue} onChange={(event) => setAppointmentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, timeValue: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Motivo<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.reason} onChange={(event) => setAppointmentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reason: event.target.value } : entry))} /></label>
                </div>}
              </article>)}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Periodontograma</h3>
              <p className="text-xs leading-5 text-[#60757a]">Lo aceptado se guarda como un examen nuevo con solo los sitios dictados; no reemplaza el examen completo ni infiere margen, furcación, EPB ni clasificación.</p>
              {perioItems.length === 0 && mobilityItems.length === 0 && recessionItems.length === 0 && !classItem && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin sondaje en el dictado.</p>}
              {perioItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-perio">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">FDI {item.toothText} · {item.site ? SITE_LABEL[item.site] : "sitio pendiente"} · {item.depthText ? `${item.depthText} mm` : "mm pendientes"}{item.bleeding ? " · sangrado" : ""}{item.suppuration ? " · supuración" : ""}<OriginBadge origin={item.origin} /></p>
                    <Evidence text={item.evidence} />
                    {item.pending && <p className="mt-1 text-xs font-medium text-amber-800">Incompleto: completa sitio y milímetros (o responde la aclaración) para aceptarlo.</p>}
                  </div>
                  <Decision value={item.decision} onChange={(decision) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <label className="space-y-1">Pieza FDI<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.toothText} onChange={(event) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, toothText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Sitio<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.site} onChange={(event) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, site: event.target.value as PerioSite | "" } : entry))}><option value="">Elegir…</option>{PERIO_SITES.map((site) => <option key={site} value={site}>{SITE_LABEL[site]}</option>)}</select></label>
                  <label className="space-y-1">mm<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" inputMode="numeric" value={item.depthText} onChange={(event) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, depthText: event.target.value } : entry))} /></label>
                  <label className="flex items-center gap-2 pt-6"><input type="checkbox" className="size-5" checked={item.bleeding} onChange={(event) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, bleeding: event.target.checked } : entry))} />Sangrado</label>
                  <label className="flex items-center gap-2 pt-6"><input type="checkbox" className="size-5" checked={item.suppuration} onChange={(event) => setPerioItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, suppuration: event.target.checked } : entry))} />Supuración</label>
                </div>}
              </article>)}
              {recessionItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">Recesión FDI {item.toothText} {item.site}: {item.mmText} mm desde la LAC<OriginBadge origin={item.origin} /></p><Evidence text={item.evidence} /></div>
                  <Decision value={item.decision} onChange={(decision) => setRecessionItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="space-y-1">Pieza FDI<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.toothText} onChange={(event) => setRecessionItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, toothText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Milímetros<input inputMode="numeric" className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.mmText} onChange={(event) => setRecessionItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, mmText: event.target.value } : entry))} /></label>
                </div>}
              </article>)}
              {classItem && <article className={`rounded-xl border p-4 ${classItem.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">Clasificación periodontal AAP-EFP 2017{classItem.stage ? `: estadio ${classItem.stage}` : ""}{classItem.grade ? `, grado ${classItem.grade}` : ""}<OriginBadge origin={classItem.origin} /></p><Evidence text={classItem.evidence} /></div>
                  <Decision value={classItem.decision} onChange={(decision) => setClassItem((current) => current ? { ...current, decision } : current)} />
                </div>
              </article>}
              {mobilityItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">{item.kind === "furcacion" ? "Furcación" : "Movilidad"} FDI {item.toothText}: grado {item.grade}<OriginBadge origin={item.origin} /></p><Evidence text={item.evidence} /></div>
                  <Decision value={item.decision} onChange={(decision) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="space-y-1">Pieza FDI<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.toothText} onChange={(event) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, toothText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Grado<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.grade} onChange={(event) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, grade: event.target.value as MobilityChange["grade"] } : entry))}>{(item.kind === "furcacion" ? ["I", "II", "III"] as const : ["0", "I", "II", "III"] as const).map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
                </div>}
              </article>)}
            </section>
              </div>
            </details>
          </div>}
          {result && <div role="status" className={`rounded-lg p-3 ${result.ok ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950"}`}>
            <p className="font-semibold">{result.ok ? "Guardado y releído." : "La relectura encontró diferencias."}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{result.messages.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>}
          {result && notRecorded.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-amber-950" data-testid="dictation-not-recorded">
            <p className="font-semibold">Pendiente de revisión (opcional)</p>
            <p className="mt-1 text-xs">Estos datos no se añadieron a campos estructurados; la nota clínica se gestiona por separado.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{notRecorded.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>}
        </div>
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-[#e4ebed] bg-white px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
          <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={!outcome || saving || patientBlocked || !!result?.ok} title={patientBlocked ? "Confirma el paciente antes de guardar" : undefined} onClick={() => void confirm()} data-testid="dictation-confirm">{saving ? "Guardando y verificando…" : "Guardar evolución"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}


/**
 * Pide el micrófono antes de dictar. En iPhone/iPad se omite: Safari lo pide al iniciar el
 * reconocimiento y abrir y cerrar antes el micrófono puede dejarlo ocupado («audio-capture»).
 */

function Decision({ value, onChange, disabled = false }: { value: "accepted" | "rejected"; onChange: (value: "accepted" | "rejected") => void; disabled?: boolean }) {
  return <div className="flex gap-2">
    <Button type="button" size="sm" variant={value === "accepted" ? "default" : "outline"} className={value === "accepted" ? "bg-[#087f83] hover:bg-[#07676b]" : ""} disabled={disabled} onClick={() => onChange("accepted")}>Aceptar</Button>
    <Button type="button" size="sm" variant={value === "rejected" ? "default" : "outline"} disabled={disabled} onClick={() => onChange("rejected")}>Rechazar</Button>
  </div>;
}
