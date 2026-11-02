/**
 * Léxico odontológico para corregir lo que el dictado oyó mal: un mapa de confusiones típicas del
 * reconocimiento de voz («traje supergival» → «destartraje supragingival», «6ectontes» → «6 sextantes»)
 * y una búsqueda fonética prudente contra el léxico. Solo cambia palabras: nunca agrega datos clínicos.
 * Sin dependencias (no importa spoken.ts) para poder usarse desde ahí.
 */
import { DENTAL_TERM_SOURCES, type DentalCategory } from "./dental-terms.ts";
import { SPANISH_NEAR_DENTAL } from "./spanish-near-dental.ts";

export type LexiconCorrection = { original: string; corrected: string; reason: string };

const foldText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---------- Términos y formas ----------
export type DentalTerm = { term: string; category: DentalCategory };

export const DENTAL_TERMS: DentalTerm[] = (() => {
  const seen = new Set<string>();
  const out: DentalTerm[] = [];
  for (const [category, source] of Object.entries(DENTAL_TERM_SOURCES) as Array<[DentalCategory, string]>) {
    for (const raw of source.split(/[,\n]/)) {
      const term = raw.trim().replace(/\s+/g, " ");
      if (!term || seen.has(foldText(term))) continue;
      seen.add(foldText(term));
      out.push({ term, category });
    }
  }
  return out;
})();

const ACUTE: Record<string, string> = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u" };
/** Plural de una palabra española (sin tocar siglas ni nombres propios). */
export function pluralOf(word: string): string | null {
  if (word.length < 4 || /[A-Z]{2}|\d/.test(word) || /[sx]$/i.test(word)) return null;
  if (/[aeiouáéó]$/i.test(word)) return `${word}s`;
  if (/z$/i.test(word)) return `${word.slice(0, -1)}ces`;
  if (/[íú]$/i.test(word)) return `${word}es`;
  if (/[nlrdj]$/i.test(word)) {
    // «obturación» → «obturaciones»: la tilde de la última sílaba desaparece en el plural.
    const m = word.match(/^(.*)([áéíóú])([^aeiouáéíóú]*)$/i);
    if (m && /n$/i.test(word)) return `${m[1]}${ACUTE[m[2].toLowerCase()] ?? m[2]}${m[3]}es`;
    return `${word}es`;
  }
  return null;
}
/** Variante de género para adjetivos clínicos («palatino» ↔ «palatina», «fracturado» ↔ «fracturada»). */
function genderOf(word: string): string | null {
  const m = word.match(/^(.*(?:ad|id|ic|in|os|iv|ari|ic|tic|al|ic))([oa])$/i);
  if (!m || word.length < 6) return null;
  return `${m[1]}${m[2].toLowerCase() === "o" ? "a" : "o"}`;
}

/** Todas las palabras del léxico (con plurales y género), plegadas → forma escrita correcta. */
export const DENTAL_WORDS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const add = (word: string) => {
    const k = foldText(word);
    if (k.length < 2 || map.has(k)) return;
    map.set(k, word);
  };
  for (const { term } of DENTAL_TERMS) {
    for (const word of term.split(/[\s\-/]+/)) {
      if (!/^[\p{L}]+$/u.test(word)) continue;
      add(word);
      const plural = pluralOf(word); if (plural) add(plural);
      const other = genderOf(word); if (other) { add(other); const p2 = pluralOf(other); if (p2) add(p2); }
    }
  }
  return map;
})();

/** Términos de varias palabras (para el glosario y la cuenta del léxico). */
export const lexiconStats = () => ({ terms: DENTAL_TERMS.length, wordForms: DENTAL_WORDS.size, confusions: CONFUSIONS.length });

// ---------- Clave fonética del español ----------
/**
 * Clave fonética del español de Chile: sin tildes, b=v, c/z/s ante e/i, k=c=qu, j=g ante e/i, ll=y,
 * h muda, x=ks y letras dobles reducidas. «supergival» y «superjibal» dan la misma clave.
 */
export function phoneticKey(word: string): string {
  let w = foldText(word).replace(/[^a-zñ]/g, "").replace(/ñ/g, "N");
  w = w.replace(/ch/g, "C").replace(/ph/g, "f").replace(/sh/g, "C").replace(/h/g, "")
    .replace(/qu(?=[ei])/g, "k").replace(/gu(?=[ei])/g, "g").replace(/gü/g, "gu")
    .replace(/sc(?=[ei])/g, "s").replace(/c(?=[ei])/g, "s").replace(/c/g, "k").replace(/q/g, "k")
    .replace(/g(?=[ei])/g, "j").replace(/ll/g, "y").replace(/y(?![aeiou])/g, "i")
    .replace(/z/g, "s").replace(/^x/, "s").replace(/x/g, "ks").replace(/v/g, "b").replace(/w/g, "b");
  return w.replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (next[j] < best) best = next[j];
    }
    if (best > max) return max + 1;
    row = next;
  }
  return row[b.length];
}
export const phoneticDistance = (a: string, b: string) => levenshtein(phoneticKey(a), phoneticKey(b));

type Entry = { folded: string; written: string; key: string };
const ENTRIES: Entry[] = [...DENTAL_WORDS].filter(([folded]) => folded.length >= 5)
  .map(([folded, written]) => ({ folded, written, key: phoneticKey(written) }));
const BY_KEY = new Map<string, Entry[]>();
for (const entry of ENTRIES) { const list = BY_KEY.get(entry.key) ?? []; list.push(entry); BY_KEY.set(entry.key, list); }
const BY_INITIAL = new Map<string, Entry[]>();
for (const entry of ENTRIES) { const list = BY_INITIAL.get(entry.key[0]) ?? []; list.push(entry); BY_INITIAL.set(entry.key[0], list); }

/** Distancia fonética máxima aceptada según el largo: corta = 1, larga = 2. */
export const fuzzyLimit = (keyLength: number) => (keyLength >= 9 ? 2 : 1);

/** Término del léxico más parecido a una palabra, solo si es único y suficientemente cercano. */
export function nearestDentalWord(word: string): { written: string; distance: number } | null {
  const k = phoneticKey(word);
  if (k.length < 5) return null;
  const exact = BY_KEY.get(k);
  if (exact) return uniqueWritten(exact) ? { written: exact[0].written, distance: 0 } : null;
  const limit = fuzzyLimit(k.length);
  let best: Entry[] = [], bestD = limit + 1;
  for (const entry of BY_INITIAL.get(k[0]) ?? []) {
    if (Math.abs(entry.key.length - k.length) > limit) continue;
    const d = levenshtein(k, entry.key, limit);
    if (d < bestD) { bestD = d; best = [entry]; }
    else if (d === bestD) best.push(entry);
  }
  if (bestD > limit || !best.length || !uniqueWritten(best)) return null;
  return { written: best[0].written, distance: bestD };
}
const uniqueWritten = (list: Entry[]) => new Set(list.map(e => e.folded)).size === 1;

/** ¿Es una palabra del léxico odontológico (cualquier forma)? */
export const isDentalWord = (word: string) => DENTAL_WORDS.has(foldText(word));

// ---------- Mapa de confusiones del dictado ----------
const B = "(?<![\\p{L}\\d])";
const E = "(?![\\p{L}\\d])";
const rx = (source: string) => new RegExp(`${B}${source}${E}`, "giu");
const GINGIVAL = "(?:g|j|y)(?:i|e)n?(?:g|j|y)?(?:i|e)?(?:v|b)al";
const PROCEDURE_VERB = "(?:realiz\\p{L}*|hace|hacer|hizo|hará|efect[uú]\\p{L}*|indic\\p{L}*|necesita\\p{L}*|requiere\\p{L}*|requerir\\p{L}*|program\\p{L}*|inici\\p{L}*|termin\\p{L}*|complet\\p{L}*|continu\\p{L}*|sugiere|recomienda\\p{L}*|planific\\p{L}*)";

/** [patrón, reemplazo, motivo]. Va de lo más específico a lo más general. */
export const CONFUSIONS: Array<[RegExp, string, string]> = [
  // Destartraje
  [rx("(?:des\\s?tar\\s?t?raje|destar\\s?t?raje|des\\s?traje|desta\\s?traje|de\\s?star\\s?traje|des\\s?tartraje|destart\\s?raje|destartr?age|destrartaje|destartaje|desartraje|dextartraje|destratraje|destartrajes?)"), "destartraje", "término dental: destartraje"],
  [new RegExp(`${B}traje(?=[\\s,]+(?:\\p{L}+\\s+){0,1}(?:s[uoú]p\\p{L}{0,3}|s[uú][bv]|infra)?\\s?-?${GINGIVAL})`, "giu"), "destartraje", "término dental: destartraje"],
  [new RegExp(`(?<=${B}${PROCEDURE_VERB}\\s+(?:(?:un|el|de|del|con|nuevo|nuevamente)\\s+)?)traje${E}`, "giu"), "destartraje", "término dental: destartraje"],
  // Supra / subgingival
  [rx(`s[uoú]p(?:ra|re|er|ar|r|a|e)?\\s?-?${GINGIVAL}(es)?`), "supragingival$1", "término dental: supragingival"],
  [rx(`s[uú](?:b|v)\\s?-?${GINGIVAL}(es)?`), "subgingival$1", "término dental: subgingival"],
  [rx(`muco\\s?-?${GINGIVAL}(es)?`), "mucogingival$1", "término dental: mucogingival"],
  [rx("(?:g|j)in(?:g|j)i(?:v|b)al(es)?"), "gingival$1", "término dental: gingival"],
  [rx("(?:g|j)in(?:g|j)i(?:v|b)itis"), "gingivitis", "término dental: gingivitis"],
  [rx("(?:g|j)in(?:g|j)i(?:v|b)ec?\\s?tom[ií]a"), "gingivectomía", "término dental: gingivectomía"],
  [rx("(?:g|j)in(?:g|j)i(?:v|b)o\\s?plast[ií]a"), "gingivoplastía", "término dental: gingivoplastía"],
  // Sextantes y cuadrantes
  [new RegExp(`${B}(\\d)\\s?(?:s|c|x)?e(?:c|k|x|s)?s?t[aoó]n?t(?:e|i)s${E}`, "giu"), "$1 sextantes", "término dental: sextantes"],
  [rx("se[xcsk]{1,2}\\s?t[aoó]n\\s?t(?:e|i)s"), "sextantes", "término dental: sextantes"],
  [rx("se[xcsk]{1,2}\\s?t[aoó]n\\s?te"), "sextante", "término dental: sextante"],
  [rx("(seis|6)\\s+grupos\\s+dentales"), "$1 sextantes", "término dental: los seis grupos dentarios son los sextantes"],
  [rx("cu[ao]n?\\s?drantes"), "cuadrantes", "término dental: cuadrantes"],
  [rx("cu[ao]n?\\s?drante"), "cuadrante", "término dental: cuadrante"],
  // -doncia y especialidades
  [rx("(endo|exo|orto|perio)\\s?d[oó]n[cs]ia"), "$1doncia", "término dental"],
  [rx("e[sx]\\s?o\\s?d[oó]n[cs]ia"), "exodoncia", "término dental: exodoncia"],
  [rx("odonto\\s?pediatr[ií]a"), "odontopediatría", "término dental: odontopediatría"],
  [rx("perio\\s?don\\s?titis"), "periodontitis", "término dental: periodontitis"],
  [rx("peri\\s?-?\\s?implantitis"), "periimplantitis", "término dental: periimplantitis"],
  [rx("peri\\s?coronaritis"), "pericoronaritis", "término dental: pericoronaritis"],
  [rx("(?:ó|o)seo\\s?-?\\s?integraci[oó]n"), "oseointegración", "término dental: oseointegración"],
  [rx("(?:a|e)lv?b?eolitis|albeolitis"), "alveolitis", "término dental: alveolitis"],
  // Pulpa
  [rx("pulp[oa]\\s?tom[ií]as?"), "pulpotomía", "término dental: pulpotomía"],
  [rx("pulp(?:e|a)\\s?c?\\s?tom[ií]as?|pulpa\\s?ectom[ií]a"), "pulpectomía", "término dental: pulpectomía"],
  // Periodoncia y raspado
  [rx("a\\s+lisado(\\s+radicular)"), "alisado$1", "término dental: alisado radicular"],
  [rx("radi\\s?cu\\s?lar|radicul[aá]r|radiculal"), "radicular", "término dental: radicular"],
  [rx("bio\\s?fil+m?"), "biofilm", "término dental: biofilm"],
  [rx("fur\\s?ca"), "furca", "término dental: furca"],
  [rx("nic"), "NIC", "sigla: nivel de inserción clínica"],
  [rx("bru(?:j|x|ks|k|qu)\\s?ismo"), "bruxismo", "término dental: bruxismo"],
  [rx("a\\s?pi[nñ]amiento"), "apiñamiento", "término dental: apiñamiento"],
  // Anestesia
  [rx("anest[ae]ci?a|anast[ae]sia|anestecia"), "anestesia", "término dental: anestesia"],
  [rx("arti\\s?ca[ií]na"), "articaína", "fármaco: articaína"],
  [rx("lido\\s?ca[ií]na"), "lidocaína", "fármaco: lidocaína"],
  [rx("mepi\\s?(?:v|b)aca[ií]na"), "mepivacaína", "fármaco: mepivacaína"],
  [rx("prilo\\s?ca[ií]na"), "prilocaína", "fármaco: prilocaína"],
  [rx("tron\\s?c[uo]l[aá]r"), "troncular", "término dental: troncular"],
  [rx("infiltra\\s?tiva"), "infiltrativa", "término dental: infiltrativa"],
  [rx("(?:e?spi(?:x|cs|ks|cks|k)|es\\s?pix)"), "Spix", "término dental: técnica de Spix"],
  [rx("clor\\s?h?e(?:x|ks|s)idina|cloroxidina"), "clorhexidina", "fármaco: clorhexidina"],
  [rx("(?:k|qu)eto\\s?rolaco"), "ketorolaco", "fármaco: ketorolaco"],
  // Radiología
  [rx("retro\\s?-?\\s?al\\s?(?:v|b)eolar(es)?"), "retroalveolar$1", "término dental: retroalveolar"],
  [rx("(?:bite|bait|bai)\\s?-?(?:w|g[uü])(?:i|ui)ngs?"), "bite-wing", "término dental: radiografía bite-wing"],
  [rx("(?:se|ce)\\s?be\\s?(?:se|ce)\\s?te"), "CBCT", "sigla: tomografía CBCT"],
  [rx("cone?\\s?b(?:i|ea)m"), "cone beam", "término dental: cone beam"],
  [rx("pano\\s?r[aá]mica"), "panorámica", "término dental: panorámica"],
  // Materiales y prótesis
  [rx("vidrio\\s+(?:i\\s?o|yo|io)\\s?n[oó]mero"), "vidrio ionómero", "material: vidrio ionómero"],
  [rx("(?:yo|io)\\s+n[oó]mero"), "ionómero", "material: ionómero"],
  [rx("resina\\s+con\\s?puesta"), "resina compuesta", "material: resina compuesta"],
  [rx("compo\\s?s[ai]te?|com\\s?posite"), "composite", "material: composite"],
  [rx("a\\s+malgama"), "amalgama", "material: amalgama"],
  [rx("guta\\s+percha|gota\\s?percha"), "gutapercha", "material: gutapercha"],
  [rx("h?i\\s?dr[oó]xido(\\s+de\\s+calcio)"), "hidróxido$1", "material: hidróxido de calcio"],
  [rx("s[ie]rconio|zirconeo"), "zirconio", "material: zirconio"],
  [rx("ser[aá]mic(a|o|as|os)"), "cerámic$1", "material: cerámica"],
  [rx("(?:de|di)\\s?silicato(\\s+de\\s+litio)"), "disilicato$1", "material: disilicato de litio"],
  [rx("in\\s?crusta(?:s|c)i[oó]n"), "incrustación", "término dental: incrustación"],
  [rx("on\\s?l[ae]i|on\\s+lay"), "onlay", "término dental: onlay"],
  [rx("in\\s?l[ae]i|in\\s+lay"), "inlay", "término dental: inlay"],
  [rx("o[bv]er\\s?l[ae]i|over\\s+lay"), "overlay", "término dental: overlay"],
  [rx("perno\\s?mu[nñ][oó]n?"), "perno muñón", "término dental: perno muñón"],
  [rx("s?cementa(?:s|c)i[oó]n"), "cementación", "término dental: cementación"],
  [rx("blanqu?e?\\s?i?amiento|blanquiamiento"), "blanqueamiento", "término dental: blanqueamiento"],
  [rx("floru?raci[oó]n|fluorura(?:s|c)i[oó]n"), "fluoruración", "término dental: fluoruración"],
  [rx("amelo\\s?-?\\s?cementari([oa])"), "amelocementari$1", "término dental: amelocementario"],
  [rx("inter\\s?-?\\s?proximal(es)?"), "interproximal$1", "término dental: interproximal"],
  [rx("lin\\s?g[uü]al(es)?"), "lingual$1", "término dental: lingual"],
  // Administración (Chile)
  [rx("fona\\s?[sz]a|fon\\s?asa|phonasa"), "Fonasa", "previsión: Fonasa"],
  [rx("i\\s?sa\\s?pre(s?)"), "isapre$1", "previsión: isapre"],
  [rx("ges"), "GES", "sigla: GES"],
];

const keepCase = (match: string, value: string) => /^[A-ZÁÉÍÓÚÑ]/.test(match) && value === value.toLowerCase() ? value[0].toUpperCase() + value.slice(1) : value;

/** Aplica el mapa de confusiones. Devuelve el texto y cada cambio hecho. */
export function applyDentalConfusions(text: string): { text: string; corrections: LexiconCorrection[] } {
  let out = text;
  const corrections: LexiconCorrection[] = [];
  for (const [pattern, replacement, reason] of CONFUSIONS) {
    out = out.replace(pattern, (match: string, ...groups: unknown[]) => {
      const value = keepCase(match, replacement.replace(/\$(\d)/g, (_, i) => String((typeof groups[Number(i) - 1] === "string" ? groups[Number(i) - 1] : "") ?? "")));
      if (match !== value && !corrections.some(c => c.original === match && c.corrected === value)) corrections.push({ original: match, corrected: value, reason });
      return value;
    });
  }
  return { text: out, corrections };
}

// ---------- Búsqueda fonética prudente ----------
/** Uniones de palabras que son español correcto y no deben fundirse en un término. */
const LEGIT_SPLITS = new Set(["con tacto", "con ducto", "a bono", "de bido", "sin tesis", "en cia"]);
/** Palabras que nunca se tocan aunque se parezcan a un término (números, negaciones, caras, fechas…). */
const NEVER = new Set("no si sin nunca nada mesial distal oclusal incisal vestibular palatino palatina lingual bucal labial cervical proximal superior inferior derecha derecho izquierda izquierdo hoy manana ayer pieza piezas diente dientes".split(" "));

const TOKEN = /[\p{L}\p{N}]+/gu;
type Token = { text: string; start: number; end: number };

/**
 * Corrige palabras que no existen en español y suenan casi igual a un término del léxico
 * («sextontes» → «sextantes», «endo doncia» → «endodoncia», «obturacion» se deja: ya es español).
 * Nunca toca palabras españolas reales, números, nombres propios a mitad de frase ni palabras cortas.
 */
export function applyDentalFuzzy(text: string): { text: string; corrections: LexiconCorrection[] } {
  const tokens: Token[] = [...text.matchAll(TOKEN)].map(m => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const edits: Array<{ start: number; end: number; value: string; original: string }> = [];
  const sentenceStart = (index: number) => index === 0 || /[.!?¿¡:\n]\s*$/.test(text.slice(Math.max(0, tokens[index].start - 3), tokens[index].start));
  const plainWord = (t: Token) => /^\p{L}+$/u.test(t.text);
  const known = (t: Token) => { const f = foldText(t.text); return DENTAL_WORDS.has(f) || SPANISH_NEAR_DENTAL.has(f) || NEVER.has(f); };
  let i = 0;
  while (i < tokens.length) {
    let done = false;
    // Palabras partidas por el dictado: «endo doncia», «sex tantes», «pulpo tomía». Solo coincidencia fonética exacta.
    for (const span of [3, 2]) {
      const parts = tokens.slice(i, i + span);
      if (parts.length < span || !parts.every(plainWord)) continue;
      if (parts.some((p, k) => k > 0 && !/^[\s-]+$/.test(text.slice(parts[k - 1].end, p.start)))) continue;
      const joined = parts.map(p => p.text).join("");
      if (foldText(joined).length < 7 || LEGIT_SPLITS.has(parts.map(p => foldText(p.text)).join(" "))) continue;
      if (parts.some(p => NEVER.has(foldText(p.text)) || (isDentalWord(p.text) && p.text.length >= 5))) continue;
      const hit = BY_KEY.get(phoneticKey(joined));
      if (!hit || !uniqueWritten(hit)) continue;
      const original = text.slice(parts[0].start, parts[span - 1].end);
      edits.push({ start: parts[0].start, end: parts[span - 1].end, value: keepCase(original, hit[0].written), original });
      i += span; done = true; break;
    }
    if (done) continue;
    const t = tokens[i];
    i++;
    if (!plainWord(t) || t.text.length < 6 || known(t)) continue;
    if (/^\p{Lu}/u.test(t.text) && !sentenceStart(i - 1)) continue;
    if (/^\p{Lu}{2,}$/u.test(t.text)) continue;
    const near = nearestDentalWord(t.text);
    if (!near || near.distance === 0 && foldText(near.written) === foldText(t.text)) {
      // Solo falta la tilde («obturacion» → «obturación»): se completa sin anunciarlo como cambio de palabra.
      continue;
    }
    edits.push({ start: t.start, end: t.end, value: keepCase(t.text, near.written), original: t.text });
  }
  if (!edits.length) return { text, corrections: [] };
  let out = "", last = 0;
  const corrections: LexiconCorrection[] = [];
  for (const edit of edits) {
    out += text.slice(last, edit.start) + edit.value;
    last = edit.end;
    if (!corrections.some(c => c.original === edit.original)) corrections.push({ original: edit.original, corrected: edit.value, reason: "término dental (parecido fonético)" });
  }
  return { text: out + text.slice(last), corrections };
}

/** Confusiones + búsqueda fonética, en ese orden. */
export function correctDentalTerms(text: string): { text: string; corrections: LexiconCorrection[] } {
  const first = applyDentalConfusions(text);
  const second = applyDentalFuzzy(first.text);
  return { text: second.text, corrections: [...first.corrections, ...second.corrections] };
}

// ---------- Glosario para la IA ----------
/** Términos que casi siempre ayudan a la IA a reconocer lo dictado. */
const CORE_GLOSSARY = [
  "destartraje supragingival", "destartraje subgingival", "pulido coronario", "pulido radicular", "raspado y alisado radicular", "sextante", "cuadrante",
  "obturación", "resina compuesta", "vidrio ionómero", "endodoncia", "exodoncia", "pulpotomía", "sondaje", "saco periodontal", "furca",
  "oclusal", "mesial", "distal", "vestibular", "palatino", "lingual", "periodontitis", "gingivitis",
];

/**
 * Glosario corto para el prompt: términos del léxico que suenan parecido a palabras del dictado
 * (o que están en él), más unos pocos términos base. Mantiene el prompt chico.
 */
export function dentalGlossaryFor(text: string, limit = 40): string[] {
  const words = [...new Set((foldText(text).match(/\p{L}{4,}/gu) ?? []))].filter(w => !GLOSSARY_STOP.has(w));
  // Una palabra que ya es un término dental bien escrito no recibe parecidos («atrición» no sugiere «abrasión»).
  const keys = words.map(w => ({ w, k: phoneticKey(w), known: isDentalWord(w) })).filter(x => x.k.length >= 5);
  const scored = new Map<string, { score: number; from: string }>();
  for (const { term } of DENTAL_TERMS) {
    const termWords = term.split(/[\s\-/]+/).filter(w => w.length >= 4);
    if (!termWords.length || term.split(" ").length > 4) continue;
    let best = Infinity, from = "";
    for (const tw of termWords) {
      const tk = phoneticKey(tw), tf = foldText(tw);
      if (tk.length < 5) continue;
      for (const { w, k, known } of keys) {
        // Ya escrito bien: va primero, como referencia de la grafía correcta.
        if (tf === w) { if (0 < best) { best = 0; from = w; } continue; }
        if (known) continue;
        // «traje» dentro de «destartraje», «gingival» dentro de «supragingival».
        if (tk.length > k.length && (tk.endsWith(k) || tk.startsWith(k))) { if (0.15 < best) { best = 0.15; from = w; } continue; }
        const d = levenshtein(k, tk, Math.ceil(Math.max(k.length, tk.length) * 0.4));
        const norm = d / Math.max(k.length, tk.length);
        if (norm <= 0.34 && norm < best) { best = norm; from = w; }
      }
    }
    if (best < Infinity) scored.set(term, { score: best + (termWords.length - 1) * 0.02, from });
  }
  // Como mucho 3 términos por palabra dictada, para que una sola palabra («dental») no llene el glosario.
  const perWord = new Map<string, number>();
  const ranked = [...scored].sort((a, b) => a[1].score - b[1].score).filter(([term, { from: w }]) => {
    if (CORE_GLOSSARY.includes(term)) return false;
    const n = perWord.get(w) ?? 0;
    perWord.set(w, n + 1);
    return n < 3;
  }).map(([term]) => term);
  const out: string[] = [];
  for (const term of [...ranked.slice(0, Math.max(0, limit - 14)), ...CORE_GLOSSARY]) {
    if (out.length >= limit) break;
    if (!out.some(t => foldText(t) === foldText(term))) out.push(term);
  }
  return out;
}
/** Palabras comunes del dictado que no orientan el glosario. */
const GLOSSARY_STOP = new Set("paciente presupuesto actividad evalua evaluacion completo completa hoy dia que para pero porque entonces tambien estamos necesita realizar realiza realizo sera esta este esto como cuando donde tiene tienen hace queda quedo control indica refiere".split(" "));

/** Instrucción para los prompts: corrige términos dentales mal oídos, sin inventar. */
export const DENTAL_GLOSSARY_INSTRUCTION = "Corrige los términos odontológicos que el reconocimiento de voz oyó mal (p. ej. «traje supergival» → «destartraje supragingival», «sub gingival» → «subgingival», «6ectontes» → «6 sextantes», «endo doncia» → «endodoncia») usando el glosario. Cambia solo palabras mal oídas: no agregues procedimientos, piezas, montos ni hallazgos que no se dictaron.";

/** Línea de glosario lista para el prompt. */
export function dentalGlossaryLine(text: string, limit = 40): string {
  return `Glosario odontológico (escríbelos así si el dictado los deformó): ${dentalGlossaryFor(text, limit).join(", ")}.`;
}
