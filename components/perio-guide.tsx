"use client";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFdi } from "@/app/clinical-data";
import { pickLatinVoice } from "@/lib/dictation/speech";
import { guideAuthorize, guideFace, guideHear, guideSite, guideStart, siteName, type GuideOutcome, type GuideRecord, type GuideState } from "@/lib/dictation/perio-guide";
import type { GuideLive } from "@/components/perio-live-readout";

const SITE_KEYS = ["MV", "V", "DV", "ML", "L", "DL"] as const;
const MUTE_KEY = "perio-voz-silencio";
/** iPhone/iPad: no se graba en paralelo al reconocimiento de Safari (puede cortar la escucha o bajar el volumen de la voz). */
const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
import type { PerioDictationResult } from "@/lib/dictation/perio-dictation";

type Recognizer = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
const recognizerClass = () => { const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
export type PerioGuideHandle = { /** Empieza de inmediato el dictado de una sola pieza (desde la ventana de la pieza). */ startOnly(tooth: number): void; /** Clic en una pieza de la arcada: devuelve true si la guía está activa y se hizo cargo. */ authorize(tooth: number): boolean; /** Hay un dictado guiado en curso. */ active(): boolean };
const stepLabel = (state: GuideState, tooth: number) => state.step === "await" ? "Esperando tu autorización" : state.step === "flags" ? "Sangrado y supuración" : `${siteName(tooth, state.pos)} · ${state.pos % 2 ? "margen gingival" : "sondaje"}`;

/**
 * Dictado guiado del periodontograma: la aplicación anuncia la pieza y el paso en voz alta, escucha la respuesta
 * y avanza sola. Solo llena el examen en curso; no escribe en la evolución ni guarda.
 */
export function PerioGuide({ ref, statuses, clinicianName, selectedTooth, onApply, onFocus, onAbsent, onMarkAbsent, onLive }: {
  ref?: Ref<PerioGuideHandle>;
  statuses: Record<number, string>; clinicianName?: string; /** Pieza marcada en la arcada: se puede dictar solo ella o desde ella en adelante. */ selectedTooth?: number;
  onApply: (result: PerioDictationResult) => void;
  onFocus: (tooth: number, face: "vestibular" | "lingual") => void;
  onAbsent: (tooth: number) => void;
  onMarkAbsent?: (tooth: number) => Promise<void>;
  /** Estado en vivo para la vista ampliada de la pieza (null al cerrar el dictado). */
  onLive?: (live: GuideLive | null) => void;
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
  /** Con ruido o varias voces la escucha queda detenida hasta que el clínico la reanude o escriba el valor. */
  const muted = useRef(false);
  const firstName = (clinicianName ?? "").replace(/^(dr|dra|doctor|doctora)\.?\s+/i, "").trim().split(/\s+/)[0] ?? "";
  // Lo último anotado y el aviso grande, para la vista ampliada.
  const [records, setRecords] = useState<GuideRecord[]>([]);
  const [recordId, setRecordId] = useState(0);
  const [alert, setAlert] = useState("");
  const [voiceOff, setVoiceOff] = useState(() => typeof window !== "undefined" && window.localStorage?.getItem(MUTE_KEY) === "1");
  const voiceOffRef = useRef(voiceOff);
  const [transcribing, setTranscribing] = useState(false);
  // Respaldo con OpenAI: graba en memoria solo mientras se escucha; si el reconocimiento del navegador no da una medida válida, se transcribe ese fragmento y se descarta.
  const clip = useRef<{ stream: MediaStream | null; recorder: MediaRecorder | null; chunks: Blob[]; timer?: ReturnType<typeof setTimeout>; enabled: boolean }>({ stream: null, recorder: null, chunks: [], enabled: false });
  const dropClip = useCallback(() => {
    const c = clip.current;
    if (c.timer) clearTimeout(c.timer);
    if (c.recorder && c.recorder.state !== "inactive") { c.recorder.ondataavailable = null; c.recorder.onstop = null; try { c.recorder.stop(); } catch { /* ya detenido */ } }
    c.recorder = null; c.chunks = [];
  }, []);
  const rotateClip = useRef<() => void>(() => {});
  const startClip = useCallback(() => {
    const c = clip.current;
    dropClip();
    if (!c.enabled || !c.stream) return;
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(c.stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => { if (event.data.size) c.chunks.push(event.data); };
      recorder.start(250);
      c.recorder = recorder;
      // Un fragmento largo de silencio no sirve: se renueva cada 12 s.
      c.timer = setTimeout(() => { if (clip.current.recorder === recorder) rotateClip.current(); }, 12_000);
    } catch { c.enabled = false; }
  }, [dropClip]);
  useEffect(() => { rotateClip.current = startClip; }, [startClip]);
  const takeClip = useCallback(() => new Promise<Blob | null>(resolve => {
    const c = clip.current, recorder = c.recorder;
    if (c.timer) clearTimeout(c.timer);
    if (!recorder || recorder.state === "inactive") { resolve(null); return; }
    recorder.onstop = () => { const blob = c.chunks.length ? new Blob(c.chunks, { type: recorder.mimeType || "audio/webm" }) : null; c.chunks = []; c.recorder = null; resolve(blob && blob.size > 200 ? blob : null); };
    try { recorder.stop(); } catch { resolve(null); }
  }), []);

  const listen = useCallback(() => {
    if (!active.current || speaking.current || muted.current) return;
    try { recognizer.current?.start(); setListening(true); } catch { /* ya estaba escuchando */ }
    if (!clip.current.recorder) startClip();
  }, [startClip]);
  const speak = useCallback((text: string, then: () => void, shown = text) => {
    setSaid(shown);
    const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
    if (voiceOffRef.current || !lines.length || typeof window === "undefined" || !("speechSynthesis" in window)) { then(); return; }
    speaking.current = true;
    // Mientras habla, el micrófono no escucha ni graba: la voz de la aplicación no se anota como respuesta.
    dropClip();
    try { recognizer.current?.abort(); } catch { /* sin sesión de escucha */ }
    setListening(false);
    const synth = window.speechSynthesis;
    synth.cancel();
    const voice = pickLatinVoice(synth.getVoices());
    let finished = false, stopped = false;
    // Pausa breve tras la voz antes de volver a escuchar, para no captar el final de la frase.
    const finish = () => { if (finished) return; finished = true; stopped = true; setTimeout(() => { speaking.current = false; then(); }, 300); };
    // Cada frase se dice por separado, con una pausa: la confirmación del valor no se mezcla con la pregunta siguiente.
    const sayLine = (index: number) => {
      if (stopped) return;
      if (index >= lines.length) { finish(); return; }
      const utterance = new SpeechSynthesisUtterance(lines[index]);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = "es-MX";
      utterance.rate = 1.05;
      let advanced = false;
      const next = () => { if (advanced || stopped) return; advanced = true; setTimeout(() => sayLine(index + 1), index + 1 < lines.length ? 700 : 0); };
      utterance.onend = next; utterance.onerror = next;
      synth.speak(utterance);
      // Si el navegador no avisa el fin de la voz, se sigue igual.
      setTimeout(next, 1500 + lines[index].length * 90);
    };
    sayLine(0);
    setTimeout(finish, lines.length * 800 + 2500 + text.length * 90 + 1500);
  }, [dropClip]);

  const settle = useCallback((out: GuideOutcome) => {
    const prev = stateRef.current;
    // Cada respuesta abre un fragmento de audio nuevo: el respaldo nunca mezcla respuestas anteriores.
    dropClip();
    stateRef.current = out.state; setState(out.state);
    muted.current = out.state.noisy;
    if (out.state.noisy) { try { recognizer.current?.abort(); } catch { /* sin sesión de escucha */ } setListening(false); }
    if (out.markedAbsent) onAbsent(out.markedAbsent);
    if (out.apply) onApply({ teeth: [out.apply], ignored: [] });
    if (!out.state.done) onFocus(out.state.order[out.state.index], guideFace(out.state));
    if (out.state.done) { active.current = false; try { recognizer.current?.abort(); } catch { /* nada que detener */ } setListening(false); }
    if (out.records?.length || out.alert) { setRecords(out.alert ? [] : out.records ?? []); setAlert(out.alert ?? ""); setRecordId(id => id + 1); }
    else if (out.state.index !== prev?.index || out.state.pos !== prev?.pos || out.state.step !== prev?.step) setAlert("");
    if (out.say) speak(out.spoken ?? out.say, listen, out.say); else listen();
  }, [dropClip, listen, onAbsent, onApply, onFocus, speak]);
  const hear = useCallback(async (utterance: string, typed = false) => {
    const current = stateRef.current;
    if (!current || current.done) return;
    setHeard(utterance);
    const out = guideHear(current, utterance, firstName, typed);
    // El navegador no dio una medida válida: se intenta una vez con la transcripción de OpenAI de ese mismo fragmento.
    if (out.miss && !typed && clip.current.enabled && clip.current.recorder) {
      speaking.current = true;
      try { recognizer.current?.abort(); } catch { /* sin sesión */ }
      setListening(false); setTranscribing(true);
      try {
        const audio = await takeClip();
        if (audio) {
          const form = new FormData();
          form.append("audio", audio, `perio.${audio.type.includes("mp4") ? "m4a" : "webm"}`);
          form.append("purpose", "perio");
          const response = await fetch("/api/audio-transcription", { method: "POST", body: form, signal: AbortSignal.timeout(12_000) });
          const data = await response.json().catch(() => ({})) as { text?: string };
          if (response.ok && data.text?.trim() && stateRef.current === current) {
            const second = guideHear(current, data.text, firstName);
            if (!second.miss) { setHeard(`${utterance} → ${data.text}`); speaking.current = false; setTranscribing(false); settle(second); return; }
          }
        }
      } catch { /* sin respaldo: se usa la respuesta del navegador */ }
      speaking.current = false; setTranscribing(false);
      if (stateRef.current !== current) return;
    }
    settle(out);
  }, [firstName, settle, takeClip]);
  const authorize = useCallback((tooth: number) => {
    const current = stateRef.current;
    if (!current || current.done) return false;
    settle(guideAuthorize(current, tooth, firstName));
    return true;
  }, [firstName, settle]);
  const startRef = useRef<(mode: "all" | "from" | "only", pick?: number) => void>(() => {});
  useImperativeHandle(ref, () => ({ startOnly: tooth => { startRef.current("only", tooth); requestAnimationFrame(() => document.querySelector("[data-perio-guide]")?.scrollIntoView({ block: "center", behavior: "smooth" })); }, authorize, active: () => Boolean(stateRef.current && !stateRef.current.done) }), [authorize]);
  const hearRef = useRef(hear);
  useEffect(() => { hearRef.current = hear; }, [hear]);

  const stopAll = useCallback(() => {
    active.current = false;
    try { recognizer.current?.abort(); } catch { /* nada que detener */ }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speaking.current = false; setListening(false);
    dropClip();
    clip.current.stream?.getTracks().forEach(track => track.stop());
    clip.current.stream = null; clip.current.enabled = false;
  }, [dropClip]);
  useEffect(() => stopAll, [stopAll]);
  /** Respaldo de transcripción: solo en escritorio/Android con el servicio configurado; el audio queda en memoria y se descarta. */
  const prepareClip = useCallback(async () => {
    if (isIOS() || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const config = await fetch("/api/audio-transcription", { cache: "no-store" }).then(r => r.json()) as { available?: boolean };
      if (!config.available || !active.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!active.current) { stream.getTracks().forEach(track => track.stop()); return; }
      clip.current.stream = stream; clip.current.enabled = true;
      if (!speaking.current) startClip();
    } catch { clip.current.enabled = false; }
  }, [startClip]);
  const toggleVoice = useCallback(() => {
    const next = !voiceOffRef.current;
    voiceOffRef.current = next; setVoiceOff(next);
    try { window.localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* sin almacenamiento */ }
    if (next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const start = (mode: "all" | "from" | "only" = "all", pick?: number) => {
    stopAll();
    const target = pick ?? selectedTooth;
    setError(""); setHeard(""); setSaved([]); muted.current = false; setRecords([]); setAlert("");
    const Recognition = recognizerClass();
    if (Recognition) {
      const instance = new Recognition();
      instance.lang = "es-CL"; instance.continuous = true; instance.interimResults = false;
      instance.onresult = event => { for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal && !speaking.current) hearRef.current(event.results[i][0].transcript); };
      instance.onend = () => { setListening(false); if (active.current && !speaking.current && !muted.current) setTimeout(() => { if (active.current && !speaking.current && !muted.current) { try { instance.start(); setListening(true); } catch { /* ya escucha */ } } }, 150); };
      instance.onerror = event => { if (event.error === "not-allowed" || event.error === "service-not-allowed") { setError("El navegador no autorizó el micrófono. Puedes escribir las respuestas abajo."); active.current = false; } };
      recognizer.current = instance;
    } else setError("Este navegador no reconoce voz en vivo (funciona en Chrome). Puedes escribir las respuestas abajo o usar el dictado libre.");
    const begin = guideStart(statuses, firstName, mode === "all" ? undefined : target, mode === "only");
    stateRef.current = begin.state; setState(begin.state);
    active.current = !begin.state.done && Boolean(Recognition);
    if (!begin.state.done) onFocus(begin.state.order[begin.state.index], "vestibular");
    speak(begin.say, listen);
    if (active.current) void prepareClip();
  };
  useEffect(() => { startRef.current = start; });
  const close = () => { stopAll(); stateRef.current = null; setState(null); setSaid(""); setHeard(""); };

  // Vista ampliada en vivo: pieza, cara, sitio y lo recién anotado.
  const controlsRef = useRef<GuideLive["controls"]>({ authorize: () => {}, command: () => {}, toggleMute: () => {}, stop: () => {} });
  useEffect(() => {
    const current = stateRef.current;
    controlsRef.current = {
      authorize: () => { if (current && !current.done) authorize(current.order[current.index]); },
      command: word => { void hear(word); },
      toggleMute: toggleVoice,
      stop: () => { void hear("terminar"); },
    };
  });
  useEffect(() => {
    if (!onLive) return;
    if (!state || state.done) { onLive(null); return; }
    const tooth = state.order[state.index];
    onLive({
      tooth, face: guideFace(state), step: state.step, done: state.done,
      site: state.step === "site" ? SITE_KEYS[guideSite(state.pos)] : undefined, field: state.step === "site" ? (state.pos % 2 ? "margin" : "depth") : undefined,
      index: state.index, total: state.order.length, records, recordId, alert: alert || undefined,
      listening, paused: state.paused, noisy: state.noisy, muted: voiceOff, transcribing,
      controls: { authorize: () => controlsRef.current.authorize(), command: word => controlsRef.current.command(word), toggleMute: () => controlsRef.current.toggleMute(), stop: () => controlsRef.current.stop() },
    });
  }, [onLive, state, records, recordId, alert, listening, voiceOff, transcribing]);

  const picked = selectedTooth ? formatFdi(selectedTooth) : "";
  if (!state) return <div className="mb-2 space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {selectedTooth && <Button type="button" onClick={() => start("only")} className="bg-[#473a6d] text-white hover:bg-[#3a2f5a]" data-testid="perio-dictate-only"><Mic className="size-4" /> Dictar solo la pieza {picked}</Button>}
      <Button type="button" variant={selectedTooth ? "outline" : "default"} onClick={() => start("all")} className={selectedTooth ? "" : "bg-[#473a6d] text-white hover:bg-[#3a2f5a]"} data-testid="perio-dictate-all"><Mic className="size-4" /> Dictar periodontograma completo</Button>
      {selectedTooth && selectedTooth !== 18 && <Button type="button" variant="outline" onClick={() => start("from")} data-testid="perio-dictate-from">Desde la {picked} en adelante</Button>}
    </div>
    <p className="text-xs text-[#615f73]">Marca una pieza en la arcada para dictar solo esa. El completo parte en la 1.8. En todos los casos la aplicación te pide cada sitio, de mesial a distal.</p>
  </div>;

  const tooth = state.order[state.index];
  const command = (word: string) => () => hear(word);
  return <div data-perio-guide className="mb-3 rounded-lg border-2 border-[#473a6d] bg-white p-3" aria-live="polite">
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
      {state.step === "await" && <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
        <Button type="button" autoFocus onClick={() => authorize(tooth)} className="w-full bg-[#ef895f] text-base font-semibold text-[#2a2540] hover:bg-[#e67a4d]">Autorizar pieza {formatFdi(tooth)}</Button>
        <p className="mt-1 text-[11px] leading-4 text-amber-950">La aplicación no anota nada hasta que autorices. Para dictar otra pieza, haz clic sobre ella en la arcada.</p>
      </div>}
      <p className="text-sm font-semibold text-[#473a6d]">{stepLabel(state, tooth)}{state.step === "site" && <span className="font-normal text-[#615f73]"> · sitio {guideSite(state.pos) + 1} de 6</span>}</p>
      {state.noisy && <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
        <p className="font-semibold">Hay mucho ruido o varias voces: no puedo escuchar bien.</p>
        <p className="mt-0.5">Dejé de escuchar para no anotar datos equivocados. Reintenta cuando el ambiente esté tranquilo, o escribe el valor abajo para completar la pieza {formatFdi(tooth)}.</p>
        <Button type="button" size="sm" className="mt-1.5 bg-[#473a6d] text-white hover:bg-[#3a2f5a]" onClick={command("reintentar")}><Mic className="size-3.5" /> Reintentar escucha</Button>
      </div>}
      {said && <div className="space-y-1 rounded-md bg-[#f7f6fa] p-2 text-xs text-[#3b3355]">{said.split("\n").filter(Boolean).map((line, i, all) => <p key={i} className={i === all.length - 1 && all.length > 1 ? "font-semibold text-[#2a2540]" : ""}>{i === 0 && <strong>Aplicación: </strong>}{line}</p>)}</div>}
      {heard && <p className="text-xs text-[#615f73]"><strong>Escuché:</strong> {heard}</p>}
      {error && <p role="alert" className="rounded-md bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
      <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); if (typed.trim()) { hear(typed, true); setTyped(""); } }}>
        <input value={typed} onChange={event => setTyped(event.target.value)} aria-label="Respuesta escrita" placeholder="O escribe: 3 (o 3 1 = sondaje y margen)" className="h-8 min-w-0 flex-1 rounded-md border border-[#dddbe6] px-2 text-sm" />
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
      <Button type="button" size="sm" variant="outline" onClick={toggleVoice} aria-pressed={voiceOff}>{voiceOff ? "Voz apagada" : "Voz encendida"}</Button>
      <p className="text-[11px] leading-4 text-[#615f73]">Órdenes de voz: «corrige» (rehace el último valor), «repite», «atrás», «salta», «ausente», «pausa», «sigue», «sangra», «supura», «pieza …», «terminar». Responde cada sitio con un número: «3» (el margen puede ser «menos 1»). Al final: «nada», «sangrado mesial vestibular», «siguiente».</p>
    </div>}
  </div>;
}
