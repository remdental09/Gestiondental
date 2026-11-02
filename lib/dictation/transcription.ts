import { DENTAL_SPEECH_HINTS } from "./dental-lexicon.ts";

/**
 * Motor de transcripción del dictado clínico.
 * Este prototipo solo implementa la Web Speech API del navegador (es-CL).
 * Un motor posterior, por ejemplo Whisper en el navegador, puede cumplir
 * la misma interfaz sin cambiar la ficha ni enviar audio a una API de pago.
 */
export type DictationHandlers = {
  onTranscript: (text: string, interim: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

export interface TranscriptionEngine {
  readonly id: string;
  isSupported(): boolean;
  unsupportedMessage(): string;
  start(baseText: string, handlers: DictationHandlers): void;
  stop(): void;
  abort(): void;
}

type SpeechAlternative = { transcript: string; confidence?: number };
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative };
type SpeechPhrase = { phrase: string; boost: number };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  phrases?: SpeechPhrase[];
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const UNSUPPORTED = "Este navegador no ofrece dictado por voz. Se puede dictar en Chrome (computador o Android) y en Safari de iPhone o iPad con Siri y Dictado activados. También puedes usar el micrófono del teclado del teléfono o pegar el texto para preparar la propuesta. Este prototipo no envía el audio a un servicio de transcripción de pago.";

/** Reaperturas seguidas sin voz antes de detenerse solo (unos minutos de silencio). */
const MAX_RESTARTS = 20;
// iPadOS se presenta como Mac: se reconoce por la pantalla táctil.
export const IS_IOS = typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const IOS = IS_IOS;
const IOS_BLOCKED = "iPhone bloqueó el reconocimiento. Activa Siri y Dictado en Ajustes > General > Teclado y permite el micrófono para Safari en Ajustes > Safari > Micrófono. También puedes usar el micrófono del teclado y pegar el texto.";

/** Aviso que se muestra antes de dictar en iPhone. */
export const IOS_DICTATION_HINT = IOS
  ? "En iPhone el dictado usa el reconocimiento de Siri: Siri y Dictado deben estar activados. Si se corta tras un silencio, se reanuda solo hasta que pulses «Detener»."
  : "";

export function createWebSpeechTranscription(lang = "es-CL"): TranscriptionEngine {
  let active: SpeechRecognizer | null = null;
  let stopped = true;

  const recognition = () => {
    if (typeof window === "undefined") return null;
    const browser = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
      SpeechRecognitionPhrase?: new (phrase: string, boost: number) => SpeechPhrase;
    };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
  };

  const phraseFor = (result: SpeechResult): string => {
    const count = Math.max(1, Math.min(result.length || 1, 5));
    const alternatives = Array.from({ length: count }, (_, index) => result[index]).filter(Boolean);
    const foldSpeech = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const score = (alternative: SpeechAlternative) => {
      const transcript = foldSpeech(alternative.transcript);
      const matched = DENTAL_SPEECH_HINTS.filter((hint) => transcript.includes(foldSpeech(hint.phrase))).length;
      return (alternative.confidence ?? 0) + Math.min(0.6, matched * 0.16);
    };
    return alternatives.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best, alternatives[0])?.transcript ?? "";
  };

  return {
    id: "web-speech",
    isSupported: () => recognition() !== null,
    unsupportedMessage: () => UNSUPPORTED,
    start(baseText, handlers) {
      const Recognition = recognition();
      if (!Recognition) {
        handlers.onError(UNSUPPORTED);
        handlers.onEnd();
        return;
      }
      active?.abort();
      stopped = false;
      let committed = baseText.trim();
      let restarts = 0;
      // Safari en iPhone a veces termina sin marcar como final la última frase: se conserva lo último oído.
      let pending = "";
      const keepPending = () => {
        if (pending) committed = [committed, pending].filter(Boolean).join(" ");
        pending = "";
      };
      const finish = () => {
        active = null;
        keepPending();
        handlers.onTranscript(committed, "");
        handlers.onEnd();
      };
      // Safari en iPhone corta el reconocimiento tras un silencio aunque sea continuo.
      // Mientras no se pulse «Detener», se vuelve a abrir y se conserva lo dictado.
      const launch = () => {
        const recognizer = new Recognition();
        active = recognizer;
        recognizer.lang = lang;
        recognizer.continuous = true;
        recognizer.interimResults = true;
        recognizer.maxAlternatives = 4;
        const browser = window as typeof window & {
          SpeechRecognitionPhrase?: new (phrase: string, boost: number) => SpeechPhrase;
        };
        // Contextual phrase boosts are experimental and not available in Safari/older browsers.
        // Keep the ordinary recognition path when the browser does not expose both pieces.
        if ("phrases" in recognizer && browser.SpeechRecognitionPhrase) {
          try {
            recognizer.phrases = DENTAL_SPEECH_HINTS.map(({ phrase, boost }) => new browser.SpeechRecognitionPhrase!(phrase, boost));
          } catch {
            recognizer.phrases = [];
          }
        }
        recognizer.onresult = (event) => {
          if (active !== recognizer) return;
          restarts = 0;
          let finalText = "";
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const piece = phraseFor(event.results[index]);
            if (event.results[index].isFinal) finalText += piece;
            else interim += piece;
          }
          if (finalText.trim()) committed = [committed, finalText.trim()].filter(Boolean).join(" ");
          pending = interim.trim();
          handlers.onTranscript(committed, pending);
        };
        recognizer.onerror = (event) => {
          if (active !== recognizer) return;
          if (!stopped && (event.error === "no-speech" || event.error === "aborted" || event.error === "network") && restarts < MAX_RESTARTS) return; // onend reabre
          active = null;
          stopped = true;
          keepPending();
          if (committed) handlers.onTranscript(committed, "");
          handlers.onError(event.error === "not-allowed" || event.error === "service-not-allowed"
            ? IOS ? IOS_BLOCKED : "El navegador bloqueó el micrófono o el reconocimiento. Revisa el permiso del micrófono para este sitio o escribe el texto."
            : event.error === "audio-capture"
              ? "No se pudo usar el micrófono: puede estar ocupado por otra app o llamada. Ciérrala e intenta de nuevo, o escribe el texto."
            : event.error === "no-speech"
              ? "No se detectó voz. Puedes intentar de nuevo o escribir el texto."
              : "No se pudo continuar el dictado. Revisa el micrófono o escribe el texto.");
          handlers.onEnd();
        };
        recognizer.onend = () => {
          if (active !== recognizer) return;
          if (!stopped && restarts < MAX_RESTARTS) {
            restarts += 1;
            keepPending();
            handlers.onTranscript(committed, "");
            try {
              launch();
              return;
            } catch {
              // cae a terminar
            }
          }
          finish();
        };
        recognizer.start();
      };
      try {
        launch();
      } catch {
        active = null;
        handlers.onError(IOS ? IOS_BLOCKED : "No se pudo iniciar el dictado. Revisa el permiso del micrófono para este sitio o escribe el texto.");
        handlers.onEnd();
      }
    },
    stop() {
      stopped = true;
      const recognizer = active;
      if (!recognizer) return;
      recognizer.stop();
    },
    abort() {
      stopped = true;
      const recognizer = active;
      active = null;
      recognizer?.abort();
    },
  };
}

export const MIC_DENIED = "El navegador no autorizó el micrófono. En iPhone: Ajustes > Safari > Micrófono (o Ajustes > Chrome). En computador: el ícono del candado junto a la dirección. Puedes escribir o pegar el texto igual.";

/** Pide el micrófono antes de dictar (en iPhone lo pide Safari al empezar el reconocimiento). */
export async function micAllowed(): Promise<boolean> {
  if (IS_IOS || !navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}
