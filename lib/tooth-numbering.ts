/**
 * Numeración de piezas: FDI (con punto, 1.1–4.8 y 5.1–8.5) y nacional chilena (permanentes 1–32, temporales A–T).
 * FDI 3.6 = Chile 30; FDI 4.6 = Chile 19 (no confundir con la Universal estadounidense, donde 3.6 = 19).
 * Internamente la pieza es el FDI compacto (36).
 */
const PRIMARY_LETTERS: Record<number, string> = {
  55: "A", 54: "B", 53: "C", 52: "D", 51: "E", 61: "F", 62: "G", 63: "H", 64: "I", 65: "J",
  75: "K", 74: "L", 73: "M", 72: "N", 71: "O", 81: "P", 82: "Q", 83: "R", 84: "S", 85: "T",
};
const LETTER_TO_FDI: Record<string, number> = Object.fromEntries(Object.entries(PRIMARY_LETTERS).map(([fdi, letter]) => [letter, Number(fdi)]));

export type ToothNumbering = "fdi" | "chile";

export function isFdiTooth(tooth: number): boolean {
  if (!Number.isInteger(tooth)) return false;
  const q = Math.floor(tooth / 10), p = tooth % 10;
  if (q >= 1 && q <= 4) return p >= 1 && p <= 8;
  if (q >= 5 && q <= 8) return p >= 1 && p <= 5;
  return false;
}

export const formatFdiTooth = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;

/** Número chileno de una pieza FDI: «30» para 3.6, «C» para 5.3; vacío si no es una pieza válida. */
export function fdiToChile(tooth: number): string {
  if (!isFdiTooth(tooth)) return "";
  if (PRIMARY_LETTERS[tooth]) return PRIMARY_LETTERS[tooth];
  const q = Math.floor(tooth / 10), p = tooth % 10;
  return String(q === 1 ? 9 - p : q === 2 ? 8 + p : q === 3 ? 24 + p : 25 - p);
}

/** Pieza FDI desde un número chileno (1–32) o una letra de temporal (A–T); null si no corresponde. */
export function chileToFdiTooth(token: string | number): number | null {
  const value = String(token).trim().toUpperCase();
  if (/^[A-T]$/.test(value)) return LETTER_TO_FDI[value] ?? null;
  const n = Number(value);
  if (!/^\d{1,2}$/.test(value) || n < 1 || n > 32) return null;
  if (n <= 8) return 19 - n;
  if (n <= 16) return 12 + n;
  if (n <= 24) return 65 - n;
  return n + 6;
}

const unique = (teeth: number[]) => [...new Set(teeth)].sort((a, b) => a - b);

/** Lee piezas en FDI («3.6, 4.6», «36 46») o en numeración chilena («30, 19», «C, H»). Ignora lo que no es pieza. */
export function parseTeethInput(text: string, numbering: ToothNumbering): number[] {
  if (numbering === "chile") {
    const found: number[] = [];
    for (const match of text.toUpperCase().matchAll(/(?<![\w.,$])(\d{1,2}|[A-T])(?![\w.,]?\d)/g)) {
      const tooth = chileToFdiTooth(match[1]);
      if (tooth) found.push(tooth);
    }
    return unique(found);
  }
  const found: number[] = [];
  for (const match of text.matchAll(/(?<![\d.,$])([1-8])[.,]?([1-8])(?![\d.,]?\d)/g)) {
    const tooth = Number(match[1]) * 10 + Number(match[2]);
    if (isFdiTooth(tooth)) found.push(tooth);
  }
  return unique(found);
}

/** «1.4 (Ch. 5)» — las dos nomenclaturas juntas. */
export const toothBothLabel = (tooth: number) => `${formatFdiTooth(tooth)} (Ch. ${fdiToChile(tooth)})`;

/** «1.2, 1.4 · Chile 7, 5» para listas. */
export function teethBothText(teeth: number[]): string {
  if (!teeth.length) return "";
  return `${teeth.map(formatFdiTooth).join(", ")} · Chile ${teeth.map(fdiToChile).join(", ")}`;
}

/**
 * Piezas que podrían estar escritas en el nombre de la prestación sin punto («implante 14 15 y 12»).
 * Son ambiguas (FDI 1.4 o Chile 14 = FDI 2.6), así que se devuelven las dos lecturas para que el dentista elija.
 */
export function teethHintsFromLabel(label: string): { fdi: number[]; chile: number[] } {
  if (/\d\.\d/.test(label)) return { fdi: parseTeethInput(label, "fdi"), chile: [] };
  const bare = [...label.matchAll(/(?<![\d.,$])(\d{1,2})(?![\d.,]?\d|\s*%)/g)].map(m => m[1]);
  if (!bare.length) return { fdi: [], chile: [] };
  return { fdi: parseTeethInput(bare.join(" "), "fdi"), chile: parseTeethInput(bare.join(" "), "chile") };
}
