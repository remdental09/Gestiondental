/**
 * Identificación del paciente en un dictado hecho desde Inicio.
 * Todo corre en código (servidor): la IA nunca recibe la lista de pacientes ni sus datos;
 * solo el texto dictado va a la IA, en un paso posterior y ya dentro de la ficha elegida.
 */
import { BLOCK_BEFORE, fold, normalizeRut, RUT_PATTERN, validRut } from "./patient-check.ts";

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
    .replace(/\s*(?:gui[oó]n|raya)\s*(?=[\dkK]\b)/giu, "-")
    .replace(/\s+arroba\s+/giu, "@")
    .replace(/(@[\w-]+)\s+punto\s+(\w+)/giu, "$1.$2");
}

function extractName(text: string): { name: string; quote: string } | null {
  for (const match of text.matchAll(NAME_CUE)) {
    const index = match.index ?? 0;
    if (BLOCK_BEFORE.test(text.slice(Math.max(0, index - 25), index))) continue;
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
      // Sin mayúscula solo se acepta como continuación de un nombre ya empezado con mayúscula.
      if (!capital && !parts.some((part) => /^\p{Lu}/u.test(part))) break;
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

function extractPhone(text: string): string | null {
  const match = /(?:tel[eé]fono|celular|fono|whatsapp)\s*(?:es|:|n[uú]mero)?\s*((?:\+?\s?56\s?)?(?:\d[\s.-]?){8,9})/iu.exec(text);
  if (!match) return null;
  const digits = match[1].replace(/\D/g, "");
  return digits.length >= 8 ? (match[1].trim().startsWith("+") ? `+${digits}` : digits) : null;
}

function extractEmail(text: string): string | null {
  return /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u.exec(text)?.[0].replace(/\.$/, "").toLowerCase() ?? null;
}

export function extractIdentity(transcript: string): DictatedIdentity {
  const text = spokenSymbols(transcript);
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
