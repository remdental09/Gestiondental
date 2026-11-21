/**
 * Colores de corona o resina (escala VITA: A1–A4, B1–B4, C1–C4, D2–D4, con medios tonos como A3.5) tal como los transcribe el reconocimiento de voz:
 * «color A 3.5», «color a 3,5», «tono A tres cinco», «color A3 y medio». Se dejan escritos como «color A3.5» antes de leer las piezas,
 * porque «3.5» suelto es la pieza FDI 3.5 (el color de una corona en la 4.5 terminaba evolucionando la 3.5).
 */
const WORD_DIGIT: Record<string, string> = { uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4" };

export function normalizeShades(text: string): string {
  return text.replace(
    /\b(color|tono|matiz|shade|vita)(\s+(?:de\s+)?)([A-Da-d])\s*[-]?\s*(uno|una|dos|tres|cuatro|[1-4])(\s*[.,]\s*5(?!\d)|\s+punto\s+(?:5|cinco)\b|\s+y\s+medio\b|\s+(?:5|cinco)\b)?/gi,
    (_all, word: string, gap: string, letter: string, digit: string, half: string | undefined) =>
      `${word}${gap}${letter.toUpperCase()}${WORD_DIGIT[digit.toLowerCase()] ?? digit}${half ? ".5" : ""}`,
  );
}
