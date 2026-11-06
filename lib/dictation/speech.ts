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
