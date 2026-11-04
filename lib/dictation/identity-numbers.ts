import { fold, isNumberWord, numberRuns, type TranscriptCorrection } from "./spoken.ts";

type Edit = { start: number; end: number; replacement: string; reason: string };

/** Instrucción compartida por los modelos de corrección y estructuración clínica. */
export const IDENTITY_NORMALIZATION_PROMPT = [
  "Normalización de identidad: cambia solo el formato, nunca el valor dictado.",
  "RUN/RUT: convierte a cifras únicamente cuando esté identificado explícitamente como RUN o RUT. Conserva el orden, todos los ceros y el dígito verificador dictado después de «guion»; presenta puntos de miles y guion antes del dígito verificador. No calcules, corrijas ni completes dígitos.",
  "Fecha de nacimiento: conviértela a DD/MM/AAAA únicamente cuando esté identificada como fecha de nacimiento. Une el año pronunciado como un número español. La puntuación automática entre sus componentes puede ser ruido: «mil novecientos ochenta ¿y uno» significa 1981 si no hay una autocorrección o alternativa explícita. Si persiste una ambigüedad real, conserva el dato y márcalo para confirmar; no elijas un año.",
  "No apliques esta conversión a fechas de atención, edades, piezas dentales, montos, dosis ni otros números. La identidad no es un hallazgo ni un diagnóstico; si aparece en la narración dictada, conserva su contenido y aplica solo el formato indicado.",
].join("\n");

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
};

const RUT_CUE = /(?<!\p{L})(?:r\.?\s*u\.?\s*t\.?|r\.?\s*u\.?\s*n\.?)(?!\p{L})\s*(?:(?:es|numero(?:\s+de)?)\s*)?[:,]?\s*/giu;
const DATE_CUE = /(?<!\p{L})(?:fecha\s+de\s+nacimiento|fecha\s+nacimiento|nacido|nacida|nacio|nacimiento)(?!\p{L})/giu;
const SPOKEN_SEPARATOR = /(?<!\p{L})(?:guion|raya)(?!\p{L})|[-–—]/iu;
const NUMBER_WORD = /[\p{L}\p{N}]+/gu;

function formatRut(body: string, verifier: string): string {
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${verifier}`;
}

function numberValue(token: string): number | null {
  const run = numberRuns(token)[0];
  return run && run.start === 0 && run.end === token.length && Number.isSafeInteger(run.value) ? run.value : null;
}

/** Interpreta el cuerpo de un RUN/RUT solo cuando la frase contiene números reconocibles. */
function rutBodyDigits(value: string): string | null {
  const body = value.trim().replace(/[.,;:!?]+$/u, "");
  const tokens = body.match(NUMBER_WORD) ?? [];
  if (!tokens.length || !tokens.every((token) => /^\d+$/u.test(token) || isNumberWord(token) || fold(token) === "y")) return null;

  // Si se dictaron cifras una por una, conserva cada cero inicial.
  if (tokens.every((token) => /^\d+$/u.test(token))) return tokens.join("");

  const folded = fold(body);
  const million = /\bmillones?\b/u.exec(folded);
  if (million) {
    const prefix = numberRuns(body.slice(0, million.index)).reduce((sum, run) => sum + run.value, 0);
    const tailStart = million.index + million[0].length;
    const tail = numberRuns(body.slice(tailStart));
    const suffix = tail.map((run) => String(run.value)).join("");
    if (!Number.isSafeInteger(prefix) || prefix < 1 || prefix > 999 || suffix.length > 6) return null;
    return `${prefix}${suffix.padStart(6, "0")}`;
  }

  const runs = numberRuns(body);
  if (!runs.length) return null;
  if (/\bmil\b/u.test(folded)) {
    const value = runs.reduce((sum, run) => sum + run.value, 0);
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  if (runs.every((run) => run.value >= 0 && run.value <= 9)) return runs.map((run) => String(run.value)).join("");
  if (runs.some((run) => run.value < 0 || run.value > 999)) return null;
  const grouped = runs.length > 1 && runs[0].value <= 9
    ? `${runs[0].value}${runs.slice(1).map((run) => String(run.value).padStart(3, "0")).join("")}`
    : runs.map((run) => String(run.value)).join("");
  return grouped.padStart(6, "0");
}

function verifierDigit(value: string): string | null {
  const token = value.match(/^\s*([\p{L}\p{N}]+)/u)?.[1];
  if (!token) return null;
  const normalized = fold(token);
  if (/^\d$/u.test(normalized)) return normalized;
  if (normalized === "k" || normalized === "ka") return "K";
  const numeric = numberValue(normalized);
  return numeric !== null && numeric >= 0 && numeric <= 9 ? String(numeric) : null;
}

function rutEdits(text: string, folded: string): Edit[] {
  const edits: Edit[] = [];
  for (const cue of folded.matchAll(RUT_CUE)) {
    const cueStart = cue.index ?? 0;
    const afterCue = cueStart + cue[0].length;
    const remaining = folded.slice(afterCue, afterCue + 140);
    const separator = SPOKEN_SEPARATOR.exec(remaining);
    if (!separator) continue;

    const rawBody = remaining.slice(0, separator.index);
    const bodyOffset = rawBody.search(/\S/u);
    if (bodyOffset < 0) continue;
    const body = rawBody.trim().replace(/[.,;:!?]+$/u, "");
    const digits = rutBodyDigits(body);
    const dv = verifierDigit(remaining.slice(separator.index + separator[0].length));
    if (!digits || digits.length < 6 || digits.length > 8 || !dv) continue;

    const afterSeparator = remaining.slice(separator.index + separator[0].length);
    const dvMatch = /^\s*[\p{L}\p{N}]+/u.exec(afterSeparator);
    if (!dvMatch) continue;
    const end = afterCue + separator.index + separator[0].length + dvMatch[0].length;
    const start = afterCue + bodyOffset;
    const replacement = formatRut(digits, dv);
    const original = text.slice(start, end);
    if (original.trim() === replacement) continue;
    edits.push({ start, end, replacement, reason: "RUN/RUT hablado convertido a cifras" });
  }
  return edits;
}

function dateParts(dayText: string, month: number, yearText: string): { start: number; end: number; day: number; year: number } | null {
  const dayTokens = dayText.trim().split(/\s+/u);
  if (dayTokens.length < 1 || dayTokens.length > 2) return null;
  const day = numberValue(dayTokens[0]);
  const repeatedDay = dayTokens.length === 2 ? numberValue(dayTokens[1]) : day;
  // ASR may insert ¿, ?, ¡ or ! inside a spoken year. Replacing each mark with
  // one space preserves offsets while allowing numberRuns to join e.g. "sesenta ¿y uno".
  const yearForParsing = yearText.trim().replace(/[¿?¡!]/gu, " ");
  const yearRuns = numberRuns(yearForParsing);
  const year = yearRuns[0];
  if (day === null || day !== repeatedDay || day < 1 || day > 31 || !year || year.start !== 0 || year.value < 1000 || year.value > 9999) return null;
  const date = new Date(Date.UTC(year.value, month - 1, day));
  if (date.getUTCFullYear() !== year.value || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { start: 0, end: year.end, day, year: year.value };
}

function dateEdits(text: string, folded: string): Edit[] {
  const edits: Edit[] = [];
  for (const cue of folded.matchAll(DATE_CUE)) {
    const cueStart = cue.index ?? 0;
    const afterCue = cueStart + cue[0].length;
    const remainder = folded.slice(afterCue, afterCue + 100).split(/[.;\n]/u, 1)[0];
    const prefix = /^\s*(?:(?:es|el)\b\s*|:\s*)?(?:el\b\s*)?/u.exec(remainder)?.[0] ?? "";
    const content = remainder.slice(prefix.length).replace(/^\s+/u, "");
    const leading = remainder.slice(prefix.length).length - remainder.slice(prefix.length).trimStart().length;
    const monthPattern = new RegExp(`(?:^|\\s)(${Object.keys(MONTHS).join("|")})(?=$|\\s)`, "u");
    const monthMatch = monthPattern.exec(content);
    if (!monthMatch) continue;
    const monthName = monthMatch[1];
    const monthStart = monthMatch.index + monthMatch[0].lastIndexOf(monthName);
    const head = content.slice(0, monthStart).trim();
    const headMatch = /^(\d{1,2}|[a-z]+)(?:\s+(\d{1,2}|[a-z]+))?\s+de$/u.exec(head);
    if (!headMatch) continue;
    const dayText = [headMatch[1], headMatch[2]].filter(Boolean).join(" ");
    const yearStartMatch = /^\s+(?:de|del)\s+/u.exec(content.slice(monthStart + monthName.length));
    if (!yearStartMatch) continue;
    const yearTextStart = monthStart + monthName.length + yearStartMatch[0].length;
    const yearText = content.slice(yearTextStart).trimStart();
    const parsed = dateParts(dayText, MONTHS[monthName], yearText);
    if (!parsed) continue;

    const dayStartInContent = head.indexOf(headMatch[1]);
    const start = afterCue + prefix.length + leading + dayStartInContent;
    const end = afterCue + prefix.length + leading + yearTextStart + (yearText.length - yearText.trimStart().length) + parsed.end;
    if (start < 0 || end <= start) continue;
    const replacement = `${String(parsed.day).padStart(2, "0")}/${String(MONTHS[monthName]).padStart(2, "0")}/${parsed.year}`;
    const original = text.slice(start, end);
    if (original.trim() === replacement) continue;
    edits.push({ start, end, replacement, reason: "Fecha de nacimiento hablada convertida a cifras" });
  }
  return edits;
}

/** Normaliza solo RUN/RUT y fechas de nacimiento expresamente identificados en el dictado. */
export function normalizeIdentityNumbers(text: string): { text: string; corrections: TranscriptCorrection[] } {
  if (!text.trim()) return { text, corrections: [] };
  const folded = fold(text);
  const edits = [...rutEdits(text, folded), ...dateEdits(text, folded)].sort((a, b) => b.start - a.start);
  let normalized = text;
  const corrections: TranscriptCorrection[] = [];
  for (const edit of edits) {
    const original = normalized.slice(edit.start, edit.end);
    normalized = `${normalized.slice(0, edit.start)}${edit.replacement}${normalized.slice(edit.end)}`;
    corrections.unshift({ original, corrected: edit.replacement, origin: "diccionario", applied: true, reason: edit.reason });
  }
  return { text: normalized, corrections };
}
