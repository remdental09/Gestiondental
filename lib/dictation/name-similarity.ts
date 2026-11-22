/**
 * Parecido entre un nombre dicho y el de una ficha. Módulo liviano y sin dependencias:
 * la portada lo usa sin arrastrar el vocabulario del dictado al JS inicial.
 */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "san", "santa", "van", "von", "mc"]);

export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
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

export const nameTokens = (value: string) => fold(value).split(/[^a-z']+/).filter((token) => token.length >= 2 && !CONNECTORS.has(token));

export function tokenMatches(spoken: string, stored: string): boolean {
  if (spoken === stored) return true;
  if (spoken.length >= 4 && stored.length >= 4 && (stored.startsWith(spoken) || spoken.startsWith(stored))) return true;
  // Safari confunde una letra (Peres/Pérez, Gonzales/González).
  return spoken.length >= 5 && stored.length >= 5 && editDistance(spoken, stored) <= 1;
}

/** Puntaje 0–1 de cuánto se parece el nombre dicho al de una ficha. */
export function nameSimilarity(spoken: string, stored: string): number {
  const said = nameTokens(spoken);
  const own = nameTokens(stored);
  if (!said.length || !own.length) return 0;
  const hits = said.filter((token) => own.some((part) => tokenMatches(token, part))).length;
  if (!hits) return 0;
  const coverage = hits / said.length;
  // Un solo nombre dicho («la señora González») pesa menos que nombre y apellido.
  const weight = hits >= 2 ? 1 : 0.55;
  return Math.round(coverage * weight * 100) / 100;
}

