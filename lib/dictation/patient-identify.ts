/**
 * Identificación del paciente en un dictado hecho desde Inicio.
 * Todo corre en código (servidor): la IA nunca recibe la lista de pacientes ni sus datos;
 * solo el texto dictado va a la IA, en un paso posterior y ya dentro de la ficha elegida.
 */
import { BLOCK_BEFORE, fold, normalizeRut, RUT_PATTERN, validRut } from "./patient-check.ts";
import { normalizeIdentityNumbers } from "./identity-numbers.ts";

export type DictatedIdentity = {
  name: string | null;
  rut: string | null;
  rutValid: boolean;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  newPatientHint: boolean;
  quotes: string[];
};

export type StoredPatient = { id: number; name: string; rut?: string | null; birthDate?: string | null };

export type PatientCandidate = { id: number; name: string; rut: string | null; score: number; reason: string };

export type PatientDecision = {
  decision: "existing" | "new" | "ambiguous" | "unknown";
  suggestedPatientId: number | null;
  candidates: PatientCandidate[];
  identity: DictatedIdentity;
  explanation: string;
};

const CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "san", "santa", "van", "von", "mc"]);
// Palabras que cortan el nombre (además de la puntuación).
const STOP = new Set(`
rut run carnet cedula numero fecha nacimiento nacido nacida edad anos ano telefono celular fono correo mail email
que quien con sin por para en el la los las un una tiene tenia viene vino llega acude consulta refiere presenta y e o
paciente nuevo nueva primera vez hoy control dolor pieza piezas diente muela se le lo es esta fue
pon pone poner escribe escribir anota deja dejar elimina borra anula reemplaza cambia solamente solo
`.split(/\s+/).filter(Boolean));

// Dónde suele empezar el nombre de quien consulta.
const NAME_CUE = /(?<![\p{L}\d])(?:(?:tengo|hay|llega|lleg[oó]|viene|vino|ingresa|ingres[oó]|atend[ií]|atiendo|registra|registrar|crea|crear|anota|anotar)\s+(?:a\s+)?(?:un[ao]?\s+|el\s+|la\s+)?)?(?:(?:paciente|pacienta)(?:\s+nuev[oa])?|nuev[oa]\s+paciente|se[nñ]ora|se[nñ]orita|se[nñ]or|sra\.?|sr\.?|srta\.?|don|do[nñ]a|ni[nñ][oa])\s*(?:,\s*|:\s*)?(?:(?:que\s+)?se\s+llama|de\s+nombre|llamad[oa]|nombre)?\s*[:,]?\s*|(?:(?:que\s+)?se\s+llama|de\s+nombre|nombre(?:\s+(?:del?\s+)?paciente)?(?:\s+es)?|llamad[oa])\s*[:,]?\s+/giu;

const NEW_HINT = /(?<!\p{L})(?:paciente\s+nuev[oa]|nuev[oa]\s+paciente|pacient[ea]\s+de\s+primera\s+vez|primera\s+(?:vez|consulta|visita)|(?:crear|crea|cree|abrir|abre|hacer|haz)\s+(?:una\s+|la\s+)?(?:ficha|paciente)|ficha\s+nueva|nunca\s+(?:ha|había)\s+venido|no\s+tiene\s+ficha)(?!\p{L})/iu;

const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

function titleCase(word: string): string {
  const lower = word.toLocaleLowerCase("es-CL");
  return CONNECTORS.has(fold(lower)) ? lower : lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

/** Texto dictado con «guion»/«raya» y «arroba» convertidos para leer RUT y correo. */
function spokenSymbols(text: string): string {
  return text
    // «root» suele ser un error de reconocimiento de «RUT» cuando precede a un número.
    .replace(/(?<!\p{L})root(?=\s*(?:(?:es|n[uú]mero|numero)\s*)?[:,.-]?\s*\d)/giu, "RUT")
    .replace(/\s*(?:gui[oó]n|raya)\s*(?=[\dkK]\b)/giu, "-")
    // Reconoce correos dictados («luis punto rodriguez arroba gmail punto com»).
    .replace(/((?:[\p{L}\p{N}_-]+\s+punto\s+){1,4}[\p{L}\p{N}_-]+)\s+arroba\s+([\p{L}\p{N}-]+(?:\s+punto\s+[\p{L}\p{N}-]+)+)/giu,
      (_match, local: string, domain: string) => local.replace(/\s+punto\s+/giu, ".") + "@" + domain.replace(/\s+punto\s+/giu, "."))
    .replace(/\s+arroba\s+/giu, "@")
    .replace(/(@[\w-]+)\s+punto\s+(\w+)/giu, "$1.$2");
}

function extractName(text: string): { name: string; quote: string } | null {
  for (const match of text.matchAll(NAME_CUE)) {
    const index = match.index ?? 0;
    if (BLOCK_BEFORE.test(text.slice(Math.max(0, index - 25), index))) continue;
    const explicitNameCue = /(?:se\s+llama|nombre|llamad[oa]|pacient[ea]\s+nuev[oa])/iu.test(match[0]);
    const rest = text.slice(index + match[0].length, index + match[0].length + 90);
    const words = rest.split(/\s+/);
    const parts: string[] = [];
    for (const word of words) {
      const clean = word.replace(/^[«"'(]+/, "");
      const bare = clean.replace(/[.,;:!?»"')]+$/, "");
      if (!bare || !/^\p{L}[\p{L}'-]*$/u.test(bare)) break;
      const folded = fold(bare);
      if (CONNECTORS.has(folded) && parts.length) { parts.push(bare); if (bare !== clean) break; continue; }
      if (STOP.has(folded) || folded.length < 2) break;
      const capital = /^\p{Lu}/u.test(bare);
      // «Acevedo y pon solamente…»: tras «y» solo sigue el nombre si viene con mayúscula.
      if (!capital && parts.length && fold(parts[parts.length - 1]) === "y") break;
      // Sin mayúscula solo se acepta como continuación de un nombre ya empezado con mayúscula.
      if (!capital && !parts.some((part) => /^\p{Lu}/u.test(part)) && !explicitNameCue) break;
      if (!capital && /(?:ico|ica|ente|ante|oso|osa|mente|cion|ado|ada|ido|ida)$/.test(folded)) break;
      parts.push(bare);
      if (bare !== clean || parts.length >= 6) break;
    }
    while (parts.length && CONNECTORS.has(fold(parts[parts.length - 1]))) parts.pop();
    if (parts.filter((part) => !CONNECTORS.has(fold(part))).length >= 1) {
      return { name: parts.map(titleCase).join(" "), quote: `${match[0]}${parts.join(" ")}`.trim() };
    }
  }
  return null;
}

function formatRut(clean: string): string {
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

function extractRut(text: string): { rut: string; valid: boolean; quote: string } | null {
  let fallback: { rut: string; valid: boolean; quote: string } | null = null;
  for (const match of text.matchAll(RUT_PATTERN)) {
    const clean = normalizeRut(match[1] ?? match[2] ?? "");
    if (clean.length < 7 || clean.length > 9) continue;
    const found = { rut: formatRut(clean), valid: validRut(clean), quote: match[0].trim() };
    if (found.valid) return found;
    fallback ??= found;
  }
  return fallback;
}

function extractBirthDate(text: string): string | null {
  const folded = fold(text);
  const cue = "(?:naci(?:do|da|o)|fecha\\s+de\\s+nacimiento|nacimiento)\\s*(?:es|el|:)?\\s*(?:el\\s+)?";
  const spoken = new RegExp(`${cue}(\\d{1,2})\\s+de\\s+(${Object.keys(MONTHS).join("|")})\\s+(?:de|del)\\s+(\\d{4})`).exec(folded);
  const numeric = new RegExp(`${cue}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})`).exec(folded);
  const parts = spoken ? [Number(spoken[1]), MONTHS[spoken[2]], Number(spoken[3])] : numeric ? [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])] : null;
  if (!parts) return null;
  const [day, month, year] = parts;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

const SPOKEN_PHONE_DIGITS: Record<string, string> = {
  cero: "0", zero: "0", un: "1", uno: "1", una: "1", dos: "2", tres: "3",
  cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
};

function extractPhone(text: string): string | null {
  const match = /(?:tel[eé]fono|celular|fono|whatsapp)\s*(?:es|:|n[uú]mero)?\s*((?:\+?\s?56\s?)?(?:\d[\s.-]?){8,9})/iu.exec(text);
  if (match) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length >= 8) return match[1].trim().startsWith("+") ? `+${digits}` : digits;
  }

  // Algunos dictados conservan el teléfono como palabras separadas: «nueve uno…».
  const cue = /(?:tel[eé]fono|celular|fono|whatsapp)\s*(?:es|:|n[uú]mero)?\s*/giu;
  for (const marker of text.matchAll(cue)) {
    const rest = text.slice((marker.index ?? 0) + marker[0].length).split(/[.!?;\n]/, 1)[0];
    const digits: string[] = [];
    for (const token of rest.trim().split(/[\s,.-]+/).slice(0, 15)) {
      const word = fold(token);
      if (/^\d+$/.test(word)) digits.push(word);
      else if (Object.prototype.hasOwnProperty.call(SPOKEN_PHONE_DIGITS, word)) digits.push(SPOKEN_PHONE_DIGITS[word]);
      else break;
    }
    const joined = digits.join("");
    if (joined.length >= 8 && joined.length <= 12) return joined;
  }
  return null;
}

function extractEmail(text: string): string | null {
  return /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u.exec(text)?.[0].replace(/\.$/, "").toLowerCase() ?? null;
}

export function extractIdentity(transcript: string): DictatedIdentity {
  const text = normalizeIdentityNumbers(spokenSymbols(transcript)).text;
  const name = extractName(text);
  const rut = extractRut(text);
  const quotes = [name?.quote, rut?.quote].filter((item): item is string => Boolean(item));
  return {
    name: name?.name ?? null,
    rut: rut?.rut ?? null,
    rutValid: rut?.valid ?? false,
    birthDate: extractBirthDate(text),
    phone: extractPhone(text),
    email: extractEmail(text),
    newPatientHint: NEW_HINT.test(fold(text)),
    quotes,
  };
}

function editDistance(a: string, b: string): number {
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

const nameTokens = (value: string) => fold(value).split(/[^a-z']+/).filter((token) => token.length >= 2 && !CONNECTORS.has(token));

function tokenMatches(spoken: string, stored: string): boolean {
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

type SpokenToken = { folded: string; raw: string; start: number; end: number };

function spokenTokens(text: string): SpokenToken[] {
  return [...text.matchAll(/\p{L}[\p{L}'-]*/gu)].map((match) => ({ folded: fold(match[0]), raw: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
}

export type NameMention = { patientId: number; score: number; span: string; start: number };

/**
 * Busca los nombres de las fichas en CUALQUIER parte del dictado (no solo tras «paciente»):
 * recorre la transcripción y alinea, en orden, los nombres y apellidos de cada ficha.
 * Tolera tildes/mayúsculas, segundo nombre o apellido omitido, «del Pilar», palabras de relleno
 * y una letra mal oída. Exige al menos dos partes del nombre cerca una de otra.
 */
export function findNameMentions(transcript: string, patients: StoredPatient[]): NameMention[] {
  const tokens = spokenTokens(transcript);
  const mentions: NameMention[] = [];
  for (const patient of patients) {
    const own = nameTokens(patient.name);
    if (own.length < 2) continue;
    // En Chile los dos últimos son apellidos; lo anterior, nombres de pila.
    const surnameFrom = own.length >= 3 ? own.length - 2 : 1;
    let best: NameMention | null = null;
    for (let i = 0; i < tokens.length; i += 1) {
      const firstOwn = own.findIndex((part) => tokenMatches(tokens[i].folded, part));
      if (firstOwn < 0 || CONNECTORS.has(tokens[i].folded)) continue;
      if (BLOCK_BEFORE.test(transcript.slice(Math.max(0, tokens[i].start - 25), tokens[i].start))) continue;
      const matched = [firstOwn];
      let last = i;
      let next = firstOwn + 1;
      for (let j = i + 1; j < tokens.length && j - last <= 2 && next < own.length; j += 1) {
        if (CONNECTORS.has(tokens[j].folded)) continue;
        const hit = own.slice(next).findIndex((part) => tokenMatches(tokens[j].folded, part));
        if (hit >= 0) { matched.push(next + hit); next += hit + 1; last = j; }
      }
      if (matched.length < 2) continue;
      const given = matched.filter((index) => index < surnameFrom).length;
      const surnames = matched.length - given;
      const coverage = matched.length / own.length;
      const score = given && surnames ? Math.min(1, 0.95 + 0.05 * coverage) : surnames >= 2 ? 0.9 : 0.6;
      if (!best || score > best.score) best = { patientId: patient.id, score: Math.round(score * 100) / 100, span: transcript.slice(tokens[i].start, tokens[last].end), start: tokens[i].start };
    }
    if (best) mentions.push(best);
  }
  return mentions.sort((a, b) => b.score - a.score);
}

/**
 * Decide en código a qué ficha va el dictado: RUT primero, luego parecido de nombre.
 * Nunca crea nada: solo propone; crear un paciente exige un toque de confirmación en la app.
 */
export function decidePatient(transcript: string, patients: StoredPatient[]): PatientDecision {
  const identity = extractIdentity(transcript);
  const candidates = new Map<number, PatientCandidate>();
  const add = (patient: StoredPatient, score: number, reason: string) => {
    const current = candidates.get(patient.id);
    if (!current || current.score < score) candidates.set(patient.id, { id: patient.id, name: patient.name, rut: patient.rut ? formatRut(normalizeRut(patient.rut)) : null, score, reason });
  };
  const rutClean = identity.rut ? normalizeRut(identity.rut) : "";
  let rutHit: StoredPatient | undefined;
  if (rutClean) {
    rutHit = patients.find((patient) => patient.rut && normalizeRut(patient.rut) === rutClean);
    if (rutHit) add(rutHit, 1, "El RUT dictado coincide con esta ficha");
  }
  const mentions = findNameMentions(transcript, patients);
  if (!identity.name && mentions.length) {
    // Nombre dicho a mitad de frase («elimina el dictado de Marcela Acevedo…»).
    identity.name = mentions[0].span.split(/\s+/).map(titleCase).join(" ");
    identity.quotes.unshift(mentions[0].span);
  }
  for (const mention of mentions) {
    const patient = patients.find((item) => item.id === mention.patientId);
    if (!patient) continue;
    const rutConflict = rutClean && patient.rut && normalizeRut(patient.rut) !== rutClean;
    add(patient, rutConflict ? Math.min(mention.score, 0.5) : mention.score, rutConflict ? "Nombre parecido, pero con otro RUT" : mention.score >= 0.95 ? `Se nombró en el dictado («${mention.span}»)` : "Nombre parecido en el dictado");
  }
  if (identity.name) {
    for (const patient of patients) {
      const score = nameSimilarity(identity.name, patient.name);
      if (score >= 0.5) {
        const rutConflict = rutClean && patient.rut && normalizeRut(patient.rut) !== rutClean;
        add(patient, rutConflict ? Math.min(score, 0.5) : score, rutConflict ? "Nombre parecido, pero con otro RUT" : score >= 0.99 ? "Nombre igual o casi igual" : "Nombre parecido");
      }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es")).slice(0, 5);
  const top = ranked[0];
  const strong = ranked.filter((item) => item.score >= 0.95);
  const base = { identity, candidates: ranked };
  if (rutHit) {
    const nameOk = !identity.name || nameSimilarity(identity.name, rutHit.name) >= 0.5;
    return { ...base, decision: "existing", suggestedPatientId: rutHit.id, explanation: identity.newPatientHint ? `Dijiste que es un paciente nuevo, pero el RUT ${identity.rut} ya es de ${rutHit.name}: se usará esa ficha (no se duplica).` : nameOk ? `El RUT ${identity.rut} es de ${rutHit.name}.` : `El RUT ${identity.rut} es de ${rutHit.name}, pero el nombre dictado («${identity.name}») no coincide: confirma antes de seguir.` };
  }
  if (strong.length === 1 && !identity.newPatientHint && !(rutClean && identity.rutValid)) {
    return { ...base, decision: "existing", suggestedPatientId: strong[0].id, explanation: `El nombre dictado («${identity.name}») coincide con ${strong[0].name}.` };
  }
  if (top && top.score >= 0.5) {
    const why = identity.newPatientHint ? "Dijiste que es un paciente nuevo, pero ya hay fichas con un nombre parecido." : rutClean ? "El RUT dictado no está en ninguna ficha, pero hay nombres parecidos." : strong.length > 1 ? "Hay más de una ficha con ese nombre." : "El nombre se parece a una ficha, pero no es igual.";
    return { ...base, decision: "ambiguous", suggestedPatientId: identity.newPatientHint || rutClean || (ranked[1] && ranked[1].score === top.score) ? null : top.id, explanation: `${why} Elige la ficha o crea un paciente nuevo.` };
  }
  if (identity.name || rutClean || identity.newPatientHint) {
    return { ...base, decision: "new", suggestedPatientId: null, explanation: identity.name || rutClean ? "No hay ninguna ficha con ese RUT ni con ese nombre: se propone crear un paciente nuevo." : "Dijiste que es un paciente nuevo, pero no se entendió el nombre: escríbelo para crear la ficha." };
  }
  return { ...base, decision: "unknown", suggestedPatientId: null, explanation: "No se nombró al paciente ni su RUT. Elige la ficha o crea un paciente nuevo." };
}
