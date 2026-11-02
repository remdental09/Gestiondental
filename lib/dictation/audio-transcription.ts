import type { DictationHandlers, TranscriptionEngine } from "./transcription.ts";

type Session = {
  handlers: DictationHandlers; base: string; cancelled: boolean; stream?: MediaStream;
  recorder?: MediaRecorder; chunks: Blob[]; bytes: number; audio?: Blob;
  controller: AbortController; timer?: ReturnType<typeof setTimeout>; startedAt: number; uploading?: boolean; captureFailed?: boolean;
};
const LIMIT = 10 * 1024 * 1024;
const MAX_MS = 5 * 60 * 1000;
export const AUDIO_DICTATION_NOTICE = "El micrófono graba tu dictado y, al detenerlo, envía el audio a OpenAI para transcribirlo con vocabulario odontológico. Después la IA prepara la propuesta clínica. Máximo 5 minutos por grabación. Revisa piezas, dosis y montos antes de aceptar. El audio permanece temporalmente en memoria para reintentar; esta aplicación no lo guarda en la ficha ni en Drive.";

/** MediaRecorder en Chrome/Safari; conserva cada grabación solo en memoria hasta terminar o descartar. */
export function createAudioTranscription(): TranscriptionEngine {
  let current: Session | null = null;
  const valid = (session: Session) => current === session && !session.cancelled;
  const cleanCapture = (session: Session) => {
    if (session.timer) clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
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
    start(base, handlers) {
      abort();
      const session: Session = { handlers, base: base.trim(), cancelled: false, chunks: [], bytes: 0, controller: new AbortController(), startedAt: 0 };
      current = session;
      handlers.onStatus?.("starting");
      void (async () => {
        try {
          const response = await fetch("/api/audio-transcription", { cache: "no-store", signal: session.controller.signal });
          const config = await response.json() as { available?: boolean; error?: string };
          if (!response.ok || !config.available) throw new Error(config.error || "Falta configurar OPENAI_API_KEY en Cloudflare para activar la transcripción de audio.");
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
