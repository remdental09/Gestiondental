import { foldText } from "./specialty.ts";

/** Texto comparable: sin tildes, minúsculas, solo letras y números separados por un espacio. */
export const plainWords = (value: string) => foldText(value).replace(/[^a-z0-9]+/g, " ").trim();

/** Distancia de edición (Levenshtein). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const ratio = (a: string, b: string) => (a && b ? 1 - editDistance(a, b) / Math.max(a.length, b.length) : 0);

/**
 * Parecido 0–1 entre lo oído y un nombre del catálogo. Tolera palabras separadas o unidas por la voz
 * («pro taper» ~ «ProTaper»), letras cambiadas («Arsis» ~ «Arcsys») y nombres de varias palabras.
 */
export function similarity(heard: string, name: string): number {
  const h = plainWords(heard);
  const n = plainWords(name);
  if (!h || !n) return 0;
  if (h === n) return 1;
  const hc = h.replace(/ /g, "");
  const nc = n.replace(/ /g, "");
  if (hc === nc) return 0.98;
  let best = ratio(hc, nc);
  // Lo oído es el comienzo o una parte del nombre («protaper» en «protaper gold»), con un mínimo de largo.
  if (hc.length >= 4 && nc.includes(hc)) best = Math.max(best, 0.9);
  if (nc.length >= 4 && hc.includes(nc)) best = Math.max(best, 0.9);
  // Palabra a palabra (y pares de palabras unidas), para nombres largos dictados en parte.
  const heardWords = h.split(" ").filter((word) => word.length >= 3);
  const nameWords = n.split(" ");
  const namePieces = [...nameWords, ...nameWords.slice(1).map((word, index) => nameWords[index] + word)].filter((piece) => piece.length >= 4);
  for (const word of heardWords) for (const piece of namePieces) best = Math.max(best, ratio(word, piece) * (word.length >= 5 ? 1 : 0.9));
  return best;
}
