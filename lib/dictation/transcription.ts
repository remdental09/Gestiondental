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
  stop: () => void;
  abort: () => void;
};

const UNSUPPORTED = "Este navegador no ofrece dictado por voz. En Chrome de escritorio se puede dictar en español de Chile. Escribe o pega el texto para preparar la propuesta. Este prototipo no envía el audio a un servicio de transcripción de pago.";

export function createWebSpeechTranscription(lang = "es-CL"): TranscriptionEngine {
  let active: SpeechRecognizer | null = null;

  const recognition = () => {
    if (typeof window === "undefined") return null;
    const browser = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
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
      let committed = baseText.trim();
      try {
        const recognizer = new Recognition();
        active = recognizer;
        recognizer.lang = lang;
        recognizer.continuous = true;
        recognizer.interimResults = true;
        recognizer.onresult = (event) => {
          if (active !== recognizer) return;
          let finalText = "";
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const piece = event.results[index][0].transcript;
            if (event.results[index].isFinal) finalText += piece;
            else interim += piece;
          }
          if (finalText.trim()) committed = [committed, finalText.trim()].filter(Boolean).join(" ");
          handlers.onTranscript(committed, interim.trim());
        };
        recognizer.onerror = (event) => {
          if (active !== recognizer) return;
          active = null;
          handlers.onError(event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "El navegador bloqueó el micrófono o el reconocimiento. Revisa el permiso en Chrome o escribe el texto."
            : event.error === "no-speech"
              ? "No se detectó voz. Puedes intentar de nuevo o escribir el texto."
              : "No se pudo continuar el dictado. Revisa el micrófono o escribe el texto.");
          handlers.onEnd();
        };
        recognizer.onend = () => {
          if (active !== recognizer) return;
          active = null;
          handlers.onTranscript(committed, "");
          handlers.onEnd();
        };
        recognizer.start();
      } catch {
        active = null;
        handlers.onError("No se pudo iniciar el dictado. Revisa el permiso del micrófono en Chrome o escribe el texto.");
        handlers.onEnd();
      }
    },
    stop() {
      const recognizer = active;
      if (!recognizer) return;
      recognizer.stop();
    },
    abort() {
      const recognizer = active;
      active = null;
      recognizer?.abort();
    },
  };
}
