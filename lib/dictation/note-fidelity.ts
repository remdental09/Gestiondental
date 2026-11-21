import { DIAGNOSES_HEADER, EXAM_REGISTRY_HEADER, formatFdi, teethInText, TRANSCRIPT_HEADER } from "./proposal.ts";
import { numberRuns } from "./spoken.ts";

/**
 * Fidelidad de la nota (sin IA, sin costo). Compara la evolución redactada con lo que el profesional dijo
 * (dictado, texto corregido y respuestas a las preguntas) y marca los datos clínicos de la nota que no aparecen ahí:
 * piezas, caras, cifras con unidad (dosis, mm, días), materiales, fármacos, colores y pasos o frases de cierre.
 *
 * No juzga el estilo: pasar «tapadura» a «restauración» o «saqué la caries» a «remoción de tejido cariado» no se marca.
 * Solo avisa; nunca cambia la nota. Si el profesional borra o corrige el dato, el aviso desaparece.
 */
export type FidelityKind = "pieza" | "cara" | "cifra" | "material" | "fármaco" | "color" | "paso";
export type FidelityFlag = { kind: FidelityKind; found: string; sentence: string };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Numeración chilena de una pieza permanente FDI (1.8 → 1 … 4.8 → 32). */
const chileNumber = (tooth: number) => { const q = Math.floor(tooth / 10), p = tooth % 10; return q === 1 ? 9 - p : q === 2 ? 8 + p : q === 3 ? 24 + p : 25 - p; };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Term = { label: string; note: RegExp; source: RegExp };

/** Materiales: si la nota nombra el material, el dictado debe nombrarlo (o su marca). */
const MATERIALS: Term[] = [
  { label: "resina", note: /\bresinas?\b|\bcomposites?\b/, source: /resin|composit|compost|filtek|z350|z250|tetric|estelite|charisma|herculite|harmonize|gradia|venus|palfique|opallis|essentia|beautifil|bulk|fluida|\bflow\b/ },
  { label: "amalgama", note: /\bamalgama/, source: /amalgam/ },
  { label: "vidrio ionómero", note: /ionomero/, source: /ionom|vidrio|fuji|ketac|vitrebond|riva|equia|ionoseal/ },
  { label: "hidróxido de calcio", note: /hidroxido de calcio/, source: /hidroxido|calcio|dycal|ultracal|calen/ },
  { label: "MTA", note: /\bmta\b|agregado de trioxido/, source: /\bmta\b|trioxido|proroot/ },
  { label: "Biodentine", note: /biodentine/, source: /biodent/ },
  { label: "biocerámico", note: /bioceramic/, source: /biocer|\bbc\b|totalfill|ceraseal|biodent|\bmta\b/ },
  { label: "gutapercha", note: /gutapercha/, source: /guta|\bgp\b|cono/ },
  { label: "IRM", note: /\birm\b/, source: /\birm\b|oxido de zinc|eugen/ },
  { label: "eugenato", note: /eugenato|oxido de zinc/, source: /eugen|zinc|\bzoe\b|\birm\b/ },
  { label: "Cavit", note: /\bcavit\b/, source: /cavit|kavit|caviton/ },
  { label: "zirconio", note: /zirconi|circoni/, source: /zircon|circon/ },
  { label: "disilicato", note: /disilicato|e\.?\s?max/, source: /disilic|e\.?\s?max|empress/ },
  { label: "metal-cerámica", note: /metal[-\s]?ceramic|metaloceramic/, source: /metal/ },
  { label: "porcelana", note: /porcelana/, source: /porcel|ceramic/ },
  { label: "hipoclorito", note: /hipoclorito/, source: /hipoclor|cloro|naocl/ },
  { label: "clorhexidina", note: /clorhexidina/, source: /clorhex|\bchx\b|perio.?aid/ },
  { label: "EDTA", note: /\bedta\b/, source: /edta/ },
  { label: "sellante", note: /\bsellantes?\b/, source: /sellant|sellador/ },
  { label: "flúor", note: /\bfluor|barniz/, source: /fluor|barniz|duraphat/ },
  { label: "sutura", note: /sutura|\bseda\b|vicryl|nylon|catgut/, source: /sutur|\bseda\b|vicryl|nylon|catgut|\bpuntos?\b|monocryl/ },
  { label: "hemostático", note: /esponja|colageno|gelfoam|spongostan|surgicel/, source: /espong|colag|gelfoam|spongostan|surgicel|hemosta/ },
  { label: "injerto", note: /injerto|bio-?oss|xenoinjerto|membrana/, source: /injert|bio.?oss|xeno|membrana|hueso/ },
];

/** Fármacos: nunca deben aparecer en la nota si no se dictaron. */
const DRUGS: Term[] = [
  { label: "amoxicilina", note: /amoxicilina/, source: /amoxi/ },
  { label: "ácido clavulánico", note: /clavulan/, source: /clavul/ },
  { label: "clindamicina", note: /clindamicina/, source: /clinda/ },
  { label: "metronidazol", note: /metronidazol/, source: /metron|flagyl/ },
  { label: "azitromicina", note: /azitromicina/, source: /azitro/ },
  { label: "cefadroxilo", note: /cefadroxilo/, source: /cefadro/ },
  { label: "ibuprofeno", note: /ibuprofeno/, source: /ibupro/ },
  { label: "ketoprofeno", note: /ketoprofeno/, source: /ketopro/ },
  { label: "ketorolaco", note: /ketorolaco/, source: /ketorol|toradol/ },
  { label: "paracetamol", note: /paracetamol|acetaminofeno/, source: /paracet|acetamin|tapsin|kitadol/ },
  { label: "naproxeno", note: /naproxeno/, source: /naprox/ },
  { label: "diclofenaco", note: /diclofenaco/, source: /diclof/ },
  { label: "nimesulida", note: /nimesulida/, source: /nimesul/ },
  { label: "celecoxib", note: /celecoxib/, source: /celecox/ },
  { label: "metamizol", note: /metamizol|dipirona/, source: /metamiz|dipiron/ },
  { label: "tramadol", note: /tramadol/, source: /tramad/ },
  { label: "dexametasona", note: /dexametasona/, source: /dexa/ },
  { label: "betametasona", note: /betametasona/, source: /betamet/ },
  { label: "prednisona", note: /prednisona/, source: /predni/ },
  { label: "codeína", note: /codeina/, source: /codei/ },
  { label: "nistatina", note: /nistatina/, source: /nistat/ },
  { label: "aciclovir", note: /aciclovir/, source: /aciclo/ },
  { label: "lidocaína", note: /lidocaina/, source: /lido|xilo/ },
  { label: "articaína", note: /articaina/, source: /artica|septanest/ },
  { label: "mepivacaína", note: /mepivacaina/, source: /mepiva|scandon/ },
  { label: "bupivacaína", note: /bupivacaina/, source: /bupiva/ },
  { label: "epinefrina", note: /epinefrina|adrenalina|vasoconstrictor/, source: /epinef|adrenal|vasocons|\bcon epi\b|1:100/ },
];

/** Pasos técnicos y frases de cierre que la IA tiende a agregar «para que suene profesional». */
const STEPS: Term[] = [
  { label: "anestesia", note: /anestesi|tecnica troncular|infiltrativa/, source: /aneste|lido|artica|mepiva|bupiva|carpule|\btubos?\b|troncular|infiltr|pinch|puncion/ },
  { label: "aislamiento", note: /aislamiento|goma dique|\bdique\b/, source: /aisla|dique|goma|algod|torund/ },
  { label: "grabado ácido", note: /grabado|acido fosforico/, source: /graba|acido/ },
  { label: "adhesivo", note: /adhesivo/, source: /adhesi|bond/ },
  { label: "fotopolimerización", note: /fotopolimeriz|fotocur/, source: /polimer|fotocur|\bluz\b|lampara/ },
  { label: "pulido", note: /\bpulid|\bse pule\b/, source: /\bpul[ie]|brill|terminac/ },
  { label: "ajuste oclusal", note: /ajuste oclusal|papel articular/, source: /ajust|mordida|oclus|articul|contacto/ },
  { label: "radiografía", note: /radiograf|\brx\b|retroalveolar|panoramica|cbct|tomograf/, source: /radio|\brx\b|placa|retro|panoram|cbct|tomo/ },
  { label: "indicaciones posoperatorias", note: /indicaciones post|posoperatori|postoperatori/, source: /indicac|post|poso|recomend|cuidado/ },
  { label: "tolerancia o cierre", note: /tolera (?:bien|adecuadamente|el procedimiento)|sin complicaciones|sin incidentes|sin eventualidades|buena evolucion|evoluciona favorablemente|satisfactoriamente/, source: /tolera|complic|incident|eventual|favorab|satisf|tranquil/ },
];

/** Caras: palabra en la nota → cómo pudo decirse (palabra o letra de la abreviatura MOD). */
const FACES: Array<{ label: string; note: RegExp; source: RegExp; letters: string }> = [
  { label: "mesial", note: /\bmesial|\bmesio/, source: /\bmesi/, letters: "M" },
  { label: "distal", note: /\bdistal|\bdisto/, source: /\bdist/, letters: "D" },
  { label: "oclusal", note: /\boclusal|ocluso/, source: /oclus|masticat|\bclase (?:i|1|uno|ii|2|dos)\b/, letters: "O" },
  { label: "vestibular", note: /vestibular|\bbucal\b|vestibulo/, source: /vestib|bucal|\bextern|afuera/, letters: "VB" },
  { label: "palatina", note: /palatin|palatal/, source: /palat|\bintern|adentro|\blingu/, letters: "P" },
  { label: "lingual", note: /\blingual|linguo/, source: /lingu|\bintern|adentro|palat/, letters: "L" },
  { label: "incisal", note: /\bincisal|\binciso/, source: /incis|\bborde|\bfilo|\bpunta/, letters: "I" },
  { label: "cervical", note: /\bcervical/, source: /cervic|cuello|\bclase (?:v|5|cinco)\b/, letters: "" },
];
const FACE_ABBR_LOWER = new Set(["mo", "od", "mod", "om", "dom", "ov", "op", "ol", "mv", "dv", "mp", "dp", "ml", "dl", "modp", "modv", "modl", "vo", "lo"]);

/** Letras de caras dichas como abreviatura («MOD», «OD»), para no marcar «mesial» cuando se dictó «M». */
function faceLetters(source: string): Set<string> {
  const letters = new Set<string>();
  for (const match of source.matchAll(/\b([A-Za-z]{2,5})\b/g)) {
    const token = match[1];
    const upper = /^[MODVBLPI]{2,5}$/.test(token);
    if (upper || FACE_ABBR_LOWER.has(token.toLowerCase())) for (const letter of token.toUpperCase()) letters.add(letter);
  }
  return letters;
}

/** Unidades que vuelven clínico a un número: dosis, medidas, tiempos, cantidades. */
const UNIT = /^\s*(?:mm\b|mil[ií]metros?|mg\b|miligramos?|ml\b|mililitros?|cc\b|g\b|gramos?|%|por\s+ciento|horas?\b|hrs?\b|d[ií]as?\b|semanas?\b|meses\b|mes\b|minutos?\b|min\b|tubos?\b|carpules?\b|cartuchos?\b|ampollas?\b|comprimidos?\b|tabletas?\b|c[aá]psulas?\b|conductos?\b|veces\b|sesiones?\b|puntos?\b|ncm\b|newton)/i;

function quantities(text: string): Array<{ value: number; text: string }> {
  const out: Array<{ value: number; text: string }> = [];
  for (const run of numberRuns(text)) {
    const after = text.slice(run.end);
    const unit = UNIT.exec(after);
    // «lima 25», «calibre 30», «cada 8»: el número también es un dato clínico.
    const before = text.slice(Math.max(0, run.start - 12), run.start);
    const cue = /(?:lima|calibre|cada|#)\s*(?:[a-z]\s*)?$/i.test(before);
    if (!unit && !cue) continue;
    // «un conducto», «una ampolla» escritos con palabras: la palabra «un» es dato solo si lleva unidad.
    out.push({ value: run.value, text: unit ? `${run.text}${unit[0]}`.trim() : run.text });
  }
  return out;
}

function supportedQuantity(value: number, said: number[], source: string): boolean {
  if (said.includes(value)) return true;
  const whole = Math.trunc(value), part = Math.round((value - whole) * 100) / 100;
  if (part > 0) {
    // «uno coma ocho» llega como 1 y 8; «tubo y medio» como 1 y «medio».
    if (part === 0.5 && /\bmedi[oa]\b/.test(source) && (whole <= 1 || said.includes(whole))) return true;
    const digits = Number(String(value).split(".")[1]);
    if (said.includes(whole) && said.includes(digits) && /\b(?:coma|punto)\b/.test(source)) return true;
  }
  // Una semana = 7 días, dos semanas = 14; un mes ≈ 30 días.
  if (value % 7 === 0 && said.includes(value / 7) && /semana/.test(source)) return true;
  if (value === 7 && /\buna semana\b|\bsemana\b/.test(source)) return true;
  if ([28, 30, 31].includes(value) && /\bmes\b/.test(source)) return true;
  if (value === 15 && /quincena|quince dias/.test(source)) return true;
  if (value === 24 && /\bun dia\b/.test(source)) return true;
  return false;
}

/** Quita las secciones que arma la app (diagnósticos CIE-11, examen del odontograma) y la transcripción. */
function narrative(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === TRANSCRIPT_HEADER) break;
    if (trimmed === DIAGNOSES_HEADER || trimmed === EXAM_REGISTRY_HEADER) { skipping = true; continue; }
    if (skipping) { if (trimmed === "") skipping = false; continue; }
    out.push(line);
  }
  return out.join("\n");
}

const noteSentences = (text: string) => text.split(/\n+|(?<=[.!?;])\s+(?=\S)/).map((part) => part.trim()).filter((part) => /[\p{L}\d]/u.test(part));

/** El fragmento exacto de la frase que corresponde a un término (para resaltarlo). */
function locate(sentence: string, pattern: RegExp): string {
  const folded = fold(sentence);
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(folded);
  if (!match) return "";
  // fold() conserva la longitud letra por letra en español (las tildes se quitan de la letra, no se agregan caracteres).
  const start = match.index;
  const wordEnd = /[\p{L}\d]/u;
  let end = start + match[0].length;
  while (end < sentence.length && wordEnd.test(sentence[end] ?? "")) end++;
  return sentence.normalize("NFC").slice(start, end) || match[0];
}

function toothText(sentence: string, tooth: number): string {
  const candidates = [formatFdi(tooth), ...(tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8 ? [String(chileNumber(tooth))] : []), String(tooth)];
  for (const candidate of candidates) {
    const match = new RegExp(`(?<![\\d.])${escape(candidate)}(?![\\d]|\\.\\d)`).exec(sentence);
    if (match) return match[0];
  }
  return formatFdi(tooth);
}

/**
 * Datos de la nota que no tienen respaldo en lo dicho. `sources` = dictado, texto corregido y respuestas del profesional.
 */
export function noteFidelity(body: string, sources: string[]): FidelityFlag[] {
  const said = sources.filter((text) => typeof text === "string" && text.trim()).join("\n");
  const note = narrative(body);
  if (!note.trim() || !said.trim()) return [];
  const saidFolded = fold(said);
  const saidTeeth = new Set(teethInText(said));
  const saidNumbers = numberRuns(said).map((run) => run.value);
  const letters = faceLetters(said);
  const flags: FidelityFlag[] = [];
  const seen = new Set<string>();
  const add = (kind: FidelityKind, found: string, sentence: string) => {
    const key = `${kind}:${fold(found)}`;
    if (!found || seen.has(key)) return;
    seen.add(key);
    flags.push({ kind, found, sentence });
  };

  for (const sentence of noteSentences(note)) {
    const folded = fold(sentence);
    for (const tooth of teethInText(sentence)) if (!saidTeeth.has(tooth)) add("pieza", toothText(sentence, tooth), sentence);
    for (const face of FACES) {
      if (!face.note.test(folded) || face.source.test(saidFolded)) continue;
      if ([...face.letters].some((letter) => letters.has(letter))) continue;
      add("cara", locate(sentence, face.note), sentence);
    }
    for (const quantity of quantities(sentence)) if (!supportedQuantity(quantity.value, saidNumbers, saidFolded)) add("cifra", quantity.text, sentence);
    for (const term of MATERIALS) if (term.note.test(folded) && !term.source.test(saidFolded)) add("material", locate(sentence, term.note), sentence);
    for (const term of DRUGS) if (term.note.test(folded) && !term.source.test(saidFolded)) add("fármaco", locate(sentence, term.note), sentence);
    for (const term of STEPS) if (term.note.test(folded) && !term.source.test(saidFolded)) add("paso", locate(sentence, term.note), sentence);
    for (const match of sentence.matchAll(/\b([A-D][1-4](?:[.,]5)?)\b/g)) {
      const shade = match[1].replace(",", ".");
      const spoken = fold(shade).replace(".", "(?:[.,]|\\s*y\\s*medio|\\s*coma\\s*cinco)?");
      if (!new RegExp(`\\b${spoken}\\b`).test(saidFolded) && !saidFolded.includes(fold(shade))) add("color", match[1], sentence);
    }
  }
  return flags;
}

export const FIDELITY_LABEL: Record<FidelityKind, string> = {
  pieza: "Pieza", cara: "Cara", cifra: "Cifra", material: "Material", fármaco: "Fármaco", color: "Color", paso: "Paso o frase",
};
