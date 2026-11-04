/**
 * Chequeo de paciente: detecta si el dictado nombra a otra persona (o a otro RUT) que la ficha abierta.
 * Corre en el navegador con los datos de la ficha ya cargada: el nombre y el RUT no se envían a la IA.
 * No adivina: solo mira lo que sigue a «paciente», «señora», «don», «se llama», «RUT»…, y nunca a
 * «doctor/doctora» ni a las piezas.
 */

import { stripDictationFrame } from "./spoken.ts";
import { normalizeIdentityNumbers } from "./identity-numbers.ts";

export type PatientMention = { kind: "name" | "rut"; mentioned: string; quote: string };
/** variants: nombre del saludo que no es idéntico pero es una variante plausible del reconocimiento de voz (no alerta). */
export type PatientCheck = { mismatches: PatientMention[]; matches: PatientMention[]; variants?: PatientMention[] };

export const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Palabras que siguen a «paciente», «señora»… y no son un nombre.
const NOT_NAME = new Set(`
a al ante bajo con contra de del desde durante en entre hacia hasta para por segun sin sobre tras y e o u ni que quien cual como cuando donde
el la los las lo un una unos unas su sus mi mis este esta ese esa esto eso aquel aquella le les se me nos ya no si muy mas menos tambien solo
paciente pacientes senor senora senorita sr sra srta don dona nino nina joven adulto adulta mayor menor hombre mujer varon femenina masculino
refiere refirio relata relato indica indico dice dijo comenta comento senala senalo cuenta conto menciona manifiesta manifesto informa
presenta presento tiene tenia acude acudio llega llego viene vino asiste asistio consulta consulto viene ingresa ingreso vuelve volvio regresa
niega nego reporta queda quedo esta estaba estuvo fue es era sera seria siente sintio sufre padece toma tomo usa uso lleva trae pide pidio
desea quiere necesita requiere debe puede podria va iba sigue continua mantiene mejora empeora evoluciona responde tolera rechaza acepta
cancela cancelo paga pago abona abono firma firmo autoriza autorizo decia sentia sufria padecia referia queria podia debia habia hacia
pieza piezas diente dientes muela muelas molar molares premolar canino incisivo fdi cara caras mesial distal oclusal vestibular palatino
palatina lingual incisal cervical caries obturacion resina amalgama corona implante endodoncia exodoncia extraccion sondaje sangrado
control alta cita hoy manana ayer semana mes ano anos dias dia hora horas minutos
diabetico diabetica hipertenso hipertensa asmatico asmatica alergico alergica embarazada fumador fumadora cardiopata epileptico epileptica
anticoagulado anticoagulada nervioso nerviosa ansioso ansiosa tranquilo tranquila colaborador colaboradora pediatrico pediatrica
nuevo nueva antiguo antigua habitual frecuente ambulatorio ambulatoria sano sana estable inestable dolor sensible sensibilidad
`.split(/\s+/).filter(Boolean));

// Sufijos de adjetivos o verbos en minúscula (un apellido dictado en minúscula con estas terminaciones se pierde; se prefiere no alarmar).
const ADJECTIVE = /(?:ico|ica|icos|icas|tivo|tiva|ente|ante|oso|osa|mente|cion|sion|ado|ada|ido|ida|aba|ian)$/

export const TRIGGER = /(?<![\p{L}\d])(?:(?:el|la|al|del|a\s+la)\s+)?(?:paciente|sr\.?|sra\.?|srta\.?|se[nñ]or(?:ita)?|se[nñ]ora|don|do[nñ]a|nombre(?:\s+del?\s+paciente)?(?:\s+es)?|se\s+llama|llamad[oa])\s*[:,]?\s+/giu;
export const BLOCK_BEFORE = /(?:doctor|doctora|dr\.?|dra\.?|odont[oó]log[oa]|asistente|colega|derivad[oa]\s+por)\s*$/iu;

export function nameTokensAfter(text: string, start: number): { tokens: string[]; raw: string } {
  const rest = text.slice(start, start + 80);
  const words = rest.split(/\s+/);
  const tokens: string[] = [];
  const raw: string[] = [];
  for (const word of words) {
    const clean = word.replace(/^[«"'(]+/, "");
    const bare = clean.replace(/[.,;:!?»"')]+$/, "");
    if (!bare || !/^\p{L}[\p{L}'-]*$/u.test(bare)) break;
    const folded = fold(bare);
    if (NOT_NAME.has(folded)) break;
    const capital = /^\p{Lu}/u.test(bare);
    if (!capital && (folded.length < 3 || ADJECTIVE.test(folded))) break;
    if (folded.length < 2) break;
    tokens.push(folded);
    raw.push(bare);
    if (bare !== clean || tokens.length >= 4) break; // puntuación o nombre largo: termina
  }
  return { tokens, raw: raw.join(" ") };
}

function matchesPatient(tokens: string[], patientName: string): boolean {
  const own = fold(patientName).split(/[^a-z']+/).filter((token) => token.length >= 2);
  if (!own.length) return false;
  // Cada nombre dicho debe estar en la ficha; basta parte del nombre («la señora González»)
  // y se acepta una abreviatura («Gonz» por «González»). «María López» con ficha «María José González» alerta.
  return tokens.every((token) => own.some((part) => part === token || (token.length >= 4 && part.startsWith(token)) || (part.length >= 4 && token.startsWith(part))));
}

const CONNECTOR = new Set(["de", "del", "la", "las", "los", "y", "e", "san", "santa"]);

function distance(a: string, b: string): number {
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

/** Parecido 0..1 entre dos palabras ya sin acentos (1 = iguales). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if ((a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))) return 0.9;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

/**
 * ¿El nombre oído en el saludo es la ficha abierta mal reconocida? («Marcela del Pilar de seguidor Pizaña» por
 * «Marcela del Pilar Acevedo Cisterna»). Exige el primer nombre (o uno muy parecido) y la mitad de las palabras.
 */
export function nameVariantOf(spoken: string, patientName: string): "same" | "variant" | "different" {
  const said = fold(spoken).split(/[^a-z']+/).filter((token) => token.length >= 2 && !CONNECTOR.has(token));
  const own = fold(patientName).split(/[^a-z']+/).filter((token) => token.length >= 2 && !CONNECTOR.has(token));
  if (!said.length || !own.length) return "different";
  const best = said.map((token) => Math.max(...own.map((part) => similarity(token, part))));
  if (best.every((score) => score >= 0.9)) return "same";
  const close = best.filter((score) => score >= 0.7).length;
  const first = Math.max(...own.slice(0, 2).map((part) => similarity(said[0], part)));
  return first >= 0.75 && close >= Math.max(Math.min(2, said.length), Math.ceil(said.length / 2)) ? "variant" : "different";
}

export const normalizeRut = (rut: string) => rut.replace(/[^0-9kK]/g, "").toUpperCase();

/** RUT con dígito verificador válido (módulo 11). */
export function validRut(rut: string): boolean {
  const clean = normalizeRut(rut);
  if (clean.length < 7 || clean.length > 9) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const expected = 11 - (sum % 11);
  return dv === (expected === 11 ? "0" : expected === 10 ? "K" : String(expected));
}

export const RUT_PATTERN = /(?<![\d.])(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}\s?-\s?[\dkK])(?![\dkK])|(?:\b(?:rut|run)\b|\bR\.?U\.?[TN]\.?)\s*(?:es|n[uú]mero|:)?\s*([\d.\s]{7,12}(?:\s?-?\s?[\dkK])?)/giu;

function clip(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 20);
  const to = Math.min(text.length, index + length + 20);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/**
 * Compara los nombres y RUT del dictado con el paciente de la ficha abierta.
 * Un nombre que no coincide (sin acentos ni mayúsculas; basta parte del nombre, pero cada palabra dicha debe estar en la ficha) es una alerta.
 */
export function checkPatientMentions(text: string, patient: { name: string; rut?: string | null }): PatientCheck {
  const normalizedText = normalizeIdentityNumbers(text).text;
  const mismatches: PatientMention[] = [];
  const matches: PatientMention[] = [];
  const variants: PatientMention[] = [];
  const seen = new Set<string>();
  // «Quiero evolucionar la ficha de <nombre>»: el nombre del saludo se compara con tolerancia a errores de voz.
  const frame = stripDictationFrame(normalizedText);
  if (frame.spokenName && patient.name) {
    const mention: PatientMention = { kind: "name", mentioned: frame.spokenName, quote: clip(normalizedText, 0, frame.nameEnd) };
    const verdict = nameVariantOf(frame.spokenName, patient.name);
    (verdict === "same" ? matches : verdict === "variant" ? variants : mismatches).push(mention);
  }
  for (const match of normalizedText.matchAll(TRIGGER)) {
    const index = match.index ?? 0;
    if (index < frame.nameEnd) continue;
    if (BLOCK_BEFORE.test(normalizedText.slice(Math.max(0, index - 25), index))) continue;
    const { tokens, raw } = nameTokensAfter(normalizedText, index + match[0].length);
    if (!tokens.length) continue;
    const key = `name:${tokens.join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mention: PatientMention = { kind: "name", mentioned: raw, quote: clip(normalizedText, index, match[0].length + raw.length) };
    (matchesPatient(tokens, patient.name) ? matches : mismatches).push(mention);
  }
  const own = normalizeRut(patient.rut ?? "");
  for (const match of normalizedText.matchAll(RUT_PATTERN)) {
    const value = (match[1] ?? match[2] ?? "").trim();
    const clean = normalizeRut(value);
    if (clean.length < 7) continue;
    const key = `rut:${clean}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mention: PatientMention = { kind: "rut", mentioned: value, quote: clip(normalizedText, match.index ?? 0, match[0].length) };
    // Sin el dígito verificador dictado se compara solo el cuerpo.
    const same = own && (own === clean || (match[2] && own.slice(0, -1) === clean));
    (same ? matches : mismatches).push(mention);
  }
  return { mismatches, matches, ...(variants.length ? { variants } : {}) };
}

/** Nota informativa (no alerta) cuando el nombre del saludo se tomó como variante de la ficha abierta. */
export function patientVariantNote(check: PatientCheck, patientName: string): string[] {
  return (check.variants ?? []).map((item) => `Se oyó «${item.mentioned}»; se tomó como ${patientName} (parece un error del reconocimiento de voz).`);
}

/** Texto del aviso para la revisión. */
export function patientWarning(check: PatientCheck, patientName: string, patientRut?: string | null): string[] {
  return check.mismatches.map((item) => item.kind === "name"
    ? `El dictado nombra a «${item.mentioned}», que no coincide con la ficha abierta (${patientName}): «${item.quote}».`
    : patientRut
      ? `El dictado menciona el RUT ${item.mentioned}, distinto del de la ficha abierta: «${item.quote}».`
      : `El dictado menciona el RUT ${item.mentioned} y la ficha abierta no tiene RUT para comprobarlo: «${item.quote}».`);
}
