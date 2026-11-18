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
  return text.replace(/(?:\s*[,;:.!?]\s*|\s+|^)(?:terminar|termine|terminé|termino|termina)(?:\s+(?:la\s+)?respuesta)?\s*[.!?]*$/iu, "").trim();
}

export function voiceAnswerReadback(step: "diagnosis" | "plan", answer: string): string {
  const label = step === "diagnosis" ? "esta hipótesis diagnóstica" : "este plan de tratamiento";
  const next = step === "diagnosis" ? "pasar al plan" : "preparar propuesta";
  return `Entendí ${label}: ${answer.trim()} ¿Es correcto? Di correcto, ${next}; rectificar; o repetir.`;
}

export type VoiceReviewCommand = "accept" | "correct" | "repeat" | "save" | "mesial" | "distal" | "both" | "pending" | null;

export function parseVoiceReviewCommand(text: string, stage: "diagnosis" | "plan" | "proposal"): VoiceReviewCommand {
  const normalized = stripFinishCommand(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.,;:!?¿¡]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:repetir|repite|otra vez)(?: la respuesta| el resumen)?$/.test(normalized)) return "repeat";
  if (/^(?:rectificar|corregir|correccion|quiero rectificar|quiero corregir)(?: (?:el |la )?(?:diagnostico|hipotesis|plan))?$/.test(normalized)) return "correct";
  if (stage === "proposal") {
    if (/^(?:mesial|cara mesial)$/.test(normalized)) return "mesial";
    if (/^(?:distal|cara distal)$/.test(normalized)) return "distal";
    if (/^(?:ambas|las dos|mesial y distal)$/.test(normalized)) return "both";
    if (/^(?:pendiente|dejar pendiente|no registrar cara)$/.test(normalized)) return "pending";
    if (/^(?:guardar|guardar propuesta|guardar diagnostico y plan|confirmar y guardar|correcto guardar)$/.test(normalized)) return "save";
    return null;
  }
  if (stage === "diagnosis") return /^(?:correcto|si correcto|esta correcto)(?: pasar al plan| preguntar plan| preguntar plano| pasar al plano)?$/.test(normalized) ? "accept" : null;
  return /^(?:correcto|si correcto|esta correcto)(?: preparar propuesta| preparar la propuesta| continuar)?$/.test(normalized) ? "accept" : null;
}
