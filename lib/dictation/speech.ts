// Voz de los avisos: español latinoamericano (nunca la voz de España por defecto) y desbloqueo en móvil.

const LATAM = ["es-cl", "es-419", "es-mx", "es-us", "es-ar", "es-co", "es-pe", "es-uy", "es-ve", "es-ec", "es-bo", "es-py", "es-cr", "es-pa", "es-gt", "es-hn", "es-ni", "es-sv", "es-do", "es-pr", "es-cu"];

type VoiceLike = { lang: string; name?: string; default?: boolean };

/** Elige la mejor voz en español de América; null si el dispositivo solo tiene voces de España u otras. */
export function pickLatinVoice<T extends VoiceLike>(voices: T[]): T | null {
  const norm = (voice: T) => voice.lang.toLowerCase().replace("_", "-");
  for (const code of LATAM) {
    const match = voices.find((voice) => norm(voice) === code);
    if (match) return match;
  }
  return voices.find((voice) => norm(voice).startsWith("es") && norm(voice) !== "es-es") ?? null;
}

let unlocked = false;

/** Los móviles solo dejan hablar a una página después de un toque: se llama dentro de un clic para «desbloquear». */
export function unlockSpeech(): void {
  if (unlocked || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    unlocked = true;
  } catch { /* sin voz */ }
}

export type SpeechPlaybackHandlers = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  rate?: number;
};

/** Marca el acento de términos dentales únicamente en la lectura hablada. */
export function dentalSpeechText(text: string): string {
  const pronunciation: Record<string, string> = { mesial: "mesiál", distal: "distál", palatino: "palatíno", oclusal: "oclusál", incisal: "incisál" };
  return text.replace(/\b(mesial|distal|palatino|oclusal|incisal)\b/gi, term => {
    const spoken = pronunciation[term.toLowerCase()];
    return term[0] === term[0].toUpperCase() ? spoken[0].toUpperCase() + spoken.slice(1) : spoken;
  });
}

/** Reproduce una pregunta en la misma interacción del usuario que la solicita. */
export function speakTextNow(text: string, handlers: SpeechPlaybackHandlers = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined" || !text.trim()) return false;
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (handlers.rate) utterance.rate = handlers.rate;
    const voice = pickLatinVoice(synth.getVoices());
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    else utterance.lang = "es-CL";
    utterance.onstart = () => handlers.onStart?.();
    utterance.onend = () => handlers.onEnd?.();
    utterance.onerror = event => handlers.onError?.(event.error);
    synth.speak(utterance);
    if (synth.paused) synth.resume();
    return true;
  } catch {
    return false;
  }
}

/** Lee las frases con voz latinoamericana. Devuelve false si el navegador bloqueó o no puede hablar. */
export function speakPhrases(phrases: string[], onBlocked?: () => void): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !phrases.length) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickLatinVoice(synth.getVoices());
  for (const phrase of phrases) {
    const utterance = new SpeechSynthesisUtterance(phrase);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    else utterance.lang = "es-MX";
    utterance.onerror = (event) => { if (event.error === "not-allowed" && onBlocked) onBlocked(); };
    synth.speak(utterance);
  }
  return true;
}
