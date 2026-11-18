export const TOOTH_ANSWER_SILENCE_MS = 3_000;
export const VOICE_ACTIVITY_THRESHOLD = 0.018;

export type VoiceSilenceState = { lastVoiceAt: number | null };

/** Hysteresis-free voice activity gate; silence only ends a response after speech was heard. */
export function updateVoiceSilence(state: VoiceSilenceState, rms: number, now: number, silenceMs = TOOTH_ANSWER_SILENCE_MS, threshold = VOICE_ACTIVITY_THRESHOLD): { state: VoiceSilenceState; shouldStop: boolean } {
  if (rms >= threshold) return { state: { lastVoiceAt: now }, shouldStop: false };
  return { state, shouldStop: state.lastVoiceAt !== null && now - state.lastVoiceAt >= silenceMs };
}

/** Removes only the spoken end command, never a similar word earlier in the answer. */
export function stripFinishCommand(text: string): string {
  return text.replace(/(?:\s*[,;:.!?]\s*|\s+|^)(?:terminar|termine|terminé|termino)\s*[.!?]*$/iu, "").trim();
}

export function voiceAnswerReadback(step: "diagnosis" | "plan", answer: string): string {
  const label = step === "diagnosis" ? "esta hipótesis diagnóstica" : "este plan de tratamiento";
  return `Entendí ${label}: ${answer.trim()}`;
}
