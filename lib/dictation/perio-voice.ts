/**
 * Gramática acotada del dictado periodontal por voz: en cada sitio solo se espera un número (0–12; el margen
 * puede ser negativo con «menos») o una orden corta. Así se corrigen los errores típicos del reconocimiento de voz
 * del navegador en español («tren» → 3, «los» → 2, «mueve» → 9) sin aceptar frases que no son una medida.
 *
 * Lógica pura y probada (tests/perio-voz.test.mjs). La usa `perio-guide.ts`.
 */
import { chileToFdi, type PerioDictationSite } from "./perio-dictation.ts";

export const PERIO_MAX_DEPTH = 12;
export const PERIO_MAX_MARGIN = 12;
/** Salto entre sitios vecinos que se considera sospechoso y se vuelve a preguntar. */
export const PERIO_SUSPICIOUS_JUMP = 5;

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Número exacto en palabras (válido también dentro de frases más largas). */
const EXACT: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
};
/** Errores típicos del reconocimiento: solo se aceptan cuando la palabra se dice SOLA (con «menos/más» o «mm» a lo sumo). */
const HOMOPHONE: Record<string, number> = {
  sero: 0, zero: 0, cer: 0,
  unos: 1,
  los: 2, do: 2, doz: 2,
  tren: 3, tre: 3, trez: 3, tres: 3, pres: 3,
  cuarto: 4, cuatros: 4, guatro: 4,
  zinco: 5, sinco: 5, cinco: 5, cincos: 5,
  si: 6, sei: 6, seys: 6, ceis: 6, says: 6,
  diete: 7, siente: 7, sietes: 7,
  hecho: 8, echo: 8, ochos: 8,
  mueve: 9, llueve: 9, nieve: 9, nuevo: 9,
  dies: 10, es: 10, diez: 10,
  onse: 11, onze: 11,
  dose: 12, doze: 12,
};
/** Palabras de relleno que no cambian la medida dicha. */
const FILLER = new Set(["mm", "milimetro", "milimetros", "sondaje", "margen", "gingival", "de", "el", "la", "y", "eh", "este", "ok", "valor", "son", "va", "pon", "anota"]);

export type VoiceValue = { values: number[]; homophone: boolean };

/**
 * Valores numéricos de una respuesta. Devuelve null si la frase no es una medida.
 * - Dígitos («3», «-1», «+2») y números en palabras siempre valen.
 * - «menos»/«negativo» hace negativo el número siguiente; «más» lo deja positivo.
 * - Un homófono («tren», «los», «mueve», «sí») solo cuenta si es la única palabra: «sí, tres» no se lee como 6 y 3.
 */
export function voiceValues(text: string): VoiceValue | null {
  const words = fold(text).replace(/(\d)\s*(mm|milimetros?)\b/g, "$1").replace(/[^a-z0-9+\-ñ\s]/g, " ").split(/\s+/).filter(Boolean);
  const meaningful = words.filter(word => !FILLER.has(word));
  if (!meaningful.length) return null;
  const values: number[] = [];
  let sign = 1, homophone = false;
  const lone = meaningful.filter(word => !/^(menos|negativo|mas)$/.test(word)).length === 1;
  for (const word of meaningful) {
    if (word === "menos" || word === "negativo") { sign = -1; continue; }
    if (word === "mas") { sign = 1; continue; }
    if (/^[+-]?\d+$/.test(word)) { const n = Number(word); values.push(word.startsWith("-") ? n : sign * n); sign = 1; continue; }
    if (word in EXACT) { values.push(sign * EXACT[word]); sign = 1; continue; }
    if (lone && word in HOMOPHONE) { values.push(sign * HOMOPHONE[word]); sign = 1; homophone = true; continue; }
    return null; // una palabra que no es número ni relleno: no es una medida.
  }
  return values.length ? { values, homophone } : null;
}

export type PerioCommand = "terminar" | "pausa" | "sigue" | "corrige" | "repite" | "atras" | "ausente" | "salta" | "sangra" | "supura";
/** Orden de voz de la frase, si la hay. «Corrige» rehace el último valor; «repite» vuelve a decir la pregunta. */
export function perioCommand(text: string): PerioCommand | null {
  const t = fold(text).trim();
  const has = (re: RegExp) => re.test(t);
  if (has(/\b(terminar|termina|termino|finalizar|finaliza)\b/)) return "terminar";
  if (has(/\b(pausa|pausar|espera)\b/)) return "pausa";
  if (has(/\b(corregir|corrige|corrijo|borrar|borra|me equivoque|error)\b/)) return "corrige";
  if (has(/\b(repetir|repite|repito|de nuevo|otra vez)\b/)) return "repite";
  if (has(/\b(atras|anterior|volver|vuelve)\b/)) return "atras";
  if (has(/\b(ausente|ausencia|falta|no esta|extraida|perdida)\b/)) return "ausente";
  if (has(/\b(saltar|salta|salto|omitir|omite|siguiente pieza)\b/)) return "salta";
  if (has(/\b(continuar|continua|reanudar|seguir|sigue|sigamos|reintentar|autorizo|autorizada|dale)\b/)) return "sigue";
  // «sangra»/«supura» solos (sin número) marcan el sitio recién medido.
  if (!/\d|\b(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(t)) {
    const affirmed = t.replace(/\b(sin|no|ni|tampoco)\s+(hay\s+)?(sangrado|sangra|sangrando|supuracion|supura|pus)\b/g, " ");
    if (/\b(sangra|sangrado|sangrando|sangran)\b/.test(affirmed)) return "sangra";
    if (/\b(supura|supuracion|supurando|pus)\b/.test(affirmed)) return "supura";
  }
  return null;
}

const DIGIT_WORD: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const validFdi = (n: number) => Number.isInteger(n) && Math.floor(n / 10) >= 1 && Math.floor(n / 10) <= 4 && n % 10 >= 1 && n % 10 <= 8;

/**
 * «pieza N» con la convención de la aplicación: «2.6», «dos punto seis» o «dos seis» (dos dígitos) son FDI;
 * un número 1–32 sin punto es numeración chilena; 33–48 válido es FDI. Devuelve la pieza FDI o null.
 */
export function spokenToothCommand(text: string): number | null {
  const m = fold(text).match(/\b(?:pieza|diente|molar|premolar)\s+(.+)$/);
  if (!m) return null;
  const rest = m[1].trim();
  const dotted = rest.match(/^(\d)\s*[.,]\s*(\d)\b/) ?? rest.match(/^(\d)\s+punto\s+(\d)\b/);
  if (dotted) { const n = Number(dotted[1]) * 10 + Number(dotted[2]); return validFdi(n) ? n : null; }
  const words = rest.split(/\s+/);
  const w0 = DIGIT_WORD[words[0]], w1 = DIGIT_WORD[words[1] === "punto" ? words[2] : words[1]];
  if (w0 && w1 && w0 <= 4) { const n = w0 * 10 + w1; return validFdi(n) ? n : null; }
  const twoDigits = rest.match(/^(\d)\s+(\d)\b/);
  if (twoDigits) { const n = Number(twoDigits[1]) * 10 + Number(twoDigits[2]); return validFdi(n) ? n : null; }
  const plain = rest.match(/^(\d{1,2})\b/);
  const n = plain ? Number(plain[1]) : EXACT[words[0]] ?? NaN;
  if (!Number.isInteger(n)) return null;
  if (n >= 1 && n <= 32) return chileToFdi(n);
  return validFdi(n) ? n : null;
}

/** Sitios vecinos: en la misma cara y el interproximal del otro lado (MV ↔ ML, DV ↔ DL). */
export const NEIGHBOURS: Record<PerioDictationSite, PerioDictationSite[]> = {
  MV: ["V", "ML"], V: ["MV", "DV"], DV: ["V", "DL"], ML: ["L", "MV"], L: ["ML", "DL"], DL: ["L", "DV"],
};

/**
 * ¿El valor oído se vuelve a preguntar en vez de anotarse? Fuera de rango siempre; un salto ≥5 mm respecto de
 * un sitio vecino ya medido es sospechoso (se acepta si el clínico lo repite igual).
 */
export function perioSuspicious(kind: "depth" | "margin", value: number, site: PerioDictationSite, measured: Partial<Record<PerioDictationSite, number>>): "range" | "jump" | null {
  if (kind === "depth") {
    if (value < 0 || value > PERIO_MAX_DEPTH) return "range";
    if (NEIGHBOURS[site].some(n => measured[n] !== undefined && Math.abs(measured[n]! - value) >= PERIO_SUSPICIOUS_JUMP)) return "jump";
    return null;
  }
  return Math.abs(value) > PERIO_MAX_MARGIN ? "range" : null;
}

/** Cómo se dice un valor en la confirmación: «tres», «menos uno». */
export const spokenNumber = (value: number) => (value < 0 ? `menos ${-value}` : String(value));

/** Sesgo del modelo de transcripción para una respuesta corta del periodontograma. */
export const PERIO_TRANSCRIPTION_PROMPT = "Respuesta corta durante un periodontograma en español de Chile. El clínico dice un solo número de 0 a 12 en milímetros (sondaje) o un margen gingival que puede ser negativo («menos uno», «más dos»), o una orden: corrige, repite, atrás, salta, pausa, sigue, ausente, sangra, supura, pieza y un número. Transcribe el número con dígitos (0, 1, 2, 3 … 12, -1). Si no se entiende, no inventes.";
export const PERIO_TRANSCRIPTION_KEYWORDS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "menos", "más", "corrige", "repite", "atrás", "salta", "pausa", "sigue", "sangra", "supura", "pieza", "ausente"];
