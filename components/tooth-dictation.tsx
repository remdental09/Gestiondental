"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Plus, Sparkles, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { dentalSpeechText, speakTextNow } from "@/lib/dictation/speech";
import { toothChileSpeechLabel, toothPrompt, toothSpeechPrompt } from "@/lib/dictation/tooth-prompts";
import { parseVoiceReviewCommand, stripFinishCommand, TOOTH_ANSWER_SILENCE_MS, TOOTH_COMMAND_MAX_MS, voiceAnswerReadback, voiceReviewApprovalPhrase } from "@/lib/dictation/voice-answer";
import { fdiToChile } from "@/lib/tooth-numbering";
import { dictationHealthErrorCode, recordDictationHealthEvent } from "@/lib/dictation/health-client";
import { confirmedCariesFaces, isProximalChange, scopeToothProposal, toothDiagnosisOperation, toothDictationOperation, toothPlanBudgetItem, type ToothDictationOperation } from "@/lib/dictation/tooth-mode";
import type { focusedToothReview, OdontogramChange, StructureOutcome } from "@/lib/dictation/proposal";
import type { BudgetItem } from "@/lib/budget-plans";
import { looksPerformed, mergeOperations, restoredSurfacesFrom, type DictationMode } from "@/lib/tooth-performed";
import type { ToothGuidedStep } from "@/lib/dictation/tooth-prompts";

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
  onApply?: (tooth: number, operations: ToothDictationOperation[], budgetTitle: string, budgetItems: BudgetItem[], evolution: { title: string; body: string }, performed: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("diagnosis");
  const [mode, setMode] = useState<DictationMode | null>(null);
  const [diagnosisText, setDiagnosisText] = useState("");
  const [planText, setPlanText] = useState("");
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [speechPurpose, setSpeechPurpose] = useState<"question" | "readback" | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [answerReady, setAnswerReady] = useState(false);
  const [numericReviewDraft, setNumericReviewDraft] = useState<string | null>(null);
  const [redrafting, setRedrafting] = useState(false);
  const [rawAnswerText, setRawAnswerText] = useState("");
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
  const redraftController = useRef<AbortController | null>(null);
  const flowId = useRef(0);
  const answerTextRef = useRef({ diagnosis: "", plan: "" });
  const aiReviewedRef = useRef({ diagnosis: false, plan: false });
  const rawOtherTeethRef = useRef<{ diagnosis: number[]; plan: number[] }>({ diagnosis: [], plan: [] });
  const confirmAnswerRef = useRef<(answerStep: Step) => Promise<void>>(async () => {});
  const applyProposalRef = useRef<() => Promise<void>>(async () => {});
  const canSaveRef = useRef(false);
  const telemetryFlowActive = useRef(false);
  const telemetryFlowCompleted = useRef(false);
  const telemetryTranscribingAt = useRef<number | null>(null);
  const telemetrySaveStartedAt = useRef<number | null>(null);
  if (engine.current === null) engine.current = createAudioTranscription();
  const done = mode === "done";
  const second: ToothGuidedStep = done ? "done" : "plan";
  const promptStep = (value: Step): ToothGuidedStep => value === "plan" ? second : value;
  const planWord = done ? "el tratamiento realizado" : "el plan";

  useEffect(() => () => {
    if (telemetryFlowActive.current && !telemetryFlowCompleted.current) {
      recordDictationHealthEvent("flow_abandoned", "flow");
      telemetryFlowActive.current = false;
    }
    engine.current?.abort();
    analysisController.current?.abort();
    redraftController.current?.abort();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  const speak = (text: string, purpose: "question" | "readback", afterSpeech?: () => void) => {
    let completed = false;
    const healthStage = proposalReady ? "proposal" : step;
    recordDictationHealthEvent("tts_started", healthStage);
    const complete = (success = true) => {
      if (completed) return;
      completed = true;
      setSpeaking(false);
      setSpeechPurpose(null);
      if (success) recordDictationHealthEvent("tts_succeeded", healthStage);
      afterSpeech?.();
    };
    setSpeaking(true);
    setSpeechPurpose(purpose);
    setSpeechError("");
    const started = speakTextNow(dentalSpeechText(text), {
      rate: 1.3,
      onStart: () => setSpeaking(true),
      onEnd: complete,
      onError: error => {
        setSpeaking(false);
        setSpeechPurpose(null);
        if (error === "interrupted" || error === "canceled") { complete(false); return; }
        recordDictationHealthEvent("tts_error", healthStage, { errorCode: dictationHealthErrorCode(error, "tts") });
        setSpeechError(error === "not-allowed"
          ? "El navegador bloqueó la voz. Toca «Repetir pregunta» para intentarlo de nuevo y revisa el volumen."
          : "No se pudo reproducir el audio. Puedes leer la respuesta en pantalla y continuar.");
        complete(false);
      },
    });
    if (!started) {
      setSpeaking(false);
      setSpeechPurpose(null);
      setSpeechError("Este navegador no puede reproducir el audio en voz alta. Puedes leerlo y continuar.");
      recordDictationHealthEvent("tts_error", healthStage, { errorCode: "unsupported" });
      complete(false);
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
    aiReviewedRef.current[step] = false;
    setAnswerReady(false);
    setNumericReviewDraft(null);
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
    redraftController.current?.abort();
    analysisController.current = null;
    redraftController.current = null;
    setStep("diagnosis");
    setDiagnosisText("");
    setPlanText("");
    answerTextRef.current = { diagnosis: "", plan: "" };
    aiReviewedRef.current = { diagnosis: false, plan: false };
    rawOtherTeethRef.current = { diagnosis: [], plan: [] };
    setAudioStatus("idle");
    setSpeaking(false);
    setSpeechPurpose(null);
    setSpeechError("");
    setAnalysisError("");
    setAnswerReady(false);
    setNumericReviewDraft(null);
    setRedrafting(false);
    setRawAnswerText("");
    setListeningFor(null);
    setProposalVoiceRound(0);
    setProposalReady(false);
    setDiagnosisPreview(null);
    setPlanItems([]);
    setPlanOtherTeeth([]);
    setSelectedIds(new Set());
    setAnalyzing(false);
    setApplying(false);
    setMode(null);
    telemetryFlowActive.current = false;
    telemetryFlowCompleted.current = false;
    telemetryTranscribingAt.current = null;
    telemetrySaveStartedAt.current = null;
  };

  const changeOpen = (next: boolean) => {
    if (!next && telemetryFlowActive.current && !telemetryFlowCompleted.current) {
      recordDictationHealthEvent("flow_abandoned", "flow");
      telemetryFlowActive.current = false;
    }
    setOpen(next);
    if (!next) { cancelQuestion(); reset(); }
  };

  const redraftAnswer = async (answerStep: Step, transcript: string, forceDone = false) => {
    redraftController.current?.abort();
    const controller = new AbortController();
    redraftController.current = controller;
    const currentFlow = flowId.current;
    const redraftStartedAt = Date.now();
    recordDictationHealthEvent("redraft_started", answerStep);
    aiReviewedRef.current[answerStep] = false;
    setRawAnswerText(transcript);
    setRedrafting(true);
    setAnswerReady(false);
    setNumericReviewDraft(null);
    setAnalysisError("");
    try {
      const response = await fetch("/api/dictation/tooth-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: answerStep === "plan" ? (forceDone ? "done" : second) : answerStep, tooth, transcript }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]),
      });
      const data = await response.json() as { text?: string; otherTeeth?: number[]; provider?: string; error?: string; code?: string; draft?: string };
      if (controller.signal.aborted || flowId.current !== currentFlow) return;
      if (!response.ok && data.code === "numeric_mismatch" && typeof data.draft === "string") {
        recordDictationHealthEvent("numeric_mismatch", answerStep, { errorCode: "numeric_mismatch", durationMs: Date.now() - redraftStartedAt });
        setNumericReviewDraft(data.draft);
        setAnalysisError("La IA cambió una cifra. Tu dictado sigue en el campo de arriba; compara la propuesta, corrige el dato y pulsa «Ordenar con IA y escuchar». No necesitas volver a dictar todo.");
        return;
      }
      if (!response.ok || data.provider !== "openai" || typeof data.text !== "string" || data.text.trim().length < 3) throw new Error(data.error || "El modelo no devolvió una redacción válida.");
      const draft = data.text.trim();
      recordDictationHealthEvent("redraft_succeeded", answerStep, { durationMs: Date.now() - redraftStartedAt });
      rawOtherTeethRef.current[answerStep] = Array.isArray(data.otherTeeth) ? data.otherTeeth.filter(value => Number.isInteger(value) && value !== tooth) : [];
      if (answerStep === "diagnosis") {
        setDiagnosisText(draft);
        answerTextRef.current.diagnosis = draft;
        setDiagnosisPreview(null);
        setSelectedIds(new Set());
      } else {
        setPlanText(draft);
        answerTextRef.current.plan = draft;
        setPlanItems([]);
        setPlanOtherTeeth([]);
      }
      setProposalReady(false);
      aiReviewedRef.current[answerStep] = true;
      setAnswerReady(true);
      readAnswer(answerStep, draft);
    } catch (cause) {
      if (!controller.signal.aborted && flowId.current === currentFlow) {
        recordDictationHealthEvent("redraft_error", answerStep, { errorCode: dictationHealthErrorCode(cause instanceof Error ? cause.message : "", "redraft"), durationMs: Date.now() - redraftStartedAt });
        setAnalysisError(cause instanceof Error ? cause.message : "No se pudo redactar la respuesta. Reintenta o corrige el texto.");
      }
    } finally {
      if (redraftController.current === controller) {
        redraftController.current = null;
        setRedrafting(false);
      }
    }
  };

  const startGuidedEvaluation = () => {
    reset();
    telemetryFlowActive.current = true;
    telemetryFlowCompleted.current = false;
    recordDictationHealthEvent("flow_started", "flow");
    setOpen(true);
  };

  const chooseMode = (next: DictationMode) => {
    setMode(next);
    askStep("diagnosis");
  };

  const startVoiceAnswer = (answerStep: Step) => {
    if (!engine.current?.isSupported()) {
      setSpeechError(engine.current?.unsupportedMessage() ?? "El micrófono no está disponible en este navegador.");
      recordDictationHealthEvent("audio_error", answerStep, { errorCode: "unsupported" });
      return;
    }
    telemetryTranscribingAt.current = null;
    let recordingStarted = false;
    setAnalysisError("");
    setAnswerReady(false);
    setListeningFor("answer");
    setAudioStatus("starting");
    engine.current.start("", {
      onStatus: (status) => {
        if (status === "recording" && !recordingStarted) {
          recordingStarted = true;
          recordDictationHealthEvent("audio_started", answerStep);
        }
        if (status === "transcribing" && telemetryTranscribingAt.current === null) telemetryTranscribingAt.current = Date.now();
        setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle");
      },
      onTranscript: transcript => {
        recordDictationHealthEvent("transcription_succeeded", answerStep, { durationMs: telemetryTranscribingAt.current === null ? undefined : Date.now() - telemetryTranscribingAt.current });
        telemetryTranscribingAt.current = null;
        const answerText = stripFinishCommand(transcript);
        if (answerText.length < 3) {
          recordDictationHealthEvent("transcription_error", answerStep, { errorCode: "audio_empty" });
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
        setListeningFor(null);
        void redraftAnswer(answerStep, answerText);
      },
      onError: message => {
        const transcriptionFailed = telemetryTranscribingAt.current !== null;
        const errorCode = dictationHealthErrorCode(message, transcriptionFailed ? "transcription" : "audio");
        recordDictationHealthEvent(transcriptionFailed ? "transcription_error" : "audio_error", answerStep, { errorCode, durationMs: transcriptionFailed ? Date.now() - telemetryTranscribingAt.current! : undefined });
        telemetryTranscribingAt.current = null;
        setSpeechError(message); setAudioStatus("idle"); setListeningFor(null);
      },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS });
  };

  const startVoiceReview = (answerStep: Step) => {
    if (!engine.current?.isSupported()) {
      setSpeechError(engine.current?.unsupportedMessage() ?? "El micrófono no está disponible en este navegador.");
      recordDictationHealthEvent("audio_error", answerStep, { errorCode: "unsupported" });
      return;
    }
    telemetryTranscribingAt.current = null;
    let recordingStarted = false;
    setListeningFor("review");
    engine.current.start("", {
      onStatus: status => {
        if (status === "recording" && !recordingStarted) {
          recordingStarted = true;
          recordDictationHealthEvent("audio_started", answerStep);
        }
        if (status === "transcribing" && telemetryTranscribingAt.current === null) telemetryTranscribingAt.current = Date.now();
        setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle");
      },
      onTranscript: transcript => {
        recordDictationHealthEvent("transcription_succeeded", answerStep, { durationMs: telemetryTranscribingAt.current === null ? undefined : Date.now() - telemetryTranscribingAt.current });
        telemetryTranscribingAt.current = null;
        setListeningFor(null);
        const command = parseVoiceReviewCommand(transcript, answerStep);
        recordDictationHealthEvent(command ? "voice_command" : "voice_unrecognized", answerStep);
        if (command === "accept") void confirmAnswerRef.current(answerStep);
        else if (command === "correct") askStep(answerStep);
        else if (command === "repeat") readAnswer(answerStep, answerTextRef.current[answerStep]);
        else {
          const currentFlow = flowId.current;
          speak(`No entendí la orden. Di ${voiceReviewApprovalPhrase(answerStep).toLowerCase()}; rectificar; o repetir.`, "question", () => {
            if (flowId.current === currentFlow) startVoiceReview(answerStep);
          });
        }
      },
      onError: message => {
        const transcriptionFailed = telemetryTranscribingAt.current !== null;
        const errorCode = dictationHealthErrorCode(message, transcriptionFailed ? "transcription" : "audio");
        recordDictationHealthEvent(transcriptionFailed ? "transcription_error" : "audio_error", answerStep, { errorCode, durationMs: transcriptionFailed ? Date.now() - telemetryTranscribingAt.current! : undefined });
        telemetryTranscribingAt.current = null;
        setSpeechError(message); setAudioStatus("idle"); setListeningFor(null);
      },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS, maxDurationMs: TOOTH_COMMAND_MAX_MS, purpose: "tooth_command" });
  };

  const startVoiceProposal = () => {
    if (!engine.current?.isSupported()) {
      setSpeechError(engine.current?.unsupportedMessage() ?? "El micrófono no está disponible en este navegador.");
      recordDictationHealthEvent("audio_error", "proposal", { errorCode: "unsupported" });
      return;
    }
    telemetryTranscribingAt.current = null;
    let recordingStarted = false;
    setListeningFor("proposal");
    engine.current.start("", {
      onStatus: status => {
        if (status === "recording" && !recordingStarted) {
          recordingStarted = true;
          recordDictationHealthEvent("audio_started", "proposal");
        }
        if (status === "transcribing" && telemetryTranscribingAt.current === null) telemetryTranscribingAt.current = Date.now();
        setAudioStatus(status === "recording" || status === "starting" || status === "transcribing" ? status : "idle");
      },
      onTranscript: transcript => {
        recordDictationHealthEvent("transcription_succeeded", "proposal", { durationMs: telemetryTranscribingAt.current === null ? undefined : Date.now() - telemetryTranscribingAt.current });
        telemetryTranscribingAt.current = null;
        setListeningFor(null);
        const command = parseVoiceReviewCommand(transcript, "proposal");
        recordDictationHealthEvent(command ? "voice_command" : "voice_unrecognized", "proposal");
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
          speak("No entendí la orden. Di correcto para guardar el diagnóstico y el plan, rectificar o repetir.", "question", () => {
            if (flowId.current === currentFlow) startVoiceProposal();
          });
        }
      },
      onError: message => {
        const transcriptionFailed = telemetryTranscribingAt.current !== null;
        const errorCode = dictationHealthErrorCode(message, transcriptionFailed ? "transcription" : "audio");
        recordDictationHealthEvent(transcriptionFailed ? "transcription_error" : "audio_error", "proposal", { errorCode, durationMs: transcriptionFailed ? Date.now() - telemetryTranscribingAt.current! : undefined });
        telemetryTranscribingAt.current = null;
        setSpeechError(message); setAudioStatus("idle"); setListeningFor(null);
      },
      onEnd: () => setAudioStatus("idle"),
    }, { stopOnSilenceMs: TOOTH_ANSWER_SILENCE_MS, maxDurationMs: TOOTH_COMMAND_MAX_MS, purpose: "tooth_command" });
  };

  const askStep = (nextStep: Step) => {
    engine.current?.abort();
    redraftController.current?.abort();
    redraftController.current = null;
    setAudioStatus("idle");
    setRedrafting(false);
    setRawAnswerText("");
    setListeningFor(null);
    setStep(nextStep);
    setAnswerReady(false);
    setNumericReviewDraft(null);
    setAnalysisError("");
    setSpeechError("");
    setProposalReady(false);
    if (nextStep === "diagnosis") {
      setDiagnosisText("");
      answerTextRef.current.diagnosis = "";
      aiReviewedRef.current.diagnosis = false;
      rawOtherTeethRef.current.diagnosis = [];
      setDiagnosisPreview(null);
      setSelectedIds(new Set());
    } else {
      setPlanText("");
      answerTextRef.current.plan = "";
      aiReviewedRef.current.plan = false;
      rawOtherTeethRef.current.plan = [];
      setPlanItems([]);
      setPlanOtherTeeth([]);
    }
    const currentFlow = flowId.current;
    readQuestion(toothSpeechPrompt(promptStep(nextStep), tooth), () => {
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
    const reviewStartedAt = Date.now();
    recordDictationHealthEvent("proposal_review_started", "proposal");
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
      recordDictationHealthEvent("proposal_review_succeeded", "proposal", { durationMs: Date.now() - reviewStartedAt });
      return data;
    } catch (cause) {
      if (controller.signal.aborted) return null;
      recordDictationHealthEvent("proposal_review_error", "proposal", { errorCode: dictationHealthErrorCode(cause instanceof Error ? cause.message : "", "redraft"), durationMs: Date.now() - reviewStartedAt });
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
        otherTeeth: [...new Set([...rawOtherTeethRef.current.diagnosis, ...data.review!.otherTeeth, ...scoped.otherTeeth])],
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
    if (text.length < 3) { setAnalysisError(done ? "Indica el tratamiento que realizaste en esta pieza." : "Indica el plan de tratamiento preliminar para esta pieza."); return false; }
    setPlanItems([]);
    setPlanOtherTeeth([]);
    try {
      const data = await runStructure(done ? `FDI ${formatFdi(tooth)}. Procedimiento realizado hoy: ${text}` : `FDI ${formatFdi(tooth)}. Plan de tratamiento: ${text}`);
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
      if (done) {
        // Lo realizado cambia el odontograma: lo que entiende el motor para esta pieza y, de respaldo, «obturación oclusal de composite».
        const scoped = scopeToothProposal(data.proposal.odontogram ?? [], tooth).changes.filter(change => toothDictationOperation(change));
        const covered = new Set(scoped.filter(change => change.kind === "surface").map(change => change.surface));
        const fallback: OdontogramChange[] = restoredSurfacesFrom(text).filter(item => !covered.has(item.surface)).map(item => ({
          id: `done:fallback:${item.surface}`, tooth, numbering: scoped[0]?.numbering ?? "fdi", numberingLabel: scoped[0]?.numberingLabel ?? `FDI ${formatFdi(tooth)}`,
          sourceText: text, kind: "surface", surface: item.surface, finding: item.finding, evidence: text, origin: "reglas",
        } as OdontogramChange));
        const performedChanges = [...scoped.map(change => ({ ...change, id: `done:${change.id}` })), ...fallback];
        setDiagnosisPreview(previous => previous ? { ...previous, changes: [...previous.changes.filter(change => !change.id.startsWith("done:")), ...performedChanges] } : previous);
        setSelectedIds(previous => new Set([...previous, ...performedChanges.map(change => change.id)]));
      }
      setPlanOtherTeeth([...new Set([...rawOtherTeethRef.current.plan, ...data.review!.otherTeeth.filter(other => other !== tooth)])]);
      return true;
    } catch (cause) {
      if (analysisController.current?.signal.aborted) return false;
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudo preparar el plan. Revisa la conexión y vuelve a intentarlo.");
      return false;
    }
  };

  const confirmAnswer = async (answerStep: Step = step) => {
    if (!aiReviewedRef.current[answerStep]) { setAnalysisError("Esta respuesta aún no fue revisada por el modelo de IA."); return; }
    if (answerTextRef.current[answerStep].trim().length < 3) { setAnalysisError("Completa o corrige la respuesta antes de continuar."); return; }
    engine.current?.abort();
    setAudioStatus("idle");
    setListeningFor(null);
    setAnswerReady(false);
    setAnalysisError("");
    recordDictationHealthEvent("answer_confirmed", answerStep);
    if (answerStep === "diagnosis") {
      askStep("plan");
      return;
    }
    setProposalReady(false);
    if (!await prepareDiagnosis()) return;
    if (!await preparePlan()) return;
    setProposalReady(true);
    recordDictationHealthEvent("proposal_ready", "proposal");
  };
  confirmAnswerRef.current = confirmAnswer;

  const listenAndReviewTypedAnswer = () => {
    const text = currentText.trim();
    if (text.length < 3) { setAnalysisError("Indica una respuesta antes de continuar."); return; }
    void redraftAnswer(step, text);
  };

  const answer = diagnosisPreview?.answer;
  const confirmedFaces = confirmedCariesFaces(
    answer === "both" ? ["M", "D"] : answer === "M" || answer === "D" ? [answer] : [],
    chart.surfaces[tooth],
  );
  const selectedOperations = (performedOnes: boolean) => diagnosisPreview?.changes
    .filter(change => selectedIds.has(change.id) && change.id.startsWith("done:") === performedOnes)
    .map(toothDictationOperation)
    .filter((operation): operation is ToothDictationOperation => operation !== null) ?? [];
  // Si lo realizado toca lo mismo que el diagnóstico (la caries oclusal pasa a obturación), gana lo realizado.
  const chartOperations = mergeOperations(selectedOperations(false), selectedOperations(true));
  const diagnosisOperation = toothDiagnosisOperation(diagnosisText, planText);
  const operations: ToothDictationOperation[] = [
    ...chartOperations,
    ...confirmedFaces,
    ...(diagnosisOperation ? [diagnosisOperation] : []),
  ];
  const canContinue = Boolean(aiReviewedRef.current.diagnosis && aiReviewedRef.current.plan && diagnosisPreview && diagnosisText.trim().length >= 3 && !diagnosisPreview.otherTeeth.length && (!diagnosisPreview.question || answer));
  const validPlan = planItems.length > 0 && planItems.every(item => item.label.trim().length > 0 && Number.isSafeInteger(Number(item.amount)) && Number(item.amount) >= 0);
  canSaveRef.current = canContinue && validPlan && !planOtherTeeth.length;
  const budgetTitle = `${done ? "Tratamiento realizado" : "Presupuesto preliminar"} · FDI ${formatFdi(tooth)} · Chile ${fdiToChile(tooth)}`;

  const applyProposal = async () => {
    if (!aiReviewedRef.current.diagnosis || !aiReviewedRef.current.plan || !canContinue || !validPlan || planOtherTeeth.length || !onApply) return;
    engine.current?.abort();
    setAudioStatus("idle");
    setListeningFor(null);
    setApplying(true);
    setAnalysisError("");
    telemetrySaveStartedAt.current = Date.now();
    recordDictationHealthEvent("save_started", "save");
    try {
      const finalItems = planItems.map(item => ({ ...item, label: item.label.trim(), amount: Number(item.amount), teeth: [tooth] }));
      const itemSummary = finalItems.map(item => `${item.label}${item.amount > 0 ? `: ${item.amount.toLocaleString("es-CL")} CLP` : ": valor por definir"}`).join("; ");
      const evolution = done ? {
        title: `Procedimiento realizado · pieza chilena ${fdiToChile(tooth)} (FDI ${formatFdi(tooth)})`,
        body: [
          `Diagnóstico / hipótesis diagnóstica, revisada con IA: ${diagnosisText.trim()}`,
          `Procedimiento realizado, revisado con IA: ${planText.trim()}`,
          `Prestaciones realizadas: ${itemSummary}`,
        ].join("\n\n"),
      } : {
        title: `Evolución clínica · pieza chilena ${fdiToChile(tooth)} (FDI ${formatFdi(tooth)})`,
        body: [
          `Diagnóstico / hipótesis diagnóstica, revisada con IA: ${diagnosisText.trim()}`,
          `Plan de tratamiento preliminar, revisado con IA: ${planText.trim()}`,
          `Prestaciones del presupuesto preliminar editable: ${itemSummary}`,
          "Registro presuntivo: el plan no confirma que se hayan realizado los procedimientos.",
        ].join("\n\n"),
      };
      await onApply(tooth, operations, budgetTitle, finalItems, evolution, done);
      recordDictationHealthEvent("save_succeeded", "save", { durationMs: Date.now() - (telemetrySaveStartedAt.current ?? Date.now()) });
      telemetryFlowCompleted.current = true;
      telemetryFlowActive.current = false;
      recordDictationHealthEvent("flow_completed", "flow");
      changeOpen(false);
      speakTextNow(done ? "Procedimiento realizado guardado en la evolución del paciente." : "Diagnóstico y plan preliminar guardados en la evolución del paciente.", { rate: 1.3 });
    } catch (cause) {
      recordDictationHealthEvent("save_error", "save", { errorCode: dictationHealthErrorCode(cause instanceof Error ? cause.message : "", "save"), durationMs: Date.now() - (telemetrySaveStartedAt.current ?? Date.now()) });
      setAnalysisError(cause instanceof Error ? cause.message : "No se pudieron guardar el diagnóstico y el plan.");
      speakTextNow("No se pudieron guardar los cambios. Revisa el aviso en pantalla.", { rate: 1.3 });
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
            : `Propuesta preliminar para ${toothChileSpeechLabel(tooth)}. Diagnóstico: ${diagnosisText.trim()}. ${done ? "Realizado" : "Plan"}: ${planText.trim()}. Prestaciones: ${planItems.map(item => `${item.label}, ${item.amount > 0 ? `${item.amount.toLocaleString("es-CL")} pesos` : "valor por definir"}`).join("; ")}. Esta es la confirmación final. Si estás de acuerdo, di correcto. También puedes decir rectificar o repetir.`;
    speak(prompt, "question", () => { if (flowId.current === currentFlow) startVoiceProposal(); });
  }, [proposalReady, proposalVoiceRound]);

  const updatePlanItem = (index: number, patch: Partial<BudgetItem>) => setPlanItems(previous => previous.map((item, at) => at === index ? { ...item, ...patch, teeth: [tooth] } : item));

  const proposalReviewIssue = Boolean(diagnosisPreview?.otherTeeth.length || planOtherTeeth.length);
  const liveActivityTitle = analysisError
    ? "La respuesta necesita revisión"
    : speechError
      ? "Revisa el micrófono"
      : proposalReady && proposalReviewIssue
      ? "La propuesta necesita una corrección"
      : applying
        ? done ? "Guardando lo realizado" : "Guardando diagnóstico y plan"
        : audioStatus === "starting"
          ? "Preparando el micrófono"
          : audioStatus === "recording"
            ? listeningFor === "answer" ? `Escuchando ${step === "diagnosis" ? "el diagnóstico" : planWord}` : listeningFor === "review" ? "Escuchando tu confirmación" : "Escuchando la orden para guardar"
            : audioStatus === "transcribing"
              ? "Transcribiendo el dictado"
              : redrafting
                ? `La IA está ordenando ${step === "diagnosis" ? "el diagnóstico" : planWord}`
                : analyzing
                  ? `La IA está preparando ${step === "diagnosis" ? "la propuesta diagnóstica" : done ? "lo realizado" : "el plan preliminar"}`
                  : speaking && proposalReady
                    ? "SpeakDent está leyendo la propuesta"
                    : speaking && speechPurpose === "readback"
                      ? "SpeakDent está leyendo la respuesta de la IA"
                      : speaking
                        ? "SpeakDent está haciendo la pregunta"
                        : proposalReady
                          ? "Propuesta lista para revisar"
                          : answerReady
                            ? "Respuesta revisada por IA · confirma o corrige"
                            : step === "diagnosis" ? "Paso 1 · hipótesis diagnóstica" : done ? "Paso 2 · tratamiento realizado" : "Paso 2 · plan de tratamiento";
  const liveActivityText = analysisError || speechError
    ? analysisError || speechError
    : audioStatus === "recording"
      ? listeningFor === "answer"
        ? `Te escucho. Habla con naturalidad; termina diciendo «terminar», guarda silencio 3 segundos o pulsa «Terminar respuesta».`
        : listeningFor === "review"
          ? `Di «${voiceReviewApprovalPhrase(step).toLowerCase()}», «rectificar» o «repetir».`
          : "Di «correcto» para guardar el diagnóstico y el plan, «rectificar» o «repetir»."
      : audioStatus === "starting"
        ? "Activando el micrófono para escuchar tu respuesta."
        : audioStatus === "transcribing"
          ? rawAnswerText || currentText || "Convirtiendo tu voz en texto para revisarlo."
          : redrafting
            ? rawAnswerText || currentText || "La IA está redactando una versión clara de tu respuesta."
            : analyzing
              ? currentText || "La IA está revisando la respuesta antes de preparar cambios."
              : proposalReady && diagnosisPreview?.otherTeeth.length
                ? `El diagnóstico también menciona ${diagnosisPreview.otherTeeth.map(other => `FDI ${formatFdi(other)} · Chile ${fdiToChile(other)}`).join(", ")}. Corrígelo para mantener una pieza por vez.`
                : proposalReady && planOtherTeeth.length
                  ? `El plan también menciona ${planOtherTeeth.map(other => `FDI ${formatFdi(other)} · Chile ${fdiToChile(other)}`).join(", ")}. Corrígelo para mantener una pieza por vez.`
                  : proposalReady
                ? `Diagnóstico: ${diagnosisText.trim() || "pendiente"}. Plan de tratamiento: ${planText.trim() || "pendiente"}. Prestaciones presupuestadas: ${planItems.map(item => `${item.label || "prestación sin nombre"}${item.amount > 0 ? ` · ${item.amount.toLocaleString("es-CL")} CLP` : " · valor por definir"}`).join("; ") || "pendiente"}.${diagnosisPreview?.question && !diagnosisPreview.answer ? " Falta confirmar la cara de la caries." : ""}`
                : answerReady || currentText.trim()
                  ? currentText
                  : toothSpeechPrompt(promptStep(step), tooth);

  return <>
    {onApply && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={startGuidedEvaluation} data-testid="dictate-selected-tooth">
      <Mic className="mr-2 size-4"/>Dictar esta pieza
    </Button>}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[96vw] flex-col gap-0 overflow-hidden border-[#dddbe6] bg-white p-0 sm:max-w-[96vw] 2xl:max-w-[90rem]">
        {mode === null && <div className="absolute inset-0 z-20 flex flex-col justify-center gap-4 overflow-y-auto bg-white p-5 sm:p-8" data-testid="tooth-mode-picker">
          <h2 className="text-2xl font-semibold text-[#302747] sm:text-3xl">¿Qué vas a registrar en la pieza FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}?</h2>
          <button type="button" data-testid="mode-plan" onClick={() => chooseMode("plan")} className="rounded-xl border border-[#d8d3e3] bg-[#f7f6fa] p-5 text-left hover:border-[#473a6d]">
            <span className="block text-xl font-semibold text-[#3b3355]">Planificar tratamiento</span>
            <span className="mt-1 block text-base text-[#615f73]">Lo propones para más adelante: queda como plan y presupuesto en borrador. El odontograma no cambia.</span>
          </button>
          <button type="button" data-testid="mode-done" onClick={() => chooseMode("done")} className="rounded-xl border border-[#473a6d] bg-violet-50 p-5 text-left hover:bg-violet-100">
            <span className="block text-xl font-semibold text-[#3b3355]">Ya lo realicé hoy</span>
            <span className="mt-1 block text-base text-[#615f73]">Queda como procedimiento realizado: cambia el odontograma, la pieza gana una etapa en su película y la prestación se cierra en el presupuesto en vez de duplicarse.</span>
          </button>
          <Button type="button" variant="ghost" className="self-start" onClick={() => changeOpen(false)}>Cancelar</Button>
        </div>}
        <div className="shrink-0 border-b border-[#ebe9f2] bg-white px-4 py-4 sm:px-7 sm:py-5">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl sm:text-2xl">Evaluación guiada por pieza</DialogTitle>
          <DialogDescription>FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}. El profesional revisa y confirma cada dato antes de guardar.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Etapas de la evaluación">
          <div className={`rounded-lg border px-3 py-2.5 text-base font-semibold ${step === "diagnosis" ? "border-[#473a6d] bg-violet-50 text-[#3b3355]" : aiReviewedRef.current.diagnosis ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-[#e6e4ee] text-[#615f73]"}`}>{step !== "diagnosis" && aiReviewedRef.current.diagnosis ? "✓ 1 · Diagnóstico revisado" : "1 · Diagnóstico"}</div>
          <div className={`rounded-lg border px-3 py-2.5 text-base font-semibold ${step === "plan" ? "border-[#473a6d] bg-violet-50 text-[#3b3355]" : "border-[#e6e4ee] text-[#615f73]"}`}>{done ? "2 · Tratamiento realizado" : "2 · Plan de tratamiento"}</div>
        </div>

        <section className={`mt-3 rounded-xl border p-4 sm:p-5 ${analysisError || speechError || (proposalReady && proposalReviewIssue) ? "border-rose-300 bg-rose-50" : audioStatus === "recording" ? "border-rose-200 bg-rose-50" : redrafting || analyzing ? "border-sky-200 bg-sky-50" : "border-violet-200 bg-violet-50"}`} role="region" aria-label="Seguimiento en vivo de la revisión" data-testid="tooth-dictation-live-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#625a7c]">Lo que SpeakDent está haciendo</p>
              <h2 role="status" aria-live="polite" className="mt-1 text-lg font-bold leading-tight text-[#302747] sm:text-xl">{liveActivityTitle}</h2>
            </div>
            <span className="rounded-full border border-[#d8d3e3] bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#473a6d]">{analysisError || speechError || (proposalReady && proposalReviewIssue) ? "Revisar" : audioStatus === "recording" ? "Escuchando" : audioStatus === "transcribing" ? "Transcribiendo" : redrafting || analyzing ? "Procesando" : applying ? "Guardando" : proposalReady ? "Propuesta" : answerReady ? "Revisada por IA" : "En curso"}</span>
          </div>
          {proposalReady && !analysisError && !speechError && !proposalReviewIssue ? <div className="mt-3 grid max-h-40 gap-3 overflow-y-auto border-t border-violet-200 pt-3 text-base leading-relaxed sm:grid-cols-2 sm:text-lg">
            <p><strong className="block text-sm uppercase tracking-wide text-[#625a7c]">Diagnóstico / hipótesis</strong>{diagnosisText.trim() || "Pendiente"}</p>
            <div><p className="text-sm font-bold uppercase tracking-wide text-[#625a7c]">Plan de tratamiento</p><p>{planText.trim() || "Pendiente"}</p><p className="mt-2 text-sm font-bold uppercase tracking-wide text-[#625a7c]">Presupuesto preliminar</p><p>{planItems.map(item => `${item.label || "prestación sin nombre"}${item.amount > 0 ? ` · ${item.amount.toLocaleString("es-CL")} CLP` : " · valor por definir"}`).join("; ") || "Pendiente"}</p>{diagnosisPreview?.question && !diagnosisPreview.answer ? <span className="mt-1 block font-semibold text-amber-900">Falta confirmar la cara de la caries.</span> : null}</div>
          </div> : <p aria-live="off" className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap border-t border-violet-200 pt-3 text-base leading-relaxed text-[#302747] sm:text-lg">{liveActivityText}</p>}
        </section>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <section className="rounded-xl bg-[#f7f6fa] p-4 sm:p-5" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#625a7c]">{step === "diagnosis" ? "Pregunta 1 · hipótesis diagnóstica" : done ? "Pregunta 2 · tratamiento realizado" : "Pregunta 2 · plan de tratamiento"}</p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight text-[#302747] sm:text-4xl">{toothPrompt(promptStep(step), tooth)}</h2>
          <Button type="button" variant="ghost" size="sm" className="mt-2 px-2" disabled={redrafting || speaking || audioStatus !== "idle"} onClick={() => readQuestion(toothSpeechPrompt(promptStep(step), tooth))}>
            <Volume2 className="mr-2 size-4"/>Repetir pregunta
          </Button>
        </section>

        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          Pieza seleccionada: FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}. Puedes omitir el número; otra pieza detiene la revisión.
        </div>

        <label className="mt-3 block text-sm font-medium text-[#3b3355]" htmlFor={`tooth-dictation-${step}-${tooth}`}>
          {step === "diagnosis" ? "Diagnóstico o hipótesis para revisar" : done ? "Tratamiento realizado para revisar" : "Plan preliminar para revisar"}
        </label>
        <Textarea
          id={`tooth-dictation-${step}-${tooth}`}
          value={currentText}
          onChange={event => setCurrentText(event.target.value)}
          disabled={redrafting || analyzing || applying || audioStatus !== "idle"}
          rows={step === "diagnosis" ? 4 : 5}
          maxLength={step === "diagnosis" ? 1000 : 4000}
          placeholder={step === "diagnosis" ? "Ej.: caries distal en dentina profunda; hipótesis de fractura coronaria…" : done ? "Ej.: obturación oclusal con resina compuesta, con anestesia y aislamiento relativo…" : "Ej.: restauración con resina compuesta; evaluar endodoncia si se confirma compromiso pulpar…"}
          className="text-lg leading-relaxed sm:text-xl"
        />
        <p role="note" className="mt-2 rounded-lg bg-sky-50 p-3 text-sm leading-6 text-sky-950">Tras dictar, la IA ordena la respuesta y elimina instrucciones o rectificaciones habladas. SpeakDent leerá la redacción propuesta para que la apruebes o corrijas. La voz se reproduce a 1,3×. Mira el seguimiento en vivo arriba para ver qué está escuchando y redactando.</p>
        {redrafting && <p role="status" className="mt-2 text-lg font-semibold text-[#3b3355]">La IA está redactando {step === "diagnosis" ? "la hipótesis diagnóstica" : done ? "el tratamiento realizado" : "el plan preliminar"}…</p>}
        {rawAnswerText && <details className="mt-2 rounded-lg border border-[#e6e4ee] bg-white p-3 text-sm"><summary className="cursor-pointer font-medium text-[#3b3355]">Ver texto enviado a la IA</summary><p className="mt-2 whitespace-pre-wrap text-[#615f73]">{rawAnswerText}</p></details>}
        <div className="mt-2 flex flex-wrap gap-2">
          {audioStatus === "recording" && <Button type="button" variant="outline" onClick={() => engine.current?.stop()} disabled={analyzing || applying} aria-pressed="true"><MicOff className="mr-2 size-4"/>{listeningFor === "answer" ? "Terminar respuesta" : "Terminar orden"}</Button>}
          {audioStatus === "starting" && <Button type="button" variant="outline" disabled><Mic className="mr-2 size-4"/>Preparando micrófono…</Button>}
          {audioStatus === "transcribing" && <Button type="button" variant="outline" disabled><Mic className="mr-2 size-4"/>Transcribiendo…</Button>}
          {audioStatus === "idle" && !proposalReady && <Button type="button" variant="outline" onClick={finishOrStartAnswer} disabled={redrafting || speaking || analyzing || applying}><Mic className="mr-2 size-4"/>{answerReady ? "Volver a dictar" : "Responder por voz"}</Button>}
          {audioStatus === "idle" && answerReady && !proposalReady && <Button type="button" variant="outline" onClick={() => startVoiceReview(step)} disabled={redrafting || speaking || analyzing || applying}><Mic className="mr-2 size-4"/>Responder confirmación por voz</Button>}
          {answerReady
            ? <Button type="button" onClick={() => void confirmAnswer()} disabled={redrafting || speaking || analyzing || applying || currentText.trim().length < 3}><Sparkles className="mr-2 size-4"/>{analyzing ? "Preparando propuesta…" : voiceReviewApprovalPhrase(step)}</Button>
            : currentText.trim().length >= 3 && audioStatus === "idle" && <Button type="button" onClick={listenAndReviewTypedAnswer} disabled={redrafting || speaking || analyzing || applying}><Sparkles className="mr-2 size-4"/>{redrafting ? "Redactando…" : "Ordenar con IA y escuchar"}</Button>}
        </div>
        {speaking && <p role="status" className="mt-2 text-xs text-[#615f73]">{speechPurpose === "readback" ? "La aplicación lee la respuesta. Confírmala o corrígela cuando termine." : "La aplicación formula la pregunta; al terminar activa el micrófono."}</p>}
        {audioStatus === "starting" && <p role="status" className="mt-2 text-xs text-[#615f73]">Preparando el micrófono…</p>}
        {audioStatus === "recording" && <p role="status" className="mt-2 text-xs text-[#615f73]">{listeningFor === "answer" ? "Te escucho. Di «terminar», guarda silencio 3 segundos o pulsa «Terminar respuesta»." : "Te escucho. Di la orden; si no detecto el silencio, la procesaré en un máximo de 10 segundos. También puedes pulsar «Terminar orden»."}</p>}
        {audioStatus === "transcribing" && <p role="status" className="mt-2 text-xs text-[#615f73]">Transcribiendo tu respuesta…</p>}
        {answerReady && <section className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3" aria-live="polite">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#473a6d]">Revisado por IA · confirma o corrige</p>
          <h3 className="text-xl font-semibold text-[#3b3355]">¿Es correcta la redacción propuesta?</h3>
          <p className="mt-2 text-lg leading-relaxed text-[#3b3355]">{currentText}</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 px-2" onClick={() => readAnswer(step, currentText)} disabled={speaking || audioStatus !== "idle"}><Volume2 className="mr-2 size-4"/>Repetir respuesta</Button>
          <p className="mt-1 text-xs text-[#615f73]">Di «{voiceReviewApprovalPhrase(step).toLowerCase()}», «rectificar» o «repetir».</p>
          <p className="mt-1 text-xs text-[#615f73]">Puedes corregir el texto antes de confirmar.</p>
        </section>}
        {speechError && <p role="alert" className="mt-2 text-sm text-rose-800">{speechError}</p>}
        {analysisError && <p role="alert" className="mt-2 text-sm text-rose-800">{analysisError}</p>}
        {mode === "plan" && step === "plan" && !proposalReady && looksPerformed(currentText) && <section className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" role="note" data-testid="tooth-performed-hint">
          <p className="font-semibold text-amber-950">Parece que esto ya lo realizaste hoy</p>
          <p className="mt-1 text-sm text-amber-900">Como «plan» quedaría pendiente y el odontograma no cambiaría. Puedes registrarlo como realizado.</p>
          <Button type="button" size="sm" className="mt-2" data-testid="tooth-performed-switch" disabled={redrafting || analyzing || applying || audioStatus !== "idle"} onClick={() => { setMode("done"); setAnalysisError(""); void redraftAnswer("plan", currentText, true); }}>Registrar como realizado</Button>
        </section>}
        {numericReviewDraft && <section className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert" data-testid="tooth-answer-numeric-review">
          <p className="font-semibold text-amber-950">Propuesta de la IA para comparar</p>
          <p className="mt-1 text-base leading-relaxed text-amber-950">{numericReviewDraft}</p>
          <p className="mt-1 text-sm text-amber-900">El texto dictado se conserva arriba. Corrige allí la cifra y vuelve a ordenar la respuesta; no tienes que grabar todo de nuevo.</p>
        </section>}

        {proposalReady && diagnosisPreview && <section className="mt-4 space-y-3 border-t border-[#ebe9f2] pt-4" aria-live="polite">
          <h3 className="text-xl font-semibold text-[#3b3355] sm:text-2xl">Revisa la propuesta para el odontograma</h3>
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
                {diagnosisPreview.changes.map(change => <li key={change.id} className="rounded-lg border border-[#e6e4ee] bg-white p-3 text-lg">
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
            <h3 className="text-xl font-semibold text-[#3b3355] sm:text-2xl">{done ? "Prestaciones realizadas · editables" : "Presupuesto preliminar · editable"}</h3>
            <p className="mt-1 text-base leading-relaxed text-[#615f73]">{done ? "Quedan como realizadas hoy. Si ya estaban pendientes en un presupuesto de esta pieza, se cierran ahí en vez de duplicarse. Los valores quedan por definir hasta que los completes." : "Los valores quedan por definir hasta que los completes. El plan se guardará como borrador para esta pieza."}</p>
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
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-base leading-relaxed text-violet-950 sm:text-lg">
            <p className="font-semibold">Resumen para FDI {formatFdi(tooth)} · Chile {fdiToChile(tooth)}</p>
            <p className="mt-1"><strong>Diagnóstico / hipótesis:</strong> {diagnosisText.trim()}</p>
            <p className="mt-1"><strong>Plan de tratamiento:</strong> {planText.trim()}</p>
            <p className="mt-1"><strong>Prestaciones del presupuesto preliminar:</strong> {planItems.map(item => `${item.label || "prestación sin nombre"}${item.amount > 0 ? ` · ${item.amount.toLocaleString("es-CL")} CLP` : " · valor por definir"}`).join("; ")}</p>
            <p className="mt-2">Para confirmar por voz, di «correcto». También puedes decir «rectificar» o «repetir».</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#ebe9f2] pt-3">
            <Button type="button" variant="outline" onClick={() => { setProposalReady(false); askStep("diagnosis"); }} disabled={applying}>Volver a responder el diagnóstico</Button>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={applying}>Cancelar</Button>
            <Button type="button" onClick={() => void applyProposal()} disabled={applying || analyzing || audioStatus !== "idle" || !canContinue || !validPlan || Boolean(planOtherTeeth.length)}>{applying ? "Guardando…" : "Guardar diagnóstico y plan"}</Button>
          </div>
        </section>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
