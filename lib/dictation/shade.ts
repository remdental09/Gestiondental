/**
 * Colores de corona o resina (escala VITA: A1–A4, B1–B4, C1–C4, D2–D4, con medios tonos como A3.5) tal como los transcribe el reconocimiento de voz:
 * «color A 3.5», «color a 3,5», «tono A tres cinco», «color A3 y medio». Se dejan escritos como «color A3.5» antes de leer las piezas,
 * porque «3.5» suelto es la pieza FDI 3.5 (el color de una corona en la 4.5 terminaba evolucionando la 3.5).
 * No se toca cuando la «a» es la preposición: «cambio de color a 2 meses», «color a 3.5 mm».
 */
const WORD_DIGIT: Record<string, string> = { uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4" };
const NOT_A_SHADE_AFTER = /^\s*(?:[.,]\s*\d+)?\s*(?:mes|semana|d[ií]a|a[ñn]o|hora|minuto|segundo|mm\b|mil[ií]metro|cm\b|vez|veces)/i;

export function normalizeShades(text: string): string {
  return text.replace(
    /\b(color|tono|matiz|shade|vita)(\s+(?:de\s+)?)([A-Da-d])\s*[-]?\s*(uno|una|dos|tres|cuatro|[1-4])(\s*[.,]\s*5(?!\d)|\s+punto\s+(?:5|cinco)\b|\s+y\s+medio\b|\s+(?:5|cinco)\b)?/gi,
    (all: string, word: string, gap: string, letter: string, digit: string, half: string | undefined, offset: number, whole: string) => {
      if (NOT_A_SHADE_AFTER.test(whole.slice(offset + all.length))) return all;
      return `${word}${gap}${letter.toUpperCase()}${WORD_DIGIT[digit.toLowerCase()] ?? digit}${half ? ".5" : ""}`;
    },
  );
}
