"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFdi } from "@/app/clinical-data";
import { pickLatinVoice } from "@/lib/dictation/speech";
import { guideFace, guideHear, guideStart, innerFace, type GuideState, type GuideStep } from "@/lib/dictation/perio-guide";
import type { PerioDictationResult } from "@/lib/dictation/perio-dictation";

type Recognizer = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
const recognizerClass = () => { const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const STEP_LABEL: Record<GuideStep, (tooth: number) => string> = {
  depthV: () => "Sondaje vestibular", depthL: tooth => `Sondaje ${innerFace(tooth)}`,
  marginV: () => "Margen gingival vestibular", marginL: tooth => `Margen gingival ${innerFace(tooth)}`, flags: () => "Sangrado y supuración",
};

/**
 * Dictado guiado del periodontograma: la aplicación anuncia la pieza y el paso en voz alta, escucha la respuesta
 * y avanza sola. Solo llena el examen en curso; no escribe en la evolución ni guarda.
 */
export function PerioGuide({ statuses, clinicianName, startTooth, onApply, onFocus, onAbsent, onMarkAbsent }: {
  statuses: Record<number, string>; clinicianName?: string; startTooth?: number;
  onApply: (result: PerioDictationResult) => void;
  onFocus: (tooth: number, face: "vestibular" | "lingual") => void;
  onAbsent: (tooth: number) => void;
  onMarkAbsent?: (tooth: number) => Promise<void>;
}) {
  const [state, setState] = useState<GuideState | null>(null);
  const [said, setSaid] = useState("");
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState<number[]>([]);
  const stateRef = useRef<GuideState | null>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const speaking = useRef(false);
  const active = useRef(false);
  const firstName = (clinicianName ?? "").replace(/^(dr|dra|doctor|doctora)\.?\s+/i, "").trim().split(/\s+/)[0] ?? "";

  const listen = useCallback(() => {
    if (!active.current || speaking.current) return;
    try { recognizer.current?.start(); setListening(true); } catch { /* ya estaba escuchando */ }
  }, []);
  const speak = useCallback((text: string, then: () => void) => {
    setSaid(text);
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) { then(); return; }
    speaking.current = true;
    try { recognizer.current?.abort(); } catch { /* sin sesión de escucha */ }
    setListening(false);
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickLatinVoice(synth.getVoices());
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = "es-MX";
    utterance.rate = 1.08;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; speaking.current = false; then(); };
    utterance.onend = finish; utterance.onerror = finish;
    synth.speak(utterance);
    // Si el navegador no avisa el fin de la voz, se retoma la escucha igual.
    setTimeout(finish, 1500 + text.length * 90);
  }, []);

  const hear = useCallback((utterance: string) => {
    const current = stateRef.current;
    if (!current || current.done) return;
    setHeard(utterance);
    const out = guideHear(current, utterance, firstName);
    stateRef.current = out.state; setState(out.state);
    if (out.markedAbsent) onAbsent(out.markedAbsent);
    if (out.apply) onApply({ teeth: [out.apply], ignored: [] });
    if (!out.state.done) onFocus(out.state.order[out.state.index], guideFace(out.state.step));
    if (out.state.done) { active.current = false; try { recognizer.current?.abort(); } catch { /* nada que detener */ } setListening(false); }
    if (out.say) speak(out.say, listen); else listen();
  }, [firstName, listen, onAbsent, onApply, onFocus, speak]);
  const hearRef = useRef(hear);
  useEffect(() => { hearRef.current = hear; }, [hear]);

  const stopAll = useCallback(() => {
    active.current = false;
    try { recognizer.current?.abort(); } catch { /* nada que detener */ }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speaking.current = false; setListening(false);
  }, []);
  useEffect(() => stopAll, [stopAll]);

  const start = () => {
    setError(""); setHeard(""); setSaved([]);
    const Recognition = recognizerClass();
    if (Recognition) {
      const instance = new Recognition();
      instance.lang = "es-CL"; instance.continuous = true; instance.interimResults = false;
      instance.onresult = event => { for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal && !speaking.current) hearRef.current(event.results[i][0].transcript); };
      instance.onend = () => { setListening(false); if (active.current && !speaking.current) setTimeout(() => { if (active.current && !speaking.current) { try { instance.start(); setListening(true); } catch { /* ya escucha */ } } }, 150); };
      instance.onerror = event => { if (event.error === "not-allowed" || event.error === "service-not-allowed") { setError("El navegador no autorizó el micrófono. Puedes escribir las respuestas abajo."); active.current = false; } };
      recognizer.current = instance;
    } else setError("Este navegador no reconoce voz en vivo (funciona en Chrome). Puedes escribir las respuestas abajo o usar el dictado libre.");
    const begin = guideStart(statuses, firstName, startTooth);
    stateRef.current = begin.state; setState(begin.state);
    active.current = !begin.state.done && Boolean(Recognition);
    if (!begin.state.done) onFocus(begin.state.order[begin.state.index], "vestibular");
    speak(begin.say, listen);
  };
  const close = () => { stopAll(); stateRef.current = null; setState(null); setSaid(""); setHeard(""); };

  if (!state) return <div className="mb-2 flex flex-wrap items-center gap-2">
    <Button type="button" onClick={start} className="bg-[#473a6d] hover:bg-[#3a2f5a]"><Mic className="size-4" /> Dictar periodontograma</Button>
    <span className="text-xs text-[#615f73]">Guiado: la aplicación dice la pieza y el paso; tú respondes.</span>
  </div>;

  const tooth = state.order[state.index];
  const command = (word: string) => () => hear(word);
  return <div className="mb-3 rounded-lg border-2 border-[#473a6d] bg-white p-3" aria-live="polite">
    {state.done ? <div className="space-y-2">
      <p className="text-sm font-semibold text-[#2a2540]">Dictado guiado terminado</p>
      <p className="text-xs text-[#615f73]">Las medidas quedaron en el examen en curso. Revisa la arcada y pulsa «Guardar examen periodontal».</p>
      {state.absent.length > 0 && <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">
        <p>Marcaste como ausentes: {state.absent.map(formatFdi).join(", ")}. En el odontograma siguen como estaban.</p>
        {onMarkAbsent && <div className="mt-1.5 flex flex-wrap gap-1.5">{state.absent.map(item => <Button key={item} type="button" size="sm" variant="outline" disabled={saved.includes(item)} onClick={async () => { try { await onMarkAbsent(item); setSaved(old => [...old, item]); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo registrar la ausencia."); } }}>{saved.includes(item) ? `${formatFdi(item)} registrada` : `Registrar ${formatFdi(item)} ausente en el odontograma`}</Button>)}</div>}
      </div>}
      {error && <p role="alert" className="rounded-md bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
      <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
    </div> : <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-bold leading-none text-[#2a2540]">Pieza {formatFdi(tooth)} <span className="text-xs font-medium text-[#615f73]">{state.index + 1} de {state.order.length}</span></p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.paused ? "bg-amber-100 text-amber-900" : listening ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{state.paused ? "En pausa" : listening ? "Escuchando" : "Hablando…"}</span>
      </div>
      <p className="text-sm font-semibold text-[#473a6d]">{STEP_LABEL[state.step](tooth)}{state.step !== "flags" && <span className="font-normal text-[#615f73]"> · mesial, central, distal{state.buffer.length ? ` · llevas ${state.buffer.join(", ")}` : ""}</span>}</p>
      {said && <p className="rounded-md bg-[#f7f6fa] p-2 text-xs text-[#3b3355]"><strong>Aplicación:</strong> {said}</p>}
      {heard && <p className="text-xs text-[#615f73]"><strong>Escuché:</strong> {heard}</p>}
      {error && <p role="alert" className="rounded-md bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
      <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); if (typed.trim()) { hear(typed); setTyped(""); } }}>
        <input value={typed} onChange={event => setTyped(event.target.value)} aria-label="Respuesta escrita" placeholder="O escribe la respuesta: 3 2 4" className="h-8 min-w-0 flex-1 rounded-md border border-[#dddbe6] px-2 text-sm" />
        <Button type="submit" size="sm" variant="outline">Enviar</Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={command("repetir")}>Repetir</Button>
        <Button type="button" size="sm" variant="outline" onClick={command("atrás")}>Atrás</Button>
        <Button type="button" size="sm" variant="outline" onClick={command("saltar")}>Saltar pieza</Button>
        <Button type="button" size="sm" variant="outline" onClick={command("ausente")}>Ausente</Button>
        <Button type="button" size="sm" variant="outline" onClick={command(state.paused ? "continuar" : "pausa")}>{state.paused ? <><Play className="size-3.5" /> Continuar</> : <><Pause className="size-3.5" /> Pausa</>}</Button>
        <Button type="button" size="sm" onClick={command("terminar")} className="bg-rose-700 hover:bg-rose-800"><Square className="size-3.5" /> Terminar</Button>
      </div>
      <p className="text-[11px] leading-4 text-[#615f73]">Órdenes de voz: «repetir», «atrás», «saltar», «ausente», «pausa», «terminar». En sangrado: «nada», «sangrado mesial vestibular», «supuración distal {innerFace(tooth)}», «siguiente».</p>
    </div>}
  </div>;
}
