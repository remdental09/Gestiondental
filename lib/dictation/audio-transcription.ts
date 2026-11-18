import type { DictationHandlers, TranscriptionEngine } from "./transcription.ts";
import { TOOTH_ANSWER_SILENCE_MS, updateVoiceSilence, VOICE_ACTIVITY_THRESHOLD } from "./voice-answer.ts";

type Session = {
  handlers: DictationHandlers; base: string; purpose?: "tooth_command"; cancelled: boolean; stream?: MediaStream;
  recorder?: MediaRecorder; chunks: Blob[]; bytes: number; audio?: Blob;
  controller: AbortController; timer?: ReturnType<typeof setTimeout>; silenceTimer?: ReturnType<typeof setTimeout>;
  audioContext?: AudioContext; startedAt: number; uploading?: boolean; captureFailed?: boolean;
};
const LIMIT = 10 * 1024 * 1024;
export const MAX_DICTATION_MS = 4 * 60 * 1000;
const MAX_MS = MAX_DICTATION_MS;
export const AUDIO_DICTATION_NOTICE = "El micrófono graba tu dictado y, al detenerlo, envía el audio a OpenAI para transcribirlo con vocabulario odontológico. Después la IA prepara la propuesta clínica. Máximo 4 minutos por grabación; si falta algo, pulsa «Añadir al dictado» y sigue. Revisa piezas, dosis y montos antes de aceptar. El audio permanece temporalmente en memoria para reintentar; esta aplicación no lo guarda en la ficha ni en Drive.";

/** MediaRecorder en Chrome/Safari; conserva cada grabación solo en memoria hasta terminar o descartar. */
export function createAudioTranscription(): TranscriptionEngine {
  let current: Session | null = null;
  let configurationAvailable = false;
  const valid = (session: Session) => current === session && !session.cancelled;
  const cleanCapture = (session: Session) => {
    if (session.timer) clearTimeout(session.timer);
    if (session.silenceTimer) clearTimeout(session.silenceTimer);
    const context = session.audioContext;
    session.audioContext = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    session.stream?.getTracks().forEach((track) => track.stop());
  };
  const monitorSilence = (session: Session, stream: MediaStream, recorder: MediaRecorder, silenceMs: number) => {
    if (silenceMs <= 0) return;
    try {
      const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = typeof AudioContext !== "undefined" ? AudioContext : browserWindow.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      session.audioContext = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      if (context.state === "suspended") void context.resume().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      let state = { lastVoiceAt: null as number | null };
      const check = () => {
        if (!valid(session) || recorder.state === "inactive") return;
        try {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const rms = Math.sqrt(sum / samples.length);
          const update = updateVoiceSilence(state, rms, Date.now(), silenceMs, VOICE_ACTIVITY_THRESHOLD);
          state = update.state;
          if (update.shouldStop) {
            recorder.stop();
            return;
          }
        } catch {
          return; // Auto-stop is optional; «Terminar respuesta» remains available.
        }
        session.silenceTimer = setTimeout(check, 150);
      };
      session.silenceTimer = setTimeout(check, 150);
    } catch {
      // Some mobile browsers cannot create an analyser for a microphone stream.
      // Recording still works and can be ended with the visible button.
    }
  };
  const fail = (session: Session, cause: unknown) => {
    if (!valid(session)) return;
    cleanCapture(session);
    session.handlers.onStatus?.("error");
    session.handlers.onError(cause instanceof Error ? cause.message : "No se pudo transcribir el audio.");
  };
  const upload = async (session: Session) => {
    if (!valid(session) || !session.audio || session.uploading) return;
    session.uploading = true;
    session.controller = new AbortController();
    session.handlers.onStatus?.("transcribing");
    try {
      const form = new FormData();
      const extension = session.audio.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", session.audio, `dictado.${extension}`);
      if (session.purpose) form.append("purpose", session.purpose);
      const response = await fetch("/api/audio-transcription", { method: "POST", body: form, signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(100_000)]) });
      const data = await response.json() as { text?: string; error?: string };
      if (!response.ok || typeof data.text !== "string" || !data.text.trim()) throw new Error(data.error || "No se recibió la transcripción. Reintenta el audio.");
      if (!valid(session)) return;
      const text = [session.base, data.text.trim()].filter(Boolean).join(" ");
      if (text.length > 8_000) throw new Error("El texto acumulado supera 8.000 caracteres. Conserva el dictado anterior y procesa esta grabación por separado.");
      session.audio = undefined;
      session.handlers.onTranscript(text, "");
      session.handlers.onStatus?.("idle");
      session.handlers.onEnd();
    } catch (cause) { session.uploading = false; fail(session, cause); }
    finally { session.uploading = false; }
  };
  const abort = () => {
    const session = current;
    current = null;
    if (!session) return;
    session.cancelled = true;
    session.controller.abort();
    if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
    cleanCapture(session);
    session.audio = undefined;
    session.chunks = [];
  };
  return {
    id: "openai-audio",
    isSupported: () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    unsupportedMessage: () => "Este navegador no permite grabar audio. Abre la aplicación en Safari o Chrome actualizado, o escribe el texto.",
    start(base, handlers, options = {}) {
      abort();
      const session: Session = { handlers, base: base.trim(), purpose: options.purpose, cancelled: false, chunks: [], bytes: 0, controller: new AbortController(), startedAt: 0 };
      current = session;
      handlers.onStatus?.("starting");
      void (async () => {
        try {
          if (!configurationAvailable) {
            const response = await fetch("/api/audio-transcription", { cache: "no-store", signal: session.controller.signal });
            const config = await response.json() as { available?: boolean; error?: string };
            if (!response.ok || !config.available) throw new Error(config.error || "Falta configurar OPENAI_API_KEY en Cloudflare para activar la transcripción de audio.");
            configurationAvailable = true;
          }
          if (!valid(session)) return;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          if (!valid(session)) { stream.getTracks().forEach((track) => track.stop()); return; }
          session.stream = stream;
          const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
          const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 });
          session.recorder = recorder;
          recorder.ondataavailable = (event) => {
            if (!valid(session) || !event.data.size) return;
            session.bytes += event.data.size;
            session.chunks.push(event.data);
            if (session.bytes > LIMIT && recorder.state !== "inactive") recorder.stop();
          };
          recorder.onerror = () => { session.captureFailed = true; if (recorder.state !== "inactive") recorder.stop(); fail(session, new Error("Se interrumpió la grabación. Vuelve a dictar.")); };
          recorder.onstop = () => {
            cleanCapture(session);
            if (!valid(session) || session.captureFailed) return;
            session.audio = new Blob(session.chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
            session.chunks = [];
            if (session.bytes > LIMIT || Date.now() - session.startedAt < 300 || session.audio.size < 100) {
              session.audio = undefined;
              fail(session, new Error(session.bytes > LIMIT ? "La grabación supera 10 MB. Dicta en fragmentos más cortos." : "La grabación es demasiado corta. Vuelve a dictar."));
              return;
            }
            void upload(session);
          };
          session.startedAt = Date.now();
          recorder.start(1000);
          session.timer = setTimeout(() => { if (valid(session) && recorder.state !== "inactive") recorder.stop(); }, MAX_MS);
          const stopOnSilenceMs = Number(options.stopOnSilenceMs);
          monitorSilence(session, stream, recorder, Number.isFinite(stopOnSilenceMs) && stopOnSilenceMs > 0 ? Math.max(500, Math.min(stopOnSilenceMs, TOOTH_ANSWER_SILENCE_MS * 3)) : 0);
          handlers.onStatus?.("recording");
        } catch (cause) {
          const message = cause instanceof Error && (cause.name === "NotAllowedError" || cause.name === "SecurityError") ? new Error("Permite el micrófono para esta aplicación en Safari o Chrome y vuelve a intentar.") : cause;
          fail(session, message);
        }
      })();
    },
    stop() {
      const session = current;
      if (!session) return;
      if (!session.recorder) { abort(); session.handlers.onStatus?.("idle"); return; }
      if (session.recorder.state !== "inactive") session.recorder.stop();
    },
    abort,
    hasPendingAudio: () => !!current?.audio && !current.uploading,
    retry() { if (current?.audio) void upload(current); },
  };
}
