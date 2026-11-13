/**
 * «Endodoncia previa»: la pieza ya viene con tratamiento de conductos hecho antes de esta atención
 * («la 3.6 viene con endodoncia previa», «endodoncia antigua en la 1.1, del 2018»).
 * No es un procedimiento de hoy: se propone para el endograma (caso «Previamente tratado») y el profesional la confirma.
 * Funciones puras, sin red.
 */

const PREVIOUS = String.raw`(?:previas?(?!\s+al?\s)|anterior|anteriores|antigua|antiguas|hecha|realizada|ya\s+(?:hecha|realizada)|de\s+hace\s+(?:\d+|\p{L}+)\s+a[ñn]os?)`;
const PRIOR_PATTERNS: RegExp[] = [
  new RegExp(String.raw`(?<!\p{L})(?:endodoncia|tratamiento\s+de\s+(?:conductos?|canales))\s+${PREVIOUS}(?!\p{L})`, "iu"),
  /(?<!\p{L})(?:(?:ya\s+)?(?:viene|vino|est[aá]|se\s+encuentra|tiene|presenta)\s+(?:con\s+)?)?(?:endodonciad[oa]s?|tratad[oa]s?\s+(?:de|en)\s+(?:los\s+)?(?:conductos?|canales))(?!\p{L})/iu,
  /(?<!\p{L})(?:viene|vino|est[aá]|se\s+encuentra)\s+con\s+(?:endodoncia|tratamiento\s+de\s+conductos?)(?!\s+(?:indicad|pendiente|por\s+hacer))/iu,
  /(?<!\p{L})(?:antecedentes?|historia)\s+de\s+(?:endodoncia|tratamiento\s+de\s+conductos?)(?!\p{L})/iu,
];
/** Lo que NO es endodoncia previa aunque nombre endodoncia: se indica, se hace hoy, se rehace o falta. */
const NOT_PRIOR = /(?<!\p{L})(?:sin\s+endodoncia|no\s+(?:tiene|presenta|lleva|ha\s+tenido|tuvo)\s+(?:una\s+)?(?:endodoncia|tratamiento\s+de\s+conductos?)|necesita|requiere|indicad[oa]|para\s+(?:una\s+)?endodoncia|se\s+realiza|se\s+hizo\s+hoy|hoy|reendodoncia|retratamiento|re-?tratamiento|plan\s+de|presupuesto|cotiz\p{L}*)(?!\p{L})/iu;

export function isPriorEndoSentence(sentence: string): boolean {
  if (!PRIOR_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
  return !NOT_PRIOR.test(sentence);
}

const WORD_YEARS: Record<string, number> = { un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20 };

/** Año aproximado de la endodoncia previa («del 2018», «hace 5 años»), o "" si no se dijo. */
export function priorEndoYear(sentence: string, today: string): string {
  const explicit = sentence.match(/(?<!\d)(19[5-9]\d|20[0-4]\d)(?!\d)/);
  const current = Number(today.slice(0, 4));
  if (explicit && Number(explicit[1]) <= current) return explicit[1];
  const ago = sentence.match(/hace\s+(\d{1,2}|\p{L}+)\s+a[ñn]os?/iu);
  if (ago) {
    const years = /^\d+$/.test(ago[1]) ? Number(ago[1]) : WORD_YEARS[ago[1].toLowerCase()];
    if (years && years > 0 && years < 60) return String(current - years);
  }
  return "";
}
