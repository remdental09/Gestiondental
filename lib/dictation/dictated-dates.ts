/**
 * Fechas escritas dentro del dictado («Con fecha 1 de junio se realiza…», «03/07 Cementación…», «22/10/2026 / …»).
 * Pueden diferir de la fecha de la evolución (la ficha se escribió después): no se borran de la nota.
 */
const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const DATE = new RegExp(String.raw`(?<![\d/])(?:\d{1,2}[/-]\d{1,2}(?:[/-](?:\d{4}|\d{2}))?|\d{1,2}\s+de\s+(?:${MONTHS})(?:\s+(?:de(?:l)?\s+)?\d{4})?)(?![\d/])`, "giu");
const CUE = new RegExp(String.raw`(?:^\s*|\n\s*|\bfecha\s+(?:del?\s+)?)$`, "iu");

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (value: string) => fold(value).replace(/\s+/g, " ").replace(/^0/, "").replace(/([/-])0/g, "$1");

/** Fechas del dictado que parecen fecha de atención (al inicio, o tras «fecha»/«el día»). «1/2 tubos» no cuenta. */
export function dictatedDates(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(DATE)) {
    const value = match[0];
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    const after = text.slice((match.index ?? 0) + value.length, (match.index ?? 0) + value.length + 12);
    if (/^\s*(?:tubos?|carpules?|ml|mg|%)/i.test(after)) continue;
    if (/^\d{1,2}[/-]\d{1,2}$/.test(value)) {
      const [d, m] = value.split(/[/-]/).map(Number);
      if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) continue;
    }
    if (!CUE.test(fold(before))) continue;
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

/** Si la nota redactada perdió una fecha dictada, se agrega al inicio, tal cual se dictó. */
export function keepDictatedDates(body: string, text: string): { body: string; kept: string[] } {
  const plain = digits(body);
  const missing = dictatedDates(text).filter((value) => !plain.includes(digits(value)));
  if (!missing.length) return { body, kept: [] };
  const line = `Fecha indicada en el dictado: ${missing.join(", ")}.`;
  return { body: `${line}\n${body}`, kept: missing };
}
