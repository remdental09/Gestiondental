/**
 * Órdenes dictadas sobre evoluciones ya guardadas: «elimina / borra / anula el último dictado» o
 * «… la evolución del 1 de noviembre», y opcionalmente «pon solamente que …» / «reemplázala por …».
 * Se detectan con reglas (sin IA). Nunca se ejecutan solas: la app muestra una tarjeta y el dentista confirma.
 */
export type EvolutionTarget = { type: "last" } | { type: "date"; date: string };
export type VoiceCommand = {
  kind: "annul";
  target: EvolutionTarget;
  /** Texto de la evolución nueva que reemplaza a la anulada, tal como se dictó. */
  replacement: string | null;
  /** Fragmento dictado que contiene la orden, para mostrarlo como respaldo. */
  evidence: string;
};

/** Minúsculas y sin tildes, conservando el largo para poder recortar el texto original. */
const fold = (text: string): string => text.split("").map((char) => (char.normalize("NFD")[0] ?? char).toLowerCase()[0] ?? char).join("");

const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const SMALL: Record<string, number> = { primero: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, "treinta y uno": 31 };

const VERB = String.raw`(?:elimin|borr|anul|quit|sac|descart|suprim)(?:a|ar|e|en|ala|alo|arla|arlo|emos)?`;
const OBJECT = String.raw`(?:dictado|evolucion|(?:ultim[oa]|anterior)\s+(?:nota|registro|atencion))`;
const COMMAND = new RegExp(String.raw`\b${VERB}\b(?:\s+\S+){0,4}?\s+${OBJECT}`);
const REPLACE_VERB = new RegExp(String.raw`\breemplaz(?:a|ala|alo|ar|arla|arlo|e|ela)\b(?:\s+\S+){0,4}?\s+${OBJECT}|\breemplaz(?:ala|alo|arla|arlo)\b`);
const REPLACEMENT = /\b(?:y\s+)?(?:en\s+su\s+lugar\s+)?(?:pon|pone|ponga|poner|ponle|escribe|escriba|escribir|anota|anote|deja|deje|dejar|registra|registre)\s+(?:solamente|solo|unicamente|nada\s+mas)\s+(?:que\s+)?|\b(?:reemplaz|cambi)(?:a|ala|alo|arla|arlo|ar|e)\s+(?:(?:la|lo)\s+)?por\s+(?:que\s+)?|\ben\s+su\s+lugar\s+(?:pon|escribe|anota|deja)\s+(?:que\s+)?/;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** Fecha dicha («del 1 de noviembre», «del primero de noviembre de 2026», «del 01-11», «de hoy», «de ayer»). */
export function spokenDate(folded: string, today: string): string | null {
  const [ty, tm, td] = today.split("-").map(Number);
  const pick = (d: number, m: number, y?: number) => {
    let year = y ?? ty;
    if (year < 100) year += 2000;
    if (!validDate(year, m, d)) return null;
    // Sin año, una fecha futura se entiende del año anterior.
    if (y === undefined && iso(year, m, d) > today) year -= 1;
    return iso(year, m, d);
  };
  if (/\bde(?:l dia de)? hoy\b|\bevolucion de hoy\b|\bdictado de hoy\b/.test(folded)) return today;
  if (/\bde(?:l dia de)? ayer\b/.test(folded)) {
    const date = new Date(Date.UTC(ty, tm - 1, td - 1));
    return date.toISOString().slice(0, 10);
  }
  const months = Object.keys(MONTHS).join("|");
  const numberWords = Object.keys(SMALL).sort((a, b) => b.length - a.length).join("|");
  const named = new RegExp(String.raw`\b(\d{1,2}|${numberWords})\s+de\s+(${months})(?:\s+(?:de(?:l)?\s+)?(\d{4}))?\b`).exec(folded);
  if (named) {
    const day = /^\d+$/.test(named[1]) ? Number(named[1]) : SMALL[named[1]];
    return pick(day, MONTHS[named[2]], named[3] ? Number(named[3]) : undefined);
  }
  // «del 01-11»: exige «del/de» delante para no confundir una pieza («2.6») con una fecha.
  const numeric = /\bdel?\s+(?:dia\s+)?(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/.exec(folded);
  if (numeric) return pick(Number(numeric[1]), Number(numeric[2]), numeric[3] ? Number(numeric[3]) : undefined);
  return null;
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);

/** Detecta una orden de anular (y reemplazar) una evolución. Devuelve null si el dictado es clínico normal. */
export function parseVoiceCommand(text: string, today: string): VoiceCommand | null {
  const folded = fold(text);
  const annul = COMMAND.exec(folded);
  const command = annul ?? REPLACE_VERB.exec(folded);
  if (!command) return null;
  const fromCommand = folded.slice(command.index);
  const trigger = REPLACEMENT.exec(fromCommand);
  // «reemplaza la última nota por …»: el texto nuevo parte después del «por».
  const afterObject = annul || trigger ? null : /[\s,]+por[\s:,]+(?:que\s+)?/.exec(folded.slice(command.index + command[0].length));
  const replacementMatch = trigger ?? afterObject;
  const replacementStart = trigger ? command.index + trigger.index : afterObject ? command.index + command[0].length + afterObject.index : -1;
  const commandEnd = replacementStart >= 0 ? replacementStart : folded.length;
  // La fecha se busca solo en la orden, no en el texto nuevo.
  const date = spokenDate(folded.slice(command.index, commandEnd), today);
  const replacementRaw = replacementMatch ? text.slice(replacementStart + replacementMatch[0].length).trim().replace(/^[,.;:\s]+/, "") : "";
  const replacement = replacementRaw.length >= 3 ? capitalize(replacementRaw) : null;
  return {
    kind: "annul",
    target: date ? { type: "date", date } : { type: "last" },
    replacement,
    evidence: text.slice(command.index, commandEnd).trim().replace(/[,.;:\s]+$/, ""),
  };
}

export type CommandNote = { id: number; clinicalDate?: string; date?: string; recordedAt?: string; title: string; body: string; status?: string };

const noteDate = (note: CommandNote): string => note.clinicalDate ?? (note.date ? note.date.split("-").reverse().join("-") : "");

/**
 * Qué evolución vigente apunta la orden. Con varias el mismo día se propone la más reciente y se avisa.
 * Las anuladas nunca son objetivo.
 */
export function resolveCommandTarget<T extends CommandNote>(target: EvolutionTarget, notes: T[]): { note: T | null; sameDay: number; message: string } {
  const live = notes.filter((note) => note.status !== "anulada")
    .sort((a, b) => `${noteDate(b)} ${b.recordedAt ?? ""}`.localeCompare(`${noteDate(a)} ${a.recordedAt ?? ""}`) || b.id - a.id);
  const display = (value: string) => value.split("-").reverse().join("-");
  if (target.type === "last") {
    const note = live[0] ?? null;
    return { note, sameDay: note ? live.filter((item) => noteDate(item) === noteDate(note)).length : 0, message: note ? "" : "Esta ficha no tiene evoluciones vigentes para anular." };
  }
  const matches = live.filter((note) => noteDate(note) === target.date);
  return { note: matches[0] ?? null, sameDay: matches.length, message: matches.length ? "" : `No hay una evolución vigente del ${display(target.date)} en esta ficha.` };
}

/** Fecha de hoy en Chile (AAAA-MM-DD). */
export const chileTodayIso = (now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
