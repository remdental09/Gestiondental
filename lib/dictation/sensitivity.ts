/**
 * Sensibilidad de la revisión del dictado. El profesional decide cuánto quiere que la IA lo corrija:
 *  - «basic» (por defecto): basta con detectar diagnóstico, procedimientos y plan. Se omiten la segunda opinión de la IA y los
 *    avisos que solo informan o cuestionan lo dictado; quedan las preguntas que impiden registrar bien (pieza, superficie, numeración).
 *  - «full»: revisión completa, como antes.
 * Nunca se oculta lo dictado ni se guarda algo sin confirmación: esto solo baja el ruido de los avisos.
 */
export type Sensitivity = "basic" | "full";
export const DEFAULT_SENSITIVITY: Sensitivity = "basic";

export const parseSensitivity = (value: unknown): Sensitivity => value === "full" ? "full" : DEFAULT_SENSITIVITY;

// Avisos que informan o cuestionan, sin pedir un dato que falte para registrar.
const CHATTER: RegExp[] = [
  /^Revisión clínica \(IA\)/i,
  /^Comprensión clínica:/i,
  /^IA: .*no es cl[ií]nicamente interpretable/i,
  /^IA: .*corresponde registrar alg[úu]n dato cl[ií]nico/i,
  /^Relato, no hallazgo confirmado/i,
  /^Plan o presupuesto, sin cambio de odontograma/i,
  /^Hallazgo negado, sin cambio de odontograma/i,
  /^No se creó un diagnóstico confirmado/i,
];

export const isChatter = (note: string) => CHATTER.some(pattern => pattern.test(note.trim()));

/** En nivel básico quita los avisos de conversación; en completo los deja todos. */
export function calmClarifications(notes: string[], level: Sensitivity): string[] {
  return level === "full" ? notes : notes.filter(note => !isChatter(note));
}
