"use client";
/**
 * Dicta lo hecho en esta etapa: graba, transcribe y aplica solo una rectificación cognitiva
 * (ortografía y términos dentales reconocidos), sin resumir ni redactar de nuevo lo dicho.
 * El profesional revisa el cambio palabra por palabra (tachado = como se dictó, verde =
 * corregido) y decide si lo agrega a la nota; nada se guarda sin su toque.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { AUDIO_DICTATION_NOTICE, createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { useTextCorrection, WordDiffView } from "@/components/text-correction";

export function StageDictation({ onInsert, disabled }: { onInsert: (text: string) => void; disabled?: boolean }) {
  const engine = useRef(createAudioTranscription());
  const heard = useRef({ text: "", interim: "" });
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const correction = useTextCorrection();
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(engine.current.isSupported()); }, []);

  if (!supported) return null;

  const afterDictation = () => {
    const text = heard.current.text.trim();
    if (text.length >= 3) void correction.correct(text);
  };

  const start = () => {
    setOpen(true);
    setError("");
    setRetryable(false);
    correction.reset();
    heard.current = { text: transcript, interim: "" };
    engine.current.start(transcript, {
      onStatus: (status) => { setTranscribing(status === "transcribing"); setListening(status === "starting" || status === "recording"); },
      onTranscript: (text, spoken) => { heard.current = { text, interim: spoken }; setTranscript(text); setInterim(spoken); },
      onError: (message) => { setError(message); setRetryable(!!engine.current.hasPendingAudio?.()); setListening(false); setInterim(""); },
      onEnd: () => { setListening(false); setInterim(""); afterDictation(); },
    });
  };
  const stop = () => { setTranscribing(true); setListening(false); engine.current.stop(); };

  const insert = () => {
    const text = (correction.result?.text || transcript).trim();
    if (text) onInsert(text);
    setOpen(false);
    setTranscript("");
    setInterim("");
    correction.reset();
  };
  const discard = () => { setOpen(false); setTranscript(""); setInterim(""); setError(""); correction.reset(); };

  return <div className="space-y-2" data-testid="stage-dictation">
    <button type="button" disabled={disabled || transcribing} onClick={listening ? stop : start}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${listening ? "border-[#a43542] bg-[#a43542] text-white" : "border-[#473a6d] bg-white text-[#473a6d] hover:bg-[#f3f1f7]"} disabled:opacity-50`}
      data-testid="stage-dictation-mic">
      {listening ? <><MicOff className="size-4" aria-hidden="true"/>Detener</> : <><Mic className="size-4" aria-hidden="true"/>Dictar esta etapa</>}
    </button>
    {open && <div className="space-y-2 rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-3">
      {listening && <p role="status" className="text-sm font-medium text-[#473a6d]">Escuchando en español de Chile… di todo el procedimiento hecho.</p>}
      <p className="rounded-lg bg-sky-50 p-2 text-xs leading-5 text-sky-950" role="note">{AUDIO_DICTATION_NOTICE}</p>
      {transcribing && <p role="status" aria-live="polite" className="rounded-lg bg-sky-50 p-2 text-sm font-medium text-sky-950">Transcribiendo el audio…</p>}
      {error && <p role="alert" className="text-sm text-[#a43542]">{error}</p>}
      {retryable && <button type="button" className="text-sm font-semibold text-[#473a6d] underline" onClick={() => { setError(""); setRetryable(false); engine.current.retry?.(); }} data-testid="stage-dictation-retry">Reintentar la transcripción</button>}
      {(transcript || interim) && <p className="whitespace-pre-wrap rounded-lg border border-[#d8d5e4] bg-white p-2 text-sm" data-testid="stage-dictation-transcript">{interim ? `${transcript} ${interim}`.trim() : transcript}</p>}
      {correction.correcting && <div role="alert" aria-live="assertive" className="flex items-start gap-3 rounded-lg border-2 border-red-600 bg-red-600 p-3 text-white shadow-md" data-testid="stage-dictation-correcting">
        <span className="mt-0.5 size-5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" aria-hidden="true"/>
        <div><p className="font-bold uppercase tracking-wide">La IA está rectificando</p><p className="mt-0.5 text-sm">Corrige ortografía y términos dentales, sin resumir ni redactar de nuevo. Revisa antes de agregarlo.</p></div>
      </div>}
      {correction.error && <p role="alert" className="text-sm text-[#a43542]">{correction.error}</p>}
      {correction.result && !correction.correcting && <WordDiffView before={correction.result.source} after={correction.result.text} testId="stage-dictation-diff"/>}
      {!listening && !transcribing && transcript.trim().length >= 3 && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className="min-h-11 flex-1 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" onClick={insert} data-testid="stage-dictation-insert">Agregar a la nota</button>
        <button type="button" className="min-h-11 rounded-xl border border-[#473a6d] px-4 text-sm font-semibold text-[#473a6d]" onClick={discard} data-testid="stage-dictation-discard">Descartar</button>
      </div>}
    </div>}
  </div>;
}
