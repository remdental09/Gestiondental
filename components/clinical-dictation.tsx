"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type ClinicalImage, type OdontogramData, type PerioExam } from "@/app/clinical-data";
import { createWebSpeechTranscription, IOS_DICTATION_HINT, IS_IOS } from "@/lib/dictation/transcription";
import {
  answerLines,
  buildDictatedPerio,
  finalizeEvolution,
  withAnswers,
  SITE_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  PERIO_SITES,
  type AppointmentChange,
  type MobilityChange,
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
  payments?: { id: number; patientId: number; amount: number; method: string; concept: string; paidOn: string; date: string; budgetId: number | null }[];
};

type ReviewTooth = OdontogramChange & { decision: "accepted" | "rejected"; toothText: string; incompleteCaries?: boolean };
type ReviewFicha = FichaChange & { decision: "accepted" | "rejected" };
type Decided = "accepted" | "rejected";
type ReviewPerio = { id: string; toothText: string; site: PerioSite | ""; depthText: string; bleeding: boolean; suppuration: boolean; decision: Decided; evidence?: string; origin?: ItemOrigin; pending: boolean };
type ReviewMobility = MobilityChange & { decision: Decided; toothText: string };
type ReviewPayment = PaymentChange & { decision: Decided; amountText: string; methodValue: PaymentMethod | ""; budgetId: string };
type ReviewAppointment = AppointmentChange & { decision: Decided; dayValue: string; timeValue: string };
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
  budgetOptions = [],
}: {
  patientId: number;
  patientName: string;
  odontogram: OdontogramData;
  latestNote: { title: string; body: string } | null;
  patient?: PatientFicha | null;
  persist: (input: Record<string, unknown>) => Promise<{ note?: { id: number; title: string; body: string }; budget?: { id: number }; payment?: { id: number }; appointment?: { id: number }; exam?: { id: number } }>;
  budgetOptions?: { id: number; title: string }[];
  onApplied: (data: Reload) => void;
}) {
  const engine = useRef(createWebSpeechTranscription());
  const answerEngine = useRef(createWebSpeechTranscription());
  const requestId = useRef("");
  const session = useRef("");
  // Lo ya guardado en este dictado no se repite si hay que reintentar tras un error.
  const savedOnce = useRef(new Map<string, number>());
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
  const [workingText, setWorkingText] = useState("");
  const [corrections, setCorrections] = useState<TranscriptCorrection[]>([]);
  const [perioItems, setPerioItems] = useState<ReviewPerio[]>([]);
  const [mobilityItems, setMobilityItems] = useState<ReviewMobility[]>([]);
  const [paymentItems, setPaymentItems] = useState<ReviewPayment[]>([]);
  const [appointmentItems, setAppointmentItems] = useState<ReviewAppointment[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; messages: string[] } | null>(null);

  useEffect(() => {
    const transcription = engine.current;
    const answerTranscription = answerEngine.current;
    setSupported(transcription.isSupported());
    setUnsupportedMessage(transcription.unsupportedMessage());
    return () => { transcription.abort(); answerTranscription.abort(); };
  }, []);

  const resetReview = () => {
    setOutcome(null);
    setTeeth([]);
    setBudgets([]);
    setFichaItems([]);
    setNotRecorded([]);
    setWorkingText("");
    setCorrections([]);
    setPerioItems([]);
    setMobilityItems([]);
    setPaymentItems([]);
    setAppointmentItems([]);
    setAnswers({});
    setResult(null);
    setFormError("");
  };

  const close = () => {
    engine.current.abort();
    answerEngine.current.abort();
    setAnswering(null);
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
    if (!(await micAllowed())) {
      setSpeechError(MIC_DENIED);
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

  /** Responde una aclaración por voz: el texto dictado llena su campo. */
  const dictateAnswer = async (question: string) => {
    if (answering === question) {
      answerEngine.current.stop();
      setAnswering(null);
      return;
    }
    answerEngine.current.abort();
    if (listening) stop();
    setSpeechError("");
    if (!answerEngine.current.isSupported()) {
      setSpeechError(answerEngine.current.unsupportedMessage());
      return;
    }
    if (!(await micAllowed())) {
      setSpeechError(MIC_DENIED);
      return;
    }
    setAnswering(question);
    answerEngine.current.start(answers[question] ?? "", {
      onTranscript: (text, spoken) => setAnswers((current) => ({ ...current, [question]: spoken ? `${text} ${spoken}`.trim() : text })),
      onError: (message) => { setSpeechError(message); setAnswering(null); },
      onEnd: () => setAnswering(null),
    });
  };

  const structure = async (text = transcript) => {
    setFormError("");
    setResult(null);
    if (answering) { answerEngine.current.stop(); setAnswering(null); }
    setStructuring(true);
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
      setMobilityItems((data.proposal.mobility ?? []).map((item) => ({ ...item, decision: "accepted", toothText: formatFdi(item.tooth) })));
      setPaymentItems((data.proposal.payments ?? []).map((item) => ({ ...item, decision: "accepted", amountText: String(item.amount), methodValue: item.method ?? "", budgetId: "" })));
      setAppointmentItems((data.proposal.appointments ?? []).map((item) => ({ ...item, decision: item.day && item.time && !item.timeDoubt ? "accepted" : "rejected", dayValue: item.day ?? "", timeValue: item.time ?? "" })));
    } catch (cause) {
      setOutcome(null);
      setFormError(cause instanceof Error ? cause.message : "No se pudo preparar la propuesta.");
    } finally {
      setStructuring(false);
    }
  };

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
    const acceptedPayments: { key: string; amount: number; method: PaymentMethod; concept: string; budgetId: number | null }[] = [];
    for (const item of paymentItems) {
      if (item.decision !== "accepted") continue;
      const amount = Number(item.amountText.replace(/\./g, ""));
      if (!Number.isSafeInteger(amount) || amount < 1) { setFormError("Revisa el monto del pago en pesos, sin decimales."); return; }
      if (!item.methodValue) { setFormError(`Elige el medio de pago de $${amount.toLocaleString("es-CL")}.`); return; }
      acceptedPayments.push({ key: `pay:${item.id}:${amount}:${item.methodValue}:${item.budgetId}`, amount, method: item.methodValue, concept: item.concept.trim(), budgetId: item.budgetId ? Number(item.budgetId) : null });
    }
    const acceptedAppointments: { key: string; day: string; time: string; reason: string }[] = [];
    for (const item of appointmentItems) {
      if (item.decision !== "accepted") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dayValue) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.timeValue) || !item.reason.trim()) { setFormError("Revisa fecha, hora y motivo de la próxima cita."); return; }
      acceptedAppointments.push({ key: `cita:${item.id}:${item.dayValue}:${item.timeValue}`, day: item.dayValue, time: item.timeValue, reason: item.reason.trim() });
    }
    const perioReadings: { tooth: number; site: PerioSite; depth: number; bleeding: boolean; suppuration: boolean }[] = [];
    for (const item of perioItems) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText), depth = Number(item.depthText);
      if (!tooth || !item.site || item.depthText.trim() === "" || !Number.isInteger(depth) || depth < 0 || depth > 20) { setFormError("Revisa pieza FDI, sitio y milímetros (enteros de 0 a 20) del sondaje."); return; }
      if (perioReadings.some((reading) => reading.tooth === tooth && reading.site === item.site)) { setFormError(`El sitio ${item.site} de FDI ${formatFdi(tooth)} está dos veces.`); return; }
      perioReadings.push({ tooth, site: item.site, depth, bleeding: item.bleeding, suppuration: item.suppuration });
    }
    const perioMobility: { tooth: number; grade: string }[] = [];
    for (const item of mobilityItems) {
      if (item.decision !== "accepted") continue;
      const tooth = parseDisplayedFdi(item.toothText);
      if (!tooth) { setFormError("Revisa la pieza FDI de la movilidad."); return; }
      perioMobility.push({ tooth, grade: item.grade });
    }
    const savePerio = perioReadings.length > 0 || perioMobility.length > 0;
    const acceptedFicha = fichaItems.filter((item) => item.decision === "accepted");
    const fichaUpdate = patient ? planFichaUpdate(patient, acceptedFicha) : null;
    const saveEvolution = evolutionDecision === "accepted" && evolutionBody.trim().length > 0;
    // El registro del odontograma de la nota se rehace con lo aceptado y se agrega la transcripción completa.
    const finalBody = saveEvolution ? finalizeEvolution(evolutionBody, acceptedTeeth, literalTranscript()) : "";
    if (!saveEvolution && !acceptedTeeth.length && !acceptedBudgets.length && !fichaUpdate && !acceptedPayments.length && !acceptedAppointments.length && !savePerio) {
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
        const saved = await persist({ action: "addNote", patientId, title: evolutionTitle.trim() || "Evolución dictada", body: finalBody, requestId: requestId.current });
        savedNote = { id: saved.note?.id, title: evolutionTitle.trim() || "Evolución dictada", body: saved.note?.body ?? finalBody };
        const readBack = await reload();
        after = readBack.toothStatuses[patientId] ?? before;
        onApplied(readBack);
      }
      for (const action of planChartWrites(patientId, before, after, acceptedTeeth)) await persist(action);
      for (const item of acceptedBudgets) {
        const id = await once(`budget:${item.id}:${item.label}:${item.amount}`, async () => (await persist({ action: "addBudget", patientId, title: item.title, label: item.label, amount: item.amount })).budget?.id);
        if (id) savedBudgetIds.push(id);
      }
      for (const item of acceptedPayments) {
        const savedId = await once(item.key, async () => (await persist({ action: "addPayment", patientId, amount: item.amount, method: item.method, concept: item.concept, budgetId: item.budgetId, requestId: `${session.current}:${item.key}`.slice(0, 80) })).payment?.id);
        savedPayments.push({ amount: item.amount, method: item.method, savedId });
      }
      for (const item of acceptedAppointments) {
        const savedId = await once(item.key, async () => (await persist({ action: "addAppointment", patientId, day: item.day, time: item.time, reason: item.reason })).appointment?.id);
        savedAppointments.push({ day: item.day, time: item.time, reason: item.reason, savedId });
      }
      if (savePerio) {
        const key = `perio:${JSON.stringify(perioReadings)}:${JSON.stringify(perioMobility)}`;
        examId = await once(key, async () => (await persist({ action: "savePerio", patientId, teeth: buildDictatedPerio(perioReadings, perioMobility) })).exam?.id);
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
        payments: savedPayments,
        appointments: savedAppointments,
        perio: savePerio ? { examId, readings: perioReadings, mobility: perioMobility } : null,
      }, {
        notes: finalRead.notes,
        budgets: finalRead.budgets,
        toothStatuses: finalRead.toothStatuses,
        payments: finalRead.payments ?? [],
        appointments: finalRead.appointments,
        periodontalExams: finalRead.periodontalExams,
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
        ...perioItems.filter((item) => item.decision !== "accepted").map((item) => `Sondaje FDI ${item.toothText}${item.site ? ` ${item.site}` : ""}${item.depthText ? ` ${item.depthText} mm` : ""} — ${item.pending ? "incompleto, no se guardó" : "rechazado"}.`),
        ...paymentItems.filter((item) => item.decision !== "accepted").map((item) => `Pago $${Number(item.amountText || 0).toLocaleString("es-CL")} — no se registró.`),
        ...appointmentItems.filter((item) => item.decision !== "accepted").map((item) => `Cita «${item.said || item.evidence}» — no se agendó.`),
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

  /** Lo dictado tal cual y, si cambió, el texto revisado: ambos quedan al final de la nota. */
  function literalTranscript() {
    const raw = transcript.trim();
    const revised = workingText.trim();
    if (!revised || revised === raw) return raw;
    return `${raw}\n\nTexto revisado y aclaraciones:\n${revised}`;
  }

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="dictation-open"><Mic className="mr-2 size-4" />Dictar</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogContent className="max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] overflow-y-auto overscroll-contain bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-3xl">
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
            <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={structuring || listening || transcript.trim().length < 3} onClick={() => void structure(transcript)} data-testid="dictation-structure">{structuring ? "Preparando…" : "Preparar propuesta"}</Button>
          </div>
          {listening && <p role="status" className="font-medium text-[#087f83]">Escuchando en español de Chile…</p>}
          {speechError && <p role="alert" className="text-[#a43542]">{speechError}</p>}
          <label className="block space-y-1.5 font-medium">Lo que se escuchó (en vivo, editable)
            <Textarea data-testid="dictation-transcript" lang="es-CL" rows={5} className="min-h-32 field-sizing-fixed text-base sm:text-sm" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} value={interim ? `${transcript} ${interim}`.trim() : transcript} onChange={(event) => { if (listening) stop(); setTranscript(event.target.value); setInterim(""); resetReview(); }} placeholder="Habla o escribe el dictado. Revisa piezas y dosis antes de proponer cambios." />
          </label>
          {IOS_DICTATION_HINT && <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950" role="note">{IOS_DICTATION_HINT}</p>}
          <p className="text-xs leading-5 text-[#60757a]">Dicta libre: «punto» o «punto aparte» separa frases. La IA redacta la nota y propone los cambios con la frase dicha como respaldo; nada se aplica sin tu aceptación. El reconocimiento es el del navegador (Chrome o Safari) en es-CL. El audio no se envía a una API de transcripción de pago. La propuesta pasa por revisión y la ficha manual no cambia sola.</p>
          {formError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950">{formError}</p>}
          {outcome && <p className="rounded-lg bg-[#f4f7f8] p-3 leading-6 text-[#31575b]" role="status">{outcome.notice ?? "La evolución y las piezas salen de lo resuelto en el dictado. Sigue sujeta a tu revisión."}</p>}
          {proposal && <div className="space-y-4" data-testid="dictation-review">
            <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4" data-testid="dictation-corrected">
              <h3 className="font-semibold">Texto corregido</h3>
              <p className="mt-1 text-xs leading-5 text-[#60757a]">Diccionario clínico e IA corrigen lo mal oído sin agregar datos. Cada cambio queda marcado; lo que la IA quiso cambiar sin respaldo se descarta. Puedes editarlo y volver a proponer.</p>
              {corrections.length > 0 ? <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Correcciones">
                {corrections.map((item, index) => <li key={`${item.original}-${index}`} className={`rounded-lg px-2 py-1 ${item.applied ? "bg-white" : "bg-amber-50 text-amber-950"}`} title={item.reason}>
                  <span className="text-rose-800 line-through">{item.original}</span> → <span className={item.applied ? "font-medium text-emerald-900" : "text-amber-900"}>{item.corrected}</span>
                  <span className="ml-1 text-[10px] uppercase text-[#71858b]">{item.origin === "ia" ? "IA" : "diccionario"}{item.applied ? "" : " · no aplicado"}</span>
                  {!item.applied && item.reason && <span className="block text-[11px]">{item.reason}</span>}
                </li>)}
              </ul> : <p className="mt-2 text-xs text-[#71858b]">Sin correcciones: el texto se entendió tal como se dictó.</p>}
              <Textarea className="mt-2 bg-white text-base sm:text-sm" aria-label="Texto corregido (editable)" rows={4} value={workingText} onChange={(event) => setWorkingText(event.target.value)} data-testid="dictation-corrected-text" />
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={structuring || workingText.trim().length < 3} onClick={() => void structure(workingText)}>Volver a proponer con este texto</Button>
              <p className="mt-1 text-[11px] text-[#71858b]">Volver a proponer rehace la propuesta y descarta los ajustes hechos abajo.</p>
            </section>
            {proposal.clarifications.length > 0 && <section className="rounded-xl bg-amber-50 p-4 text-amber-950" data-testid="dictation-clarifications">
              <h3 className="font-semibold">Falta aclarar ({proposal.clarifications.length})</h3>
              <p className="mt-1 text-xs leading-5">Responde escribiendo o con el micrófono y pulsa «Aplicar respuestas». Lo no respondido no se aplica.</p>
              <ul className="mt-3 space-y-3">{proposal.clarifications.map((question) => <li key={question}>
                <p className="text-sm">{question}</p>
                <div className="mt-1 flex gap-2">
                  <Input className="bg-white text-base sm:text-sm" aria-label={`Respuesta: ${question}`} value={answers[question] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value }))} placeholder="Respuesta" />
                  <Button type="button" variant={answering === question ? "default" : "outline"} size="icon" className={`shrink-0 ${answering === question ? "bg-[#087f83] hover:bg-[#07676b]" : ""}`} aria-label={answering === question ? "Detener respuesta dictada" : "Dictar respuesta"} aria-pressed={answering === question} onClick={() => void dictateAnswer(question)}>{answering === question ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>
                </div>
              </li>)}</ul>
              <Button type="button" className="mt-3 bg-[#087f83] hover:bg-[#07676b]" disabled={structuring || !Object.values(answers).some((value) => value.trim())} onClick={applyAnswers} data-testid="dictation-apply-answers">{structuring ? "Aplicando…" : "Aplicar respuestas"}</Button>
            </section>}
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
                  <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f4f7f8] p-3 text-xs leading-5 text-[#31575b]" data-testid="dictation-final-preview">{finalizeEvolution(evolutionBody, teeth.filter((item) => item.decision === "accepted" && !reviewIssue(item)), literalTranscript())}</p>
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
            <section className="space-y-3">
              <h3 className="font-semibold">Pagos y abonos</h3>
              {paymentItems.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin pagos en el dictado.</p>}
              {paymentItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`} data-testid="dictation-payment">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p><span className="text-[#71858b]">Pago de hoy: </span><span className="font-medium">${Number(item.amountText || 0).toLocaleString("es-CL")}</span> · {item.methodValue ? PAYMENT_METHOD_LABEL[item.methodValue] : <span className="text-amber-800">medio sin indicar</span>}<OriginBadge origin={item.origin} /></p><Evidence text={item.evidence} /></div>
                  <Decision value={item.decision} onChange={(decision) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">Monto CLP<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" inputMode="numeric" value={item.amountText} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amountText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Medio de pago<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.methodValue} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, methodValue: event.target.value as PaymentMethod | "" } : entry))}><option value="">Elegir…</option>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABEL[method]}</option>)}</select></label>
                  <label className="space-y-1">Concepto<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.concept} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, concept: event.target.value } : entry))} /></label>
                  {budgetOptions.length > 0 && <label className="space-y-1">Abona al presupuesto<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.budgetId} onChange={(event) => setPaymentItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, budgetId: event.target.value } : entry))}><option value="">Sin asociar</option>{budgetOptions.map((budget) => <option key={budget.id} value={budget.id}>{budget.title}</option>)}</select></label>}
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
              {perioItems.length === 0 && mobilityItems.length === 0 && <p className="rounded-lg border border-dashed border-[#dce5e7] p-3 text-[#71858b]">Sin sondaje en el dictado.</p>}
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
              {mobilityItems.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.decision === "accepted" ? "border-emerald-200" : "border-[#e4ebed] opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">Movilidad FDI {item.toothText}: grado {item.grade}<OriginBadge origin={item.origin} /></p><Evidence text={item.evidence} /></div>
                  <Decision value={item.decision} onChange={(decision) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, decision } : entry))} />
                </div>
                {item.decision === "accepted" && <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="space-y-1">Pieza FDI<input className="flex h-10 w-full rounded-md border px-3 text-base sm:h-9 sm:text-sm" value={item.toothText} onChange={(event) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, toothText: event.target.value } : entry))} /></label>
                  <label className="space-y-1">Grado<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={item.grade} onChange={(event) => setMobilityItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, grade: event.target.value as MobilityChange["grade"] } : entry))}>{(["0", "I", "II", "III"] as const).map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
                </div>}
              </article>)}
            </section>
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
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-[#e4ebed] bg-white px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
          <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" disabled={!outcome || saving} onClick={() => void confirm()} data-testid="dictation-confirm">{saving ? "Guardando y releyendo…" : "Guardar lo aceptado"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

const MIC_DENIED = "El navegador no autorizó el micrófono. En iPhone: Ajustes > Safari > Micrófono (o Ajustes > Chrome). En computador: el ícono del candado junto a la dirección. Puedes escribir o pegar el texto igual.";

/**
 * Pide el micrófono antes de dictar. En iPhone/iPad se omite: Safari lo pide al iniciar el
 * reconocimiento y abrir y cerrar antes el micrófono puede dejarlo ocupado («audio-capture»).
 */
async function micAllowed(): Promise<boolean> {
  if (IS_IOS || !navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

function Decision({ value, onChange, disabled = false }: { value: "accepted" | "rejected"; onChange: (value: "accepted" | "rejected") => void; disabled?: boolean }) {
  return <div className="flex gap-2">
    <Button type="button" size="sm" variant={value === "accepted" ? "default" : "outline"} className={value === "accepted" ? "bg-[#087f83] hover:bg-[#07676b]" : ""} disabled={disabled} onClick={() => onChange("accepted")}>Aceptar</Button>
    <Button type="button" size="sm" variant={value === "rejected" ? "default" : "outline"} disabled={disabled} onClick={() => onChange("rejected")}>Rechazar</Button>
  </div>;
}
