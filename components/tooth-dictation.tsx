"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Plus, Sparkles, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { dentalSpeechText, speakTextNow } from "@/lib/dictation/speech";
import { toothPrompt } from "@/lib/dictation/tooth-prompts";
import { parseVoiceReviewCommand, stripFinishCommand, TOOTH_ANSWER_SILENCE_MS, voiceAnswerReadback } from "@/lib/dictation/voice-answer";
import { fdiToChile } from "@/lib/tooth-numbering";
import { confirmedCariesFaces, isProximalChange, scopeToothProposal, toothDiagnosisOperation, toothDictationOperation, toothPlanBudgetItem, type ToothDictationOperation } from "@/lib/dictation/tooth-mode";
import type { focusedToothReview, OdontogramChange, StructureOutcome } from "@/lib/dictation/proposal";
import type { BudgetItem } from "@/lib/budget-plans";

type AudioStatus = "idle" | "starting" | "recording" | "transcribing";
type FaceAnswer = "M" | "D" | "both" | "pending";
type Step = "diagnosis" | "plan";
type DiagnosisPreview = {
  changes: OdontogramChange[];
  otherTeeth: number[];
  question: boolean;
  answer?: FaceAnswer;
};

const faceChoices = [
  ["M", "Mesial"], ["D", "Distal"], ["both", "Ambas"], ["pending", "Dejar pendiente"],
] as const;

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

const cleanPlanText = (value: string, tooth: number) => value
  .replace(new RegExp(`^\\s*FDI\\s+${formatFdi(tooth).replace(".", "\\.")}\\s*[.:,]?\\s*`, "i"), "")
  .replace(/^\s*(?:plan(?:\s+de\s+tratamiento)?\s*:\s*)/i, "")
  .trim();

export function ToothDictation({ tooth, chart, disabled = false, onApply }: {
  tooth: number;
  chart: OdontogramData;
  disabled?: boolean;
  onApply?: (tooth: number, operations: ToothDictationOperation[], budgetTitle: string, budgetItems: BudgetItem[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("diagnosis");
  const [diagnosisText, setDiagnosisText] = useState("");
  const [planText, setPlanText] = useState("");
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [speechPurpose, setSpeechPurpose] = useState<"question" | "readback" | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [answerReady, setAnswerReady] = useState(false);
  const [listeningFor, setListeningFor] = useState<"answer" | "review" | "proposal" | null>(null);
  const [proposalVoiceRound, setProposalVoiceRound] = useState(0);
  const [proposalReady, setProposalReady] = useState(false);
  const [diagnosisPreview, setDiagnosisPreview] = useState<DiagnosisPreview | null>(null);
  const [planItems, setPlanItems] = useState<BudgetItem[]>([]);
  const [planOtherTeeth, setPlanOtherTeeth] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const engine = useRef<ReturnType<typeof createAudioTranscription> | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const flowId = useRef(0);
  const answerTextRef = useRef({ diagnosis: "", plan: "" });
  const confirmAnswerRef = useRef<(answerStep: Step) => Promise<void>>(async () => {});
  const applyProposalRef = useRef<() => Promise<void>>(async () => {});
  const canSaveRef = useRef(false);
  if (engine.current === null) engine.current = createAudioTranscription();

  useEffect(() => () => {
    engine.current?.abort();
    analysisController.current?.abort();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  const speak = (text: string, purpose: "question" | "readback", afterSpeech?: () => void) => {
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      setSpeaking(false);
      setSpeechPurpose(null);
      afterSpeech?.();
    };
    setSpeaking(true);
    setSpeechPurpose(purpose);
    setSpeechError("");
    const started = speakTextNow(dentalSpeechText(text), {
      rate: purpose === "readback" ? 0.88 : 0.94,
      onStart: () => setSpeaking(true),
      onEnd: complete,
      onError: error => {
        setSpeaking(false);
        setSpeechPurpose(null);
        if (error === "interrupted" || error === "canceled") { complete(); return; }
        setSpeechError(error === "not-allowed"
          ? "El navegador bloqueó la voz. Toca «Repetir pregunta» para intentarlo de nuevo y revisa el volumen."
          : "No se pudo reproducir el audio. Puedes leer la respuesta en pantalla y continuar.");
        complete();
      },
    });
    if (!started) {
      setSpeaking(false);
      setSpeechPurpose(null);
      setSpeechError("Este navegador no puede reproducir el audio en voz alta. Puedes leerlo y continuar.");
      afterSpeech?.();
    }
  };

  const readQuestion = (text: string, afterSpeech?: () => void) => speak(text, "question", afterSpeech);
  const readAnswer = (answerStep: Step, text: string) => {
    const currentFlow = flowId.current;
    speak(voiceAnswerReadback(answerStep, text), "readback", () => {
      if (flowId.current === currentFlow) startVoiceReview(answerStep);
    });
  };

  const cancelQuestion = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setSpeechPurpose(null);
  };

  const currentText = step === "diagnosis" ? diagnosisText : planText;
  const setCurrentText = (value: string) => {
    if (step === "diagnosis") {
      setDiagnosisText(value);
      answerTextRef.current.diagnosis = value;
      setDiagnosisPreview(null);
      setSelectedIds(new Set());
    } else {
      setPlanText(value);
      answerTextRef.current.plan = value;
      setPlanItems([]);
      setPlanOtherTeeth([]);
    }
    setProposalReady(false);
    setAnalysisError("");
  };

  const reset = () => {
    flowId.current += 1;
    engine.current?.abort();
    analysisController.current?.abort();
    analysisController.current = null;
    setStep("diagnosis");
    setDiagnosisText("");
    setPlanText("");
    answerTextRef.current = { diagnosis: "", plan: "" };
    setAudioStatus("idle");
    setSpeaking(false);
    setSpeechPurpose(null);
    setSpeechError("");
    setAnalysisError("");
    setAnswerReady(false);
    setListeningFor(null);
    setProposalVoiceRound(0);
    setProposalReady(false);
    setDiagnosisPreview(null);
    setPlanItems([]);
    setPlanOtherTeeth([]);
    setSelectedIds(new Set());
    setAnalyzing(false);
    setApplying(false);
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) { cancelQuestion(); reset(); }
  };

  const startGuidedEvaluation = () => {
    reset();
    setOpen(true);
    askStep("diagnosis");
  };

  const startVoiceAnswer = (answerStep: Step) => {
    if (!engine.current?.isSupported()) {
      setSpeechError(engine.current?.unsupportedMessage() ?? "El micrófono no está disponible en este navegador.");
      return;
    }
    setAnalysisError("");
    setAnswerReady(false);
    setListeningFor("answer");
    setAudioStatus("starting");
    engine.current.start("", {
      onStatus: (status) => setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle"),
      onTranscript: transcript => {
        const answerText = stripFinishCommand(transcript);
        if (answerText.length < 3) {
          setSpeechError("No alcancé a captar una respuesta antes de terminar. Toca «Volver a dictar» o escríbela.");
          setAudioStatus("idle");
          setListeningFor(null);
          return;
        }
        if (answerStep === "diagnosis") {
          setDiagnosisText(answerText);
          answerTextRef.current.diagnosis = answerText;
          setDiagnosisPreview(null);
          setSelectedIds(new Set());
        } else {
          setPlanText(answerText);
          answerTextRef.current.plan = answerText;
          setPlanItems([]);
          setPlanOtherTeeth([]);
        }
        setProposalReady(false);
        setAnswerReady(true);
        setListeningFor(null);
        readAnswer(answerStep, answerText);
      },
      onError: message => { setSpeechError(message); setAudioStatus("idle"); setListeningFor(null); },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS });
  };

  const startVoiceReview = (answerStep: Step) => {
    if (!engine.current?.isSupported()) return;
    setListeningFor("review");
    engine.current.start("", {
      onStatus: status => setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle"),
      onTranscript: transcript => {
        setListeningFor(null);
        const command = parseVoiceReviewCommand(transcript, answerStep);
        if (command === "accept") void confirmAnswerRef.current(answerStep);
        else if (command === "correct") askStep(answerStep);
        else if (command === "repeat") readAnswer(answerStep, answerTextRef.current[answerStep]);
        else {
          const currentFlow = flowId.current;
          speak(`No entendí la orden. Di correcto, ${answerStep === "diagnosis" ? "pasar al plan" : "preparar propuesta"}; rectificar; o repetir.`, "question", () => {
            if (flowId.current === currentFlow) startVoiceReview(answerStep);
          });
        }
      },
      onError: message => { setSpeechError(message); setAudioStatus("idle"); setListeningFor(null); },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS, purpose: "tooth_command" });
  };

  const startVoiceProposal = () => {
    if (!engine.current?.isSupported()) return;
    setListeningFor("proposal");
    engine.current.start("", {
      onStatus: status => setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle"),
      onTranscript: transcript => {
        setListeningFor(null);
        const command = parseVoiceReviewCommand(transcript, "proposal");
        if (command === "save") {
          if (canSaveRef.current) void applyProposalRef.current();
          else speak("La propuesta necesita una aclaración antes de guardar. Escucha la pregunta y responde.", "question", () => setProposalVoiceRound(round => round + 1));
        } else if (command === "mesial" || command === "distal" || command === "both" || command === "pending") {
          const face = command === "mesial" ? "M" : command === "distal" ? "D" : command;
          setDiagnosisPreview(current => current?.question ? { ...current, answer: face } : current);
          setProposalVoiceRound(round => round + 1);
        } else if (command === "correct") {
          setProposalReady(false);
          askStep(/diagn[oó]stic|hip[oó]tes/i.test(transcript) ? "diagnosis" : "plan");
        } else if (command === "repeat") setProposalVoiceRound(round => round + 1);
        else {
          const currentFlow = flowId.current;
          speak("No entendí la orden. Di guardar diagnóstico y plan, rectificar, o repetir.", "question", () => {
            if (flowId.current === currentFlow) startVoiceProposal();
          });
        }
      },
      onError: message => { setSpeechError(message); setAudioStatus("idle"); setListeningFor(null); },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS, purpose: "tooth_command" });
  };

  const askStep = (nextStep: Step) => {
    engine.current?.abort();
    setAudioStatus("idle");
    setListeningFor(null);
    setStep(nextStep);
    setAnswerReady(false);
    setAnalysisError("");
    setSpeechError("");
    setProposalReady(false);
    if (nextStep === "diagnosis") {
      setDiagnosisText("");
      answerTextRef.current.diagnosis = "";
      setDiagnosisPreview(null);
      setSelectedIds(new Set());
    } else {
      setPlanText("");
      answerTextRef.current.plan = "";
      setPlanItems([]);
      setPlanOtherTeeth([]);
    }
    const currentFlow = flowId.current;
    readQuestion(toothPrompt(nextStep, tooth), () => {
      if (flowId.current === currentFlow) startVoiceAnswer(nextStep);
    });
  };

  const finishOrStartAnswer = () => {
    if (speaking || audioStatus === "transcribing" || analyzing || applying) return;
    if (audioStatus === "recording") engine.current?.stop();
    else if (audioStatus === "idle") {
      if (answerReady) askStep(step);
      else { setSpeechError(""); startVoiceAnswer(step); }
    }
  };

  const runStructure = async (transcript: string) => {
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalyzing(true);
    setAnalysisError("");
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
        body: JSON.stringify({ transcript, chart: [chartTooth], focused: true }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      });
      const data = await response.json() as StructureOutcome & { error?: string; review?: ReturnType<typeof focusedToothReview> };
      if (controller.signal.aborted) return null;
      if (!response.ok || !data.proposal || !data.review) throw new Error(data.error || "No se pudo revisar esta pieza. Intenta de nuevo.");
      return data;
    } catch (cause) {
      if (controller.signal.aborted) return null;
      throw cause;
    } finally {
      if (analysisController.current === controller) {
        analysisController.current = null;
        setAnalyzing(false);
      }
    }
  };

  const prepareDiagnosis = async (): Promise<boolean> => {
    const text = answerTextRef.current.diagnosis.trim();
    if (text.length < 3) { setAnalysisError("Indica el diagnóstico o la hipótesis clínica de esta pieza."); return false; }
    setDiagnosisPreview(null);
    try {
      const data = await runStructure(`FDI ${formatFdi(tooth)}. Diagnóstico o hipótesis diagnóstica: ${text}`);
      if (!data) return false;
      const scoped = scopeToothProposal(data.proposal.odontogram ?? [], tooth);
      const question = data.review!.cariesFaceQuestion;
      const changes = scoped.changes.filter(change => !question || !isProximalChange(change));
      const eligible = changes.filter(change => toothDictationOperation(change));
      setDiagnosisPreview({
        changes: eligible,
        otherTeeth: [...new Set([...data.review!.otherTeeth, ...scoped.otherTeeth])],
        question,
      });
      setSelectedIds(new Set(eligible.map(change => change.id)));
      return true;
    } catch (cause) {
      if (analysisController.current?.signal.aborted) return false;
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudo revisar el diagnóstico. Revisa la conexión y vuelve a intentarlo.");
      return false;
    }
  };

  const preparePlan = async (): Promise<boolean> => {
    const text = answerTextRef.current.plan.trim();
    if (text.length < 3) { setAnalysisError("Indica el plan de tratamiento preliminar para esta pieza."); return false; }
    setPlanItems([]);
    setPlanOtherTeeth([]);
    try {
      const data = await runStructure(`FDI ${formatFdi(tooth)}. Plan de tratamiento: ${text}`);
      if (!data) return false;
      const plans = (data.proposal.items ?? []).filter(item => item.kind === "plan" && (item.tooth === tooth || item.tooth === null));
      const unique = new Map<string, typeof plans[number]>();
      for (const item of plans) {
        const label = cleanPlanText(item.what || text, tooth);
        const key = label.toLocaleLowerCase("es-CL");
        if (label && !unique.has(key)) unique.set(key, item);
      }
      const rows: BudgetItem[] = [...unique.values()].map(item => toothPlanBudgetItem(cleanPlanText(item.what || text, tooth), tooth, item.arancel));
      setPlanItems(rows.length ? rows : [toothPlanBudgetItem(text, tooth)]);
      setPlanOtherTeeth([...new Set(data.review!.otherTeeth.filter(other => other !== tooth))]);
      return true;
    } catch (cause) {
      if (analysisController.current?.signal.aborted) return false;
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudo preparar el plan. Revisa la conexión y vuelve a intentarlo.");
      return false;
    }
  };

  const confirmAnswer = async (answerStep: Step = step) => {
    if (answerTextRef.current[answerStep].trim().length < 3) { setAnalysisError("Completa o corrige la respuesta antes de continuar."); return; }
    engine.current?.abort();
    setAudioStatus("idle");
    setListeningFor(null);
    setAnswerReady(false);
    setAnalysisError("");
    if (answerStep === "diagnosis") {
      askStep("plan");
      return;
    }
    setProposalReady(false);
    if (!await prepareDiagnosis()) return;
    if (!await preparePlan()) return;
    setProposalReady(true);
  };
  confirmAnswerRef.current = confirmAnswer;

  const listenAndReviewTypedAnswer = () => {
    const text = currentText.trim();
    if (text.length < 3) { setAnalysisError("Indica una respuesta antes de continuar."); return; }
    setAnswerReady(true);
    setAnalysisError("");
    readAnswer(step, text);
  };

  const answer = diagnosisPreview?.answer;
  const confirmedFaces = confirmedCariesFaces(
    answer === "both" ? ["M", "D"] : answer === "M" || answer === "D" ? [answer] : [],
    chart.surfaces[tooth],
  );
  const chartOperations = diagnosisPreview?.changes
    .filter(change => selectedIds.has(change.id))
    .map(toothDictationOperation)
    .filter((operation): operation is ToothDictationOperation => operation !== null) ?? [];
  const diagnosisOperation = toothDiagnosisOperation(diagnosisText);
  const operations: ToothDictationOperation[] = [
    ...chartOperations,
    ...confirmedFaces,
    ...(diagnosisOperation ? [diagnosisOperation] : []),
  ];
  const canContinue = Boolean(diagnosisPreview && diagnosisText.trim().length >= 3 && !diagnosisPreview.otherTeeth.length && (!diagnosisPreview.question || answer));
  const validPlan = planItems.length > 0 && planItems.every(item => item.label.trim().length > 0 && Number.isSafeInteger(Number(item.amount)) && Number(item.amount) >= 0);
  canSaveRef.current = canContinue && validPlan && !planOtherTeeth.length;
  const budgetTitle = `Presupuesto preliminar · FDI ${formatFdi(tooth)} · Chile ${fdiToChile(tooth)}`;

  const applyProposal = async () => {
    if (!canContinue || !validPlan || planOtherTeeth.length || !onApply) return;
    engine.current?.abort();
    setAudioStatus("idle");
    setListeningFor(null);
    setApplying(true);
    setAnalysisError("");
    try {
      await onApply(tooth, operations, budgetTitle, planItems.map(item => ({ ...item, label: item.label.trim(), amount: Number(item.amount), teeth: [tooth] })));
      changeOpen(false);
      speakTextNow("Diagnóstico y plan preliminar guardados.", { rate: 0.94 });
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudieron guardar el diagnóstico y el plan.");
      speakTextNow("No se pudieron guardar los cambios. Revisa el aviso en pantalla.", { rate: 0.94 });
    } finally {
      setApplying(false);
    }
  };
  applyProposalRef.current = applyProposal;

  useEffect(() => {
    if (!proposalReady) return;
    const currentFlow = flowId.current;
    const prompt = diagnosisPreview?.otherTeeth.length
      ? "El diagnóstico menciona otra pieza. Di rectificar diagnóstico para volver a dictarlo."
      : planOtherTeeth.length
        ? "El plan menciona otra pieza. Di rectificar plan para volver a dictarlo."
        : diagnosisPreview?.question && !diagnosisPreview.answer
          ? "Antes de guardar, ¿en qué cara está la caries? Di mesial, distal, ambas o dejar pendiente."
          : !validPlan
            ? "Revisa las prestaciones y sus montos en pantalla antes de guardar. Puedes decir rectificar plan."
            : `Propuesta preliminar para la pieza FDI ${formatFdi(tooth)}. Diagnóstico: ${diagnosisText.trim()}. Plan: ${planItems.map(item => `${item.label}, ${item.amount > 0 ? `${item.amount.toLocaleString("es-CL")} pesos` : "valor por definir"}`).join("; ")}. Esta es la confirmación final. Si estás de acuerdo, di guardar diagnóstico y plan. También puedes decir rectificar o repetir.`;
    speak(prompt, "question", () => { if (flowId.current === currentFlow) startVoiceProposal(); });
  }, [proposalReady, proposalVoiceRound]);

  const updatePlanItem = (index: number, patch: Partial<BudgetItem>) => setPlanItems(previous => previous.map((item, at) => at === index ? { ...item, ...patch, teeth: [tooth] } : item));

  return <>
    {onApply && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={startGuidedEvaluation} data-testid="dictate-selected-tooth">
      <Mic className="mr-2 size-4"/>Dictar esta pieza
    </Button>}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto border-[#dddbe6] bg-white p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>Evaluación guiada por pieza</DialogTitle>
          <DialogDescription>FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}. El profesional revisa y confirma cada dato antes de guardar.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" aria-label="Etapas de la evaluación">
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${step === "diagnosis" ? "border-[#473a6d] bg-violet-50 text-[#3b3355]" : "border-[#e6e4ee] text-[#615f73]"}`}>1 · Diagnóstico</div>
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${step === "plan" ? "border-[#473a6d] bg-violet-50 text-[#3b3355]" : "border-[#e6e4ee] text-[#615f73]"}`}>2 · Plan</div>
        </div>

        <section className="mt-3 rounded-xl bg-[#f7f6fa] p-4" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#625a7c]">{step === "diagnosis" ? "Pregunta 1 · hipótesis diagnóstica" : "Pregunta 2 · plan de tratamiento"}</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#302747]">{toothPrompt(step, tooth)}</h2>
          <Button type="button" variant="ghost" size="sm" className="mt-2 px-2" disabled={speaking || audioStatus !== "idle"} onClick={() => readQuestion(toothPrompt(step, tooth))}>
            <Volume2 className="mr-2 size-4"/>Repetir pregunta
          </Button>
        </section>

        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          Pieza seleccionada: FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}. Puedes omitir el número; otra pieza detiene la revisión.
        </div>

        <label className="mt-3 block text-sm font-medium text-[#3b3355]" htmlFor={`tooth-dictation-${step}-${tooth}`}>
          {step === "diagnosis" ? "Diagnóstico o hipótesis dictada" : "Plan preliminar dictado"}
        </label>
        <Textarea
          id={`tooth-dictation-${step}-${tooth}`}
          value={currentText}
          onChange={event => setCurrentText(event.target.value)}
          disabled={analyzing || applying || audioStatus !== "idle"}
          rows={step === "diagnosis" ? 3 : 4}
          maxLength={step === "diagnosis" ? 1000 : 4000}
          placeholder={step === "diagnosis" ? "Ej.: caries distal en dentina profunda; hipótesis de fractura coronaria…" : "Ej.: restauración con resina compuesta; evaluar endodoncia si se confirma compromiso pulpar…"}
          className="text-base"
        />
        <p role="note" className="mt-2 rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950">Después de cada pregunta el micrófono se activa automáticamente. Di «terminar», deja 3 segundos de silencio o pulsa «Terminar respuesta». SpeakDent leerá lo entendido y escuchará «correcto», «rectificar» o «repetir». También podrás confirmar el guardado por voz.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {audioStatus === "recording" && <Button type="button" variant="outline" onClick={() => engine.current?.stop()} disabled={analyzing || applying} aria-pressed="true"><MicOff className="mr-2 size-4"/>{listeningFor === "answer" ? "Terminar respuesta" : "Terminar orden"}</Button>}
          {audioStatus === "starting" && <Button type="button" variant="outline" disabled><Mic className="mr-2 size-4"/>Preparando micrófono…</Button>}
          {audioStatus === "transcribing" && <Button type="button" variant="outline" disabled><Mic className="mr-2 size-4"/>Transcribiendo…</Button>}
          {audioStatus === "idle" && !proposalReady && <Button type="button" variant="outline" onClick={finishOrStartAnswer} disabled={speaking || analyzing || applying}><Mic className="mr-2 size-4"/>{answerReady ? "Volver a dictar" : "Responder por voz"}</Button>}
          {audioStatus === "idle" && answerReady && !proposalReady && <Button type="button" variant="outline" onClick={() => startVoiceReview(step)} disabled={speaking || analyzing || applying}><Mic className="mr-2 size-4"/>Responder confirmación por voz</Button>}
          {answerReady
            ? <Button type="button" onClick={() => void confirmAnswer()} disabled={speaking || analyzing || applying || currentText.trim().length < 3}><Sparkles className="mr-2 size-4"/>{analyzing ? "Preparando propuesta…" : step === "diagnosis" ? "Correcto, preguntar plan" : "Correcto, preparar propuesta"}</Button>
            : currentText.trim().length >= 3 && audioStatus === "idle" && <Button type="button" onClick={listenAndReviewTypedAnswer} disabled={speaking || analyzing || applying}><Volume2 className="mr-2 size-4"/>Leer y confirmar respuesta</Button>}
        </div>
        {speaking && <p role="status" className="mt-2 text-xs text-[#615f73]">{speechPurpose === "readback" ? "La aplicación lee la respuesta. Confírmala o corrígela cuando termine." : "La aplicación formula la pregunta; al terminar activa el micrófono."}</p>}
        {audioStatus === "starting" && <p role="status" className="mt-2 text-xs text-[#615f73]">Preparando el micrófono…</p>}
        {audioStatus === "recording" && <p role="status" className="mt-2 text-xs text-[#615f73]">{listeningFor === "answer" ? "Te escucho. Di «terminar», guarda silencio 3 segundos o pulsa «Terminar respuesta»." : "Te escucho. Di la orden y guarda silencio 3 segundos, o pulsa «Terminar orden»."}</p>}
        {audioStatus === "transcribing" && <p role="status" className="mt-2 text-xs text-[#615f73]">Transcribiendo tu respuesta…</p>}
        {answerReady && <section className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3" aria-live="polite">
          <h3 className="font-semibold text-[#3b3355]">¿Es correcto lo que entendió SpeakDent?</h3>
          <p className="mt-1 text-sm text-[#3b3355]">{currentText}</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 px-2" onClick={() => readAnswer(step, currentText)} disabled={speaking || audioStatus !== "idle"}><Volume2 className="mr-2 size-4"/>Repetir respuesta</Button>
          <p className="mt-1 text-xs text-[#615f73]">Di «correcto, {step === "diagnosis" ? "pasar al plan" : "preparar propuesta"}», «rectificar» o «repetir».</p>
          <p className="mt-1 text-xs text-[#615f73]">Puedes corregir el texto antes de confirmar.</p>
        </section>}
        {speechError && <p role="alert" className="mt-2 text-sm text-rose-800">{speechError}</p>}
        {analysisError && <p role="alert" className="mt-2 text-sm text-rose-800">{analysisError}</p>}

        {proposalReady && diagnosisPreview && <section className="mt-4 space-y-3 border-t border-[#ebe9f2] pt-4" aria-live="polite">
          <h3 className="font-semibold text-[#3b3355]">Revisa la propuesta para el odontograma</h3>
          {diagnosisPreview.otherTeeth.length > 0
            ? <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">El dictado menciona también {diagnosisPreview.otherTeeth.map(other => `FDI ${formatFdi(other)} · Chile ${fdiToChile(other)}`).join(", ")}. Corrige esta respuesta para mantener una pieza por vez.</p>
            : <>
              {diagnosisPreview.question && <fieldset className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <legend className="px-1 font-semibold text-amber-950">¿En qué cara está la caries?</legend>
                <div className="flex flex-wrap gap-2">
                  {faceChoices.map(([value, label]) => <Button key={value} type="button" size="sm" variant={answer === value ? "default" : "outline"} aria-pressed={answer === value} disabled={applying || audioStatus !== "idle"} onClick={() => { setDiagnosisPreview(current => current ? { ...current, answer: value } : current); setAnalysisError(""); }}>{label}</Button>)}
                </div>
              </fieldset>}
              {diagnosisPreview.changes.length > 0 && <ul className="space-y-2">
                {diagnosisPreview.changes.map(change => <li key={change.id} className="rounded-lg border border-[#e6e4ee] bg-white p-3">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 size-4 accent-[#473a6d]" checked={selectedIds.has(change.id)} disabled={applying} onChange={event => setSelectedIds(previous => { const next = new Set(previous); if (event.target.checked) next.add(change.id); else next.delete(change.id); return next; })}/>
                    <span className="min-w-0 flex-1"><span className="block font-medium text-[#3b3355]">{changeLabel(change, chart)}</span></span>
                  </label>
                </li>)}
              </ul>}
              {!diagnosisPreview.changes.length && <p className="rounded-lg bg-[#f7f6fa] p-3 text-sm text-[#615f73]">No hay un cambio directo que representar en el odontograma. El texto dictado quedará en el historial de esta pieza.</p>}
            </>}
        </section>}

        {proposalReady && step === "plan" && planItems.length > 0 && <section className="mt-4 space-y-3 border-t border-[#ebe9f2] pt-4" aria-live="polite">
          <div>
            <h3 className="font-semibold text-[#3b3355]">Presupuesto preliminar · editable</h3>
            <p className="mt-1 text-sm text-[#615f73]">Los valores quedan por definir hasta que los completes. El plan se guardará como borrador para esta pieza.</p>
          </div>
          {planOtherTeeth.length > 0 && <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">La respuesta también nombra {planOtherTeeth.map(other => `FDI ${formatFdi(other)}`).join(", ")}. Corrígela para guardar un plan por pieza.</p>}
          <ul className="space-y-3">
            {planItems.map((item, index) => <li key={`${index}-${item.code ?? ""}`} className="grid gap-2 rounded-lg border border-[#e6e4ee] bg-white p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <label className="block text-sm font-medium text-[#3b3355]">Prestación<input type="text" value={item.label} maxLength={180} onChange={event => updatePlanItem(index, { label: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[#d8d5e2] px-3 font-normal"/></label>
              <label className="block text-sm font-medium text-[#3b3355]">Valor CLP<input type="number" min={0} max={1_000_000_000} step={1000} value={item.amount} onChange={event => updatePlanItem(index, { amount: event.target.value === "" ? 0 : Number(event.target.value) })} className="mt-1 h-10 w-full rounded-lg border border-[#d8d5e2] px-3 font-normal"/></label>
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar prestación ${index + 1}`} disabled={planItems.length <= 1} onClick={() => setPlanItems(previous => previous.filter((_, at) => at !== index))}><Trash2 className="size-4"/></Button>
            </li>)}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => setPlanItems(previous => [...previous, toothPlanBudgetItem("", tooth)])}><Plus className="mr-2 size-4"/>Agregar prestación</Button>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
            <p className="font-semibold">Resumen para FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}</p>
            <p className="mt-1"><strong>Diagnóstico / hipótesis:</strong> {diagnosisText.trim()}</p>
            <p className="mt-1"><strong>Plan:</strong> {planItems.map(item => item.label || "prestación sin nombre").join("; ")}</p>
            <p className="mt-2">Para confirmar por voz, di «guardar diagnóstico y plan». También puedes decir «rectificar» o «repetir».</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#ebe9f2] pt-3">
            <Button type="button" variant="outline" onClick={() => { setProposalReady(false); askStep("diagnosis"); }} disabled={applying}>Volver a responder el diagnóstico</Button>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={applying}>Cancelar</Button>
            <Button type="button" onClick={() => void applyProposal()} disabled={applying || analyzing || audioStatus !== "idle" || !canContinue || !validPlan || Boolean(planOtherTeeth.length)}>{applying ? "Guardando…" : "Guardar diagnóstico y plan"}</Button>
          </div>
        </section>}
      </DialogContent>
    </Dialog>
  </>;
}
