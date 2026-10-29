"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type FieldKey = "name" | "birthDate" | "rut" | "reason";
type PatientQuestion = { key: FieldKey; label: string; prompt: string };
type NoteQuestion = { key: string; label: string; prompt: string };
type AssistantQuestion = PatientQuestion | NoteQuestion;
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type Stage = "ready" | "speaking" | "listening" | "paused" | "error" | "complete";

export type PatientDraftField = FieldKey;

const patientQuestions: PatientQuestion[] = [
  { key: "name", label: "Nombre completo", prompt: "Di los dos nombres y los dos apellidos del paciente, en ese orden. Si falta alguno, no continúes con la ficha." },
  { key: "birthDate", label: "Fecha de nacimiento", prompt: "¿Cuál es la fecha de nacimiento? Dila como día, mes y año." },
  { key: "rut", label: "RUN o RUT", prompt: "¿Cuál es el RUN o RUT completo, incluido el dígito verificador?" },
  { key: "reason", label: "Motivo de consulta", prompt: "¿Cuál es el motivo principal de consulta?" },
];

const noteQuestions: NoteQuestion[] = [
  { key: "reason", label: "Motivo de consulta", prompt: "¿Cuál es el motivo de consulta y qué problema refiere el paciente?" },
  { key: "history", label: "Antecedentes médicos", prompt: "¿Qué antecedentes médicos relevantes se deben registrar? Si no hay antecedentes, dilo explícitamente." },
  { key: "medications", label: "Medicamentos y dosis", prompt: "¿Qué medicamentos usa actualmente y en qué dosis? Si no usa, dilo explícitamente." },
  { key: "allergies", label: "Alergias y reacciones", prompt: "¿Tiene alergias conocidas o reacciones a medicamentos? Si no tiene, dilo explícitamente." },
  { key: "findings", label: "Examen y hallazgos", prompt: "¿Qué encontraste en el examen? Indica la pieza y la superficie cuando corresponda." },
  { key: "diagnosis", label: "Diagnóstico", prompt: "¿Qué diagnóstico o impresión clínica registrarás?" },
  { key: "plan", label: "Plan y procedimiento", prompt: "¿Qué plan, procedimiento o tratamiento acordaron?" },
  { key: "followup", label: "Indicaciones y control", prompt: "¿Qué indicaciones, signos de alarma o fecha de control deben quedar registrados?" },
];

function spokenDateToISO(value: string): string | null {
  const text = value.trim().toLocaleLowerCase("es-CL");
  let year = 0, month = 0, day = 0;
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) [, year, month, day] = match.map(Number);
  if (!match) {
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) [, day, month, year] = match.map(Number);
  }
  if (!match) {
    const months: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    const spoken = text.match(/^(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s*(?:de\s*)?(\d{4})$/);
    if (spoken) { day = Number(spoken[1]); month = months[spoken[2]]; year = Number(spoken[3]); }
  }
  if (!year || !month || !day) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizedCommand(value: string) {
  return value.trim().toLocaleLowerCase("es-CL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.!?,;:]/g, "");
}

export function ClinicalVoiceAssistant({
  mode,
  onPatientAnswer,
  onNoteAnswers,
  onBusyChange,
  onClose,
}: {
  mode: "patient" | "note";
  onPatientAnswer: (key: FieldKey, value: string) => void;
  onNoteAnswers: (body: string) => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const questions: AssistantQuestion[] = mode === "patient" ? patientQuestions : noteQuestions;
  const [stage, setStage] = useState<Stage>("ready");
  const [index, setIndex] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [dateNeedsReview, setDateNeedsReview] = useState(false);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const runRef = useRef(0);
  const indexRef = useRef(0);
  const answersRef = useRef<Record<string, string>>({});
  const transcriptRef = useRef("");
  const silenceAttemptsRef = useRef(0);
  const current = questions[index];
  const completed = stage === "complete";

  const setStageNow = (next: Stage) => setStage(next);
  const setTranscriptNow = (next: string) => { transcriptRef.current = next; setTranscript(next); };
  const notifyNoteAnswers = (values: Record<string, string>) => onNoteAnswers(noteQuestions.map((question) => `${question.label}: ${values[question.key]?.trim() || "Pendiente de preguntar/registrar"}`).join("\n"));

  useEffect(() => () => {
    runRef.current += 1;
    recognizerRef.current?.abort();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const applyAnswer = (rawValue: string, questionIndex: number, run: number) => {
    if (run !== runRef.current) return;
    const question = questions[questionIndex];
    if (!question) return;
    const skipped = normalizedCommand(rawValue) === "pasar";
    const value = skipped ? "" : rawValue.trim();
    const nextAnswers = { ...answersRef.current, [question.key]: value };
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);

    if (mode === "patient") {
      const patientQuestion = question as PatientQuestion;
      if (!skipped && patientQuestion.key === "birthDate") {
        const date = spokenDateToISO(value);
        if (date) { onPatientAnswer(patientQuestion.key, date); setDateNeedsReview(false); }
        else setDateNeedsReview(true);
      } else if (!skipped) onPatientAnswer(patientQuestion.key, value);
    } else notifyNoteAnswers(nextAnswers);

    setTranscriptNow("");
    setError("");
    const nextIndex = questionIndex + 1;
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    silenceAttemptsRef.current = 0;
    if (nextIndex >= questions.length) {
      setStageNow("complete");
      onBusyChange(false);
      return;
    }
    onBusyChange(true);
    window.setTimeout(() => { if (run === runRef.current) askAndListen(nextIndex, run); }, 350);
  };

  const startRecognition = (questionIndex: number, run: number) => {
    if (run !== runRef.current) return;
    const browser = window as typeof window & { SpeechRecognition?: new () => SpeechRecognizer; webkitSpeechRecognition?: new () => SpeechRecognizer };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Este navegador no ofrece reconocimiento automático. Puedes responder en el campo y usar “Guardar respuesta”, o abrir la app en Chrome.");
      setStageNow("error");
      onBusyChange(false);
      return;
    }
    try {
      const recognizer = new Recognition();
      recognizerRef.current = recognizer;
      recognizer.lang = "es-CL";
      recognizer.continuous = false;
      recognizer.interimResults = true;
      setTranscriptNow("");
      setStageNow("listening");
      recognizer.onresult = (event) => {
        if (run !== runRef.current || recognizerRef.current !== recognizer) return;
        let text = "";
        for (let i = 0; i < event.results.length; i++) text += `${i ? " " : ""}${event.results[i][0].transcript}`;
        setTranscriptNow(text.trim());
      };
      recognizer.onerror = (event) => {
        if (run !== runRef.current || recognizerRef.current !== recognizer) return;
        recognizerRef.current = null;
        setStageNow("error");
        onBusyChange(false);
        setError(event.error === "not-allowed" || event.error === "service-not-allowed" ? "El navegador bloqueó el micrófono o el servicio de reconocimiento. Revisa los permisos o continúa por escrito." : "No pude reconocer la respuesta. Puedes reintentar o escribirla.");
      };
      recognizer.onend = () => {
        if (run !== runRef.current || recognizerRef.current !== recognizer) return;
        recognizerRef.current = null;
        const spoken = transcriptRef.current.trim();
        if (spoken) {
          applyAnswer(spoken, questionIndex, run);
        } else if (silenceAttemptsRef.current < 1) {
          silenceAttemptsRef.current += 1;
          window.setTimeout(() => { if (run === runRef.current) askAndListen(questionIndex, run); }, 400);
        } else {
          setStageNow("error");
          onBusyChange(false);
          setError("No alcancé a oír una respuesta. Repite la pregunta o responde por escrito.");
        }
      };
      recognizer.start();
    } catch {
      recognizerRef.current = null;
      setStageNow("error");
      onBusyChange(false);
      setError("No se pudo iniciar el reconocimiento. Revisa los permisos del micrófono o responde por escrito.");
    }
  };

  function askAndListen(questionIndex: number, run: number) {
    if (run !== runRef.current) return;
    const question = questions[questionIndex];
    if (!question) { setStageNow("complete"); return; }
    indexRef.current = questionIndex;
    setIndex(questionIndex);
    setTranscriptNow("");
    setStageNow("speaking");
    const speakAndListen = () => {
      if (run !== runRef.current) return;
      if (!("speechSynthesis" in window)) { startRecognition(questionIndex, run); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(question.prompt);
      utterance.lang = "es-CL";
      utterance.onend = () => window.setTimeout(() => startRecognition(questionIndex, run), 350);
      utterance.onerror = () => startRecognition(questionIndex, run);
      window.speechSynthesis.speak(utterance);
    };
    speakAndListen();
  }

  const begin = async () => {
    setError("");
    setDateNeedsReview(false);
    onBusyChange(true);
    const run = ++runRef.current;
    if (mode === "note") {
      answersRef.current = {};
      setAnswers({});
      notifyNoteAnswers({});
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStageNow("error");
      onBusyChange(false);
      setError("Este visor no permite acceder al micrófono. Abre la app en Chrome o completa los campos manualmente.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const intro = "Te haré una pregunta a la vez. Responde después de escucharla. Si quieres dejar un dato pendiente, di pasar.";
      if ("speechSynthesis" in window) {
        setStageNow("speaking");
        const utterance = new SpeechSynthesisUtterance(intro);
        utterance.lang = "es-CL";
        utterance.onend = () => { if (run === runRef.current) askAndListen(0, run); };
        utterance.onerror = () => { if (run === runRef.current) askAndListen(0, run); };
        window.speechSynthesis.speak(utterance);
      } else askAndListen(0, run);
    } catch {
      setStageNow("error");
      onBusyChange(false);
      setError("No pude acceder al micrófono. Permite el uso del micrófono en el navegador y vuelve a comenzar.");
    }
  };

  const stop = () => {
    runRef.current += 1;
    recognizerRef.current?.abort();
    recognizerRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStageNow("paused");
    onBusyChange(false);
    setError("");
    setTranscriptNow("");
  };

  const resume = () => {
    setError("");
    onBusyChange(true);
    const run = ++runRef.current;
    const questionIndex = indexRef.current;
    if (questionIndex >= questions.length) { setStageNow("complete"); return; }
    askAndListen(questionIndex, run);
  };

  const keepManualAnswer = () => {
    if (!transcriptRef.current.trim()) { setError("Escribe una respuesta o di “pasar” para dejarla pendiente."); return; }
    applyAnswer(transcriptRef.current, indexRef.current, runRef.current);
  };

  const manualSkip = () => applyAnswer("pasar", indexRef.current, runRef.current);

  const statusText = stage === "speaking" ? "Hablando la pregunta…" : stage === "listening" ? "Escuchando tu respuesta; al terminar la pausa pasará sola a la siguiente pregunta." : stage === "paused" ? "Asistente detenido." : stage === "complete" ? "Terminamos las preguntas." : stage === "error" ? "El flujo automático se detuvo." : "Pulsa comenzar una vez; luego pregunta y escucha automáticamente.";

  return <section className="rounded-xl border border-[#a9d6d2] bg-[#f2faf9] p-4" aria-label="Asistente de voz">
    <div className="flex items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-sm font-semibold text-[#145b60]"><Volume2 className="size-4"/>Asistente de voz</p><p className="mt-1 text-xs leading-5 text-[#53686e]">Habla después de cada pregunta. El asistente detecta la pausa y continúa; di “pasar” para dejar un dato pendiente.</p></div>
      <button type="button" className="rounded-md p-1 text-[#60757a] hover:bg-white" onClick={onClose} aria-label="Cerrar asistente"><X className="size-4"/></button>
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {stage === "ready" ? <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" onClick={() => void begin()}><Volume2 className="mr-2 size-4"/>Comenzar conversación</Button> :
        stage === "paused" ? <Button type="button" className="bg-[#087f83] hover:bg-[#07676b]" onClick={resume}><Mic className="mr-2 size-4"/>Continuar</Button> :
        stage === "complete" ? <span className="text-sm font-semibold text-[#145b60]">Revisa el formulario y pulsa Guardar cuando esté correcto.</span> :
        stage === "error" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={resume}><Mic className="mr-2 size-4"/>Reintentar</Button><Button type="button" variant="outline" size="sm" onClick={keepManualAnswer}>Guardar respuesta</Button><Button type="button" variant="outline" size="sm" onClick={manualSkip}>Dejar pendiente</Button></div> :
        <Button type="button" variant="outline" size="sm" onClick={stop}><MicOff className="mr-2 size-4"/>Detener</Button>}
      {!completed && current && <span className="text-xs font-semibold text-[#60757a]">Pregunta {index + 1} de {questions.length}: {current.label}</span>}
    </div>

    <p role="status" className="mt-3 text-sm text-[#145b60]">{statusText}</p>
    {current && stage !== "ready" && stage !== "paused" && stage !== "complete" && <p className="mt-2 rounded-lg bg-white p-3 text-sm font-medium leading-6">{current.prompt}</p>}
    {stage === "listening" && <div className="mt-3 min-h-10 rounded-lg border border-[#dce5e7] bg-white px-3 py-2 text-sm text-[#53686e]" aria-live="polite">{transcript || "Te escucho…"}</div>}
    {stage === "error" && <textarea className="mt-3 min-h-20 w-full rounded-lg border border-[#dce5e7] bg-white p-3 text-sm outline-none focus:border-[#087f83] focus:ring-2 focus:ring-[#087f83]/15" aria-label="Respuesta manual" placeholder="Si el reconocimiento no funciona, escribe aquí la respuesta." value={transcript} onChange={(event) => setTranscriptNow(event.target.value)} />}
    {error && <p role="alert" className="mt-2 text-xs leading-5 text-[#a43542]">{error}</p>}
    {completed && mode === "note" && <div className="mt-3 rounded-lg bg-white p-3 text-sm"><p className="font-medium">Pendiente de registrar:</p><ul className="mt-1 list-inside list-disc text-[#53686e]">{noteQuestions.filter((question) => !answers[question.key]?.trim()).map((question) => <li key={question.key}>{question.label}</li>)}</ul>{noteQuestions.every((question) => answers[question.key]?.trim()) && <p className="mt-1 text-[#53686e]">No quedaron preguntas pendientes.</p>}</div>}
    {completed && dateNeedsReview && <p role="alert" className="mt-2 text-sm text-amber-800">La fecha dictada no se pudo convertir; revísala en el campo de fecha del formulario.</p>}
    {completed && <p className="mt-2 text-xs leading-5 text-[#60757a]">Revisa nombres, RUT, fechas, piezas, alergias y dosis. “Pendiente de preguntar/registrar” no significa que el paciente lo niegue.</p>}
    <p className="mt-3 border-t border-[#d8ece9] pt-3 text-[11px] leading-4 text-[#60757a]">El navegador gestiona el reconocimiento y podría usar su servicio de voz. El audio no se incorpora a la ficha; revisa el texto final antes de guardar.</p>
  </section>;
}
