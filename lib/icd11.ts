/**
 * CIE-11 (OMS, versión MMS 2026-01) para diagnósticos odontológicos.
 * Códigos, títulos e ids vienen del catálogo verificado `lib/icd11-catalog.ts` (generado desde la tabulación
 * oficial de la OMS; ver docs/cie11-catalogo.md). No agregar códigos a mano: regenerar el catálogo.
 *  - tabla oficial: https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip
 *  - títulos en español: https://icd.who.int/browse/2026-01/mms/es#<id>
 * Los sinónimos chilenos del catálogo son propuestas clínicas, no contenido OMS.
 *
 * En CIE-11 la caries es una sola categoría (DA08.0 Caries dental); el tejido se expresa por poscoordinación
 * con «Partes del diente»: Esmalte XA5R09, Dentina XA6FX3, Pulpa XA5B71, Cemento XA4KC7 (caries radicular).
 * CIE-11 no separa dentina superficial de dentina profunda: ambas llevan DA08.0&XA6FX3.
 * La pieza, las caras y la profundidad se guardan aparte del código.
 */
import type { CariesDepth } from "./caries.ts";
import { ICD11_CATALOG, ICD11_RELEASE, ICD11_TOOTH_BY_FDI, type Icd11CatalogEntry } from "./icd11-catalog.ts";

export { ICD11_CATALOG, ICD11_RELEASE, ICD11_TOOTH_BY_FDI };
export type { Icd11CatalogEntry };
export type Icd11Entry = { code: string; title: string; titleEn: string; id: string };

const BROWSER = "https://icd.who.int/browse/2026-01/mms/es#";
export const icd11Url = (entry: Pick<Icd11Entry, "id">) => `${BROWSER}${entry.id}`;

/**
 * Título clínico mostrado cuando el título OMS en español induce a error. DA08.10 es «Excessive attrition of
 * teeth» (atrición); la versión española oficial lo traduce como «Erosión excesiva», que se confunde con DA08.12.
 */
const CLINICAL_TITLE: Record<string, string> = {
  "DA08.10": "Atrición excesiva de los dientes",
};

const CATALOG_BY_CODE = new Map(ICD11_CATALOG.map((entry) => [entry.code, entry]));
export const catalogEntry = (code: string) => CATALOG_BY_CODE.get(code);
export const officialTitle = (code: string) => CATALOG_BY_CODE.get(code)?.title ?? "";

export const ICD11: Record<string, Icd11Entry> = Object.fromEntries(
  ICD11_CATALOG.map(({ code, title, titleEn, id }) => [code, { code, title: CLINICAL_TITLE[code] ?? title, titleEn, id }]),
);

/** Un código que se puede guardar como etiqueta: hoja troncal del catálogo, o caries poscoordinada con una parte del diente. */
export function isStorableIcd11(code: string): boolean {
  const [stem, ...extensions] = code.split("&");
  const entry = CATALOG_BY_CODE.get(stem);
  if (!entry || entry.kind !== "stem" || !entry.isLeaf) return false;
  return extensions.every((ext) => CATALOG_BY_CODE.get(ext)?.kind === "extension");
}

/** Título de un código guardable (con su poscoordinación), o "" si no está en el catálogo. */
export function icd11Title(code: string): string {
  if (!isStorableIcd11(code)) return "";
  return code.split("&").map((part) => ICD11[part]?.title ?? "").join(" · ");
}

/** Código CIE-11 para una caries según profundidad (poscoordinado cuando la profundidad o la raíz se conocen). */
export type Icd11Code = { code: string; title: string };

const CARIES_PART: Record<CariesDepth, string> = {
  esmalte: "XA5R09",
  dentina_superficial: "XA6FX3",
  dentina_profunda: "XA6FX3",
  pulpar: "XA5B71",
};

/** `root`: caries radicular (cemento, XA4KC7). Con compromiso pulpar manda la pulpa. */
export function cariesIcd11(depth: CariesDepth | null | undefined, root = false): Icd11Code {
  const base = ICD11["DA08.0"];
  const partCode = depth === "pulpar" ? CARIES_PART.pulpar : root ? "XA4KC7" : depth ? CARIES_PART[depth] : null;
  if (!partCode) return { code: base.code, title: base.title };
  const part = ICD11[partCode];
  return { code: `${base.code}&${part.code}`, title: `${base.title} · ${part.title}` };
}

export const icd11Label = (icd: Icd11Code) => `CIE-11 ${icd.code} ${icd.title}`;

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Términos de la AAE (Asociación Americana de Endodoncia) que se usan en Chile y no son títulos CIE-11.
 * Su código es una equivalencia SUGERIDA que el profesional confirma; nunca se guarda sin su revisión.
 */
export type SuggestedMapping = { from: "AAE" | "caries-pulpar" | "aproximado"; term: string };

type Rule = { re: RegExp; code: string; aae?: true; dentalOnly?: true };

// Más específico primero dentro de cada familia.
const RULES: Rule[] = [
  // Pulpa y periápice
  { re: /\bpulpitis\s+irreversible(?:\s+(?:sintomatica|asintomatica))?\b/, code: "DA09.0", aae: true },
  { re: /\bpulpitis\b/, code: "DA09.0" },
  { re: /\bnecrosis\s+pulpar\b|\bnecrosis\s+de\s+(?:la\s+)?pulpa\b|\bpulpa\s+necrotica\b/, code: "DA09.1" },
  { re: /\babsceso\s+pulpar\b|\babsceso\s+de\s+la\s+pulpa\b/, code: "DA09.2" },
  { re: /\babsceso\s+fenix\b|\bperiodontitis\s+apical\s+cronica\s+reagudizada\b|\blesion\s+periapical\s+reagudizada\b/, code: "DA09.3" },
  { re: /\babsceso\s+(?:periapical|apical)\s+con\s+(?:afectacion|compromiso)\s+facial\b|\babsceso\s+(?:periapical|apical)\s+con\s+aumento\s+de\s+volumen\s+facial\b/, code: "DA09.60" },
  { re: /\babsceso\s+(?:periapical|apical)\s+con\s+(?:fistula|tracto\s+sinuoso)\b/, code: "DA09.61" },
  { re: /\babsceso\s+(?:periapical|apical)\s+sin\s+fistula\b/, code: "DA09.62" },
  { re: /\babsceso\s+(?:apical\s+cronico|cronico\s+apical)\b/, code: "DA09.61", aae: true },
  { re: /\babsceso\s+(?:apical\s+agudo|agudo\s+apical)\b/, code: "DA09.62", aae: true },
  { re: /\babsceso\s+(?:periapical|apical|dentoalveolar)\b/, code: "DA09.6Z" },
  // El orden de los calificativos varía al dictar: «apical crónica» y «crónica apical» son lo mismo.
  { re: /\bperiodontitis\s+(?:(?:apical|periapical)\s+aguda|aguda\s+(?:apical|periapical))\b/, code: "DA09.70" },
  { re: /\bperiodontitis\s+(?:(?:apical|periapical)\s+cronica|cronica\s+(?:apical|periapical))\b(?!\s+reagudizad)/, code: "DA09.71" },
  { re: /\bperiodontitis\s+(?:(?:apical|periapical)\s+sintomatica|sintomatica\s+(?:apical|periapical))\b/, code: "DA09.70", aae: true },
  { re: /\bperiodontitis\s+(?:(?:apical|periapical)\s+asintomatica|asintomatica\s+(?:apical|periapical))\b/, code: "DA09.71", aae: true },
  { re: /\bperiodontitis\s+(?:periapical|apical)\b/, code: "DA09.7Z" },
  { re: /\bquiste\s+(?:radicular|periapical)\b/, code: "DA09.8" },
  // Encía y periodonto
  { re: /\bpericoronaritis\b|\bpericoronitis\b/, code: "DA0B.6" },
  { re: /\bgingivitis\s+(?:ulcerativa|ulcero)?\s*necro(?:tizante|sante)\b|\bgun[ao]?\b/, code: "1C1H.Z" },
  { re: /\bperiodontitis\s+agresiva\b/, code: "DA0C.1" },
  { re: /\bperiodontitis\s+aguda\b/, code: "DA0C.0" },
  { re: /\babsceso\s+(?:periodontal|del\s+periodonto)\b/, code: "DA0C.4" },
  { re: /\b(?:retraccion|recesion)\s+gingival\b/, code: "DA0D.0" },
  { re: /\b(?:agrandamiento|hiperplasia)\s+gingival\b/, code: "DA0D.1" },
  // Tejidos duros
  { re: /\batricion\b|\bfacetas?\s+de\s+desgaste\b/, code: "DA08.10" },
  { re: /\babrasion\b/, code: "DA08.11", dentalOnly: true },
  { re: /\berosion\b|\bdesgaste\s+erosivo\b/, code: "DA08.12", dentalOnly: true },
  { re: /\babfraccion\b/, code: "DA08.13" },
  { re: /\bfractura\s+no\s+traumatica\b/, code: "DA08.3" },
  // Traumatismo dentario
  { re: /\binfraccion\s+(?:del?\s+)?esmalte\b/, code: "NA0D.00" },
  { re: /\bfractura\s+corono[\s-]*r?radicular\s+complicada\b|\bfractura\s+complicada\s+de\s+(?:la\s+)?corona[\s-]+raiz\b/, code: "NA0D.05" },
  { re: /\bfractura\s+corono[\s-]*r?radicular(?:\s+(?:no\s+complicada|sin\s+complicaciones?))?\b|\bfractura\s+de\s+(?:la\s+)?corona[\s-]+raiz\b/, code: "NA0D.04" },
  { re: /\bfractura\s+(?:de\s+)?(?:esmalte\s+y\s+dentina|esmalte[\s-]+dentina|dentina[\s-]+esmalte|dentina\s+y\s+esmalte)\b/, code: "NA0D.02" },
  { re: /\bfractura\s+(?:del?\s+)?esmalte\b/, code: "NA0D.01" },
  { re: /\bfractura\s+(?:coronaria|de\s+(?:la\s+)?corona)\s+complicada\b/, code: "NA0D.03" },
  { re: /\bfractura\s+(?:radicular|de\s+(?:la\s+)?raiz)\b/, code: "NA0D.06" },
  // «Fractura coronaria» sin decir si es complicada ni qué tejidos compromete: el código honesto es el sin especificación de la familia.
  { re: /\bfractura\s+(?:coronaria|de\s+(?:la\s+)?corona|dentaria|del\s+diente|de\s+(?:la\s+)?cuspide)\b(?![\s,]+(?:no\s+|sin\s+)?complic|\s+con\s+exposicion|\s+(?:de\s+|del\s+)?(?:esmalte|dentina)|[\s-]+(?:raiz|radicular))/, code: "NA0D.0Z" },
  { re: /\b(?:concusion|conmocion)(?:\s+(?:dentaria|del\s+tejido\s+periodontal))?\b/, code: "NA0D.10" },
  { re: /\bsubluxacion\b/, code: "NA0D.11" },
  { re: /\bluxacion\s+extrusiva\b|\bextrusion\s+(?:dentaria\s+)?traumatica\b/, code: "NA0D.12" },
  { re: /\bluxacion\s+lateral\b/, code: "NA0D.13" },
  { re: /\bluxacion\s+intrusiva\b|\bintrusion\s+(?:dentaria\s+)?traumatica\b/, code: "NA0D.14" },
  { re: /\bavulsion\b|\bavulsionad[oa]\b/, code: "NA0D.15" },
  // Erupción, maxilares, ATM
  { re: /\b(?:semi[\s-]?incluid[oa]|impactad[oa])\b/, code: "DA07.8" },
  { re: /\bincluid[oa]\b|\b(?:diente|pieza|molar|canino|premolar|cordal)\s+retenid[oa]\b/, code: "DA07.7" },
  { re: /\balveolitis\b|\balveolo\s+seco\b|\bosteitis\s+alveolar\b/, code: "DA06.1" },
  { re: /\b(?:trastorno|disfuncion)\s+(?:de\s+(?:la\s+)?)?(?:articulacion\s+)?temporomandibular\b|\bdisfuncion\s+de\s+(?:la\s+)?atm\b|\bttm\b/, code: "DA0E.8" },
  { re: /\bbruxismo\s+(?:del\s+sueno|nocturno)\b/, code: "7A83" },
  { re: /\bresto\s+radicular\b|\braiz\s+(?:dental\s+)?retenida\b/, code: "DA0A.3" },
];

/** Familias donde basta el código más específico («absceso periapical con fístula» no agrega «absceso periapical»). */
const FAMILIES = ["DA09.6", "DA09.7", "NA0D.0", "DA07."];
// El absceso fénix (DA09.3) es una periodontitis apical crónica reagudizada: no se agrega además DA09.7x.
const family = (code: string) => (code === "DA09.3" ? "DA09.7" : FAMILIES.find((prefix) => code.startsWith(prefix)) ?? code);

/**
 * El catálogo completo de diagnósticos integrado también alimenta el reconocimiento del dictado:
 * se comparan títulos OMS y sinónimos clínicos con frases explícitas, sin inferir diagnósticos semánticamente.
 * La caries DA08.0 se mantiene en su flujo propio para conservar profundidad, pieza y superficies.
 */
/**
 * Calificativos cuyo orden cambia al hablar («periodontitis apical crónica» = «periodontitis crónica apical»).
 * Solo se permutan los calificativos que siguen al primer sustantivo, y únicamente si TODOS están en esta lista;
 * así no se mezclan frases con otro significado.
 */
const QUALIFIERS = new Set([
  "cronico", "cronica", "agudo", "aguda", "apical", "periapical", "benigno", "benigna", "maligno", "maligna",
  "unilateral", "bilateral", "sintomatico", "sintomatica", "asintomatico", "asintomatica", "reversible", "irreversible",
  "superior", "inferior", "izquierdo", "izquierda", "derecho", "derecha",
]);

function orderVariants(words: string[]): string[][] {
  const [head, ...tail] = words;
  if (!head || tail.length < 2 || tail.length > 3 || !tail.every((word) => QUALIFIERS.has(word))) return [words];
  const permutations = (items: string[]): string[][] =>
    items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
  return permutations(tail).map((order) => [head, ...order]);
}

type CatalogDiagnosisTerm = { code: string; title: string; term: string; re: RegExp; chars: number; residual: boolean; official: boolean };

const CATALOG_DIAGNOSIS_TERMS: CatalogDiagnosisTerm[] = ICD11_CATALOG.flatMap((entry) => {
  if (entry.kind !== "stem" || !entry.isLeaf || entry.code === "DA08.0") return [];
  const title = ICD11[entry.code]?.title ?? entry.title;
  // «Boca seca» y «sequedad bucal» son síntomas referidos por el paciente, no diagnósticos.
  // Mantenerlos como sinónimos de búsqueda manual, pero no autoetiquetar DA02.1 en una evolución.
  const variants = [...new Set([title, entry.title, ...(entry.code === "DA02.1" ? [] : entry.synonyms)].map((name) => name.trim()).filter(Boolean))];
  return variants.flatMap((term) => {
    const words = fold(term).trim().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    return [{
      code: entry.code,
      title,
      term,
      re: new RegExp(`\\b(?:${orderVariants(words).map((order) => order.join("[^a-z0-9]+")).join("|")})\\b`, "i"),
      chars: words.join(" ").length,
      residual: Boolean(entry.isResidual),
      official: term === entry.title || term === title,
    }];
  });
}).sort((a, b) => b.chars - a.chars || Number(a.residual) - Number(b.residual) || Number(b.official) - Number(a.official));

/** «erosión» o «abrasión» solas son dentarias solo con contexto de pieza y sin palabras de mucosa (no lesiones orales). */
const DENTAL_QUALIFIER = /\b(?:erosion|abrasion)\s+(?:dental|dentaria|acida|por\s+cepillado|cervical)\b|\bdesgaste\s+erosivo\b/;
const TOOTH_CONTEXT = /\b(?:pieza|piezas|diente|dientes|incisiv\w*|canin\w*|premolar\w*|molar\w*|cervical|oclusal|incisal|esmalte|dentina)\b|\b[1-8]\.?[1-8]\b/;
const MUCOSA_CONTEXT = /\b(?:mucosa|mucoso|labio|labial\s+inferior|lengua|lingual\s+dorso|encia|gingival|paladar|yugal|carrillo|piso\s+de\s+boca|liquen|ulcera\w*|lesion\s+blanca|placa\s+blanca|comisura)\b/;

function dentalContext(t: string): boolean {
  if (DENTAL_QUALIFIER.test(t)) return true;
  return TOOTH_CONTEXT.test(t) && !MUCOSA_CONTEXT.test(t);
}

/** Conceptos clínicos sin código CIE-11 específico verificado: se etiquetan sin código. */
type Uncoded = { re: RegExp; title: (match: RegExpExecArray) => string; fallback?: true };
const UNCODED: Uncoded[] = [
  { re: /\bgingivitis\s+(?:(?:localizada|generalizada)\s+)?(?:inducida\s+por\s+(?:placa|biofilm|biopelicula)|asociada\s+a\s+(?:placa|biofilm|biopelicula)|por\s+(?:placa|biofilm))\b/, title: () => "Gingivitis inducida por placa (biofilm)" },
  { re: /\bperiodontitis\s+(?:estadio|etapa)\s+(i{1,3}v?|iv|[1-4]|uno|dos|tres|cuatro)(?:[\s,]+(?:y\s+)?grado\s+([abc]))?\b/, title: (m) => `Periodontitis estadio ${roman(m[1])}${m[2] ? ` grado ${m[2].toUpperCase()}` : ""} (clasificación 2017)` },
  { re: /\bbruxismo\b(?!\s+(?:del\s+sueno|nocturno))/, title: () => "Bruxismo (sin precisar si es del sueño o de vigilia)" },
  { re: /\bhipomineralizacion\s+incisivo[\s-]*molar\b|\bmih\b|\bhim\b/, title: () => "Hipomineralización incisivo-molar (HIM)" },
  { re: /\b(?:maloclusion\s+)?clase\s+(?:ii|2|dos)\s+(?:division|div\.?)\s+(?:1|uno|i)\b/, title: () => "Maloclusión clase II división 1" },
  { re: /\b(?:maloclusion\s+)?clase\s+(?:iii|3|tres)\b(?!\s*de\s+(?:black|kennedy))/, title: () => "Maloclusión clase III" },
  // Diagnósticos de las guías del MINSAL que la CIE-11 no separa o no trae: quedan como etiqueta sin código para confirmar.
  { re: /\bperiodontitis\s+cronica(?:\s+(localizada|generalizada))?\b/, title: (m) => `Periodontitis crónica${m[1] ? ` ${m[1]}` : ""} (clasificación previa a 2017)` , fallback: true },
  { re: /\bgingivitis\s+(?:ulcero[\s-]*necrotica|ulcero[\s-]*necrosante|necrosante|ulcerativa\s+necrosante|ulcero[\s-]*necrotizante)\b|\bguna\b/, title: () => "Gingivitis úlcero necrótica" , fallback: true },
  { re: /\b(?:periodontitis|estomatitis|enfermedad\s+periodontal)\s+(?:ulcero[\s-]*)?necrosante\b/, title: (m) => `${m[0].startsWith("estomatitis") ? "Estomatitis necrosante" : m[0].startsWith("enfermedad") ? "Enfermedad periodontal necrosante" : "Periodontitis necrosante"}` , fallback: true },
  { re: /\bflegmon(?:\s+oro[\s-]*cervico[\s-]*facial)?(?:\s+de\s+origen\s+(?:odontogenico|odontologico|dental))?\b/, title: () => "Flegmón de origen odontogénico" , fallback: true },
  { re: /\bcelulitis\s+(?:facial\s+)?(?:de\s+origen\s+)?(?:odontogenica|odontogenico|odontologica|dental|facial)\b/, title: () => "Celulitis facial de origen odontogénico" , fallback: true },
  { re: /\babsceso\s+(subperiostico|submucoso)\b/, title: (m) => `Absceso ${m[1] === "subperiostico" ? "subperióstico" : "submucoso"} de origen odontogénico` , fallback: true },
  { re: /\babsceso\s+de\s+(?:los\s+)?espacios?\s+(?:anatomicos?|fasciales?)\b/, title: () => "Absceso de espacios anatómicos buco-máxilo-faciales" , fallback: true },
  { re: /\bosteomielitis\s+(?:de\s+(?:los\s+)?maxilares|de\s+la\s+mandibula|mandibular|maxilar)\b/, title: () => "Osteomielitis de los maxilares" , fallback: true },
  { re: /\bhipersensibilidad\s+dentinaria\b|\bsensibilidad\s+dentinaria\b/, title: () => "Hipersensibilidad dentinaria" , fallback: true },
  { re: /\bperi[\s-]*implantitis\b/, title: () => "Periimplantitis" , fallback: true },
  { re: /\bmucositis\s+peri[\s-]*implantaria\b/, title: () => "Mucositis periimplantaria" , fallback: true },
  { re: /\bestomatitis\s+subprotesica\b/, title: () => "Estomatitis subprotésica" , fallback: true },
  { re: /\bdesdentad[oa]\s+total\b|\bedentulismo\s+total\b/, title: () => "Desdentado total" },
  { re: /\bcomunicacion\s+(oro[\s-]*antral|oro[\s-]*sinusal|oro[\s-]*nasal)\b/, title: (m) => `Comunicación ${m[1].replace(/[\s-]/g, "")}` , fallback: true },
  { re: /\bhemorragia\s+post[\s-]*(?:exodoncia|extraccion)\b/, title: () => "Hemorragia posexodoncia" , fallback: true },
  { re: /\bfractura\s+(?:del\s+)?(?:proceso\s+)?alveolar\b/, title: () => "Fractura alveolar" , fallback: true },
  { re: /\bfractura\s+radicular\s+vertical\b|\bfractura\s+vertical\s+(?:de\s+(?:la\s+)?)?raiz\b|\bsindrome\s+del\s+diente\s+fisurado\b/, title: () => "Fractura radicular vertical / diente fisurado" , fallback: true },
  { re: /\bdiente\s+invaginado\b|\bdens\s+(?:in\s+dente|invaginatus)\b/, title: () => "Diente invaginado (dens in dente)" , fallback: true },
  { re: /\bfluorosis\s+(?:dental|dentaria)\b/, title: () => "Fluorosis dental" , fallback: true },
  { re: /\beritroleucoplasia\b/, title: () => "Eritroleucoplasia" , fallback: true },
  { re: /\bsinusitis\s+odontogenica\b/, title: () => "Sinusitis maxilar de origen odontogénico" , fallback: true },
  { re: /\bameloblastoma\b/, title: () => "Ameloblastoma" , fallback: true },
  { re: /\bcaries\s+(?:secundaria|recurrente)\b/, title: () => "Caries secundaria (recurrente)", fallback: true },
  { re: /\bfisura\s+labio[\s-]*(?:alveolo[\s-]*)?palatina\b|\bfisura\s+(?:del\s+)?labio\s+y\s+(?:del\s+)?paladar\b/, title: () => "Fisura labiopalatina (la CIE-11 la separa en fisura labial/alveolar LA40-LA41 y fisura del paladar LA42)" , fallback: true },
  { re: /\bgingivitis\s+marginal(?:\s+simple)?\b/, title: () => "Gingivitis marginal simple" , fallback: true },
  { re: /\bgingivitis\s+hiperplasica\b/, title: () => "Gingivitis hiperplásica" , fallback: true },
];

function roman(value: string): string {
  const map: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV", uno: "I", dos: "II", tres: "III", cuatro: "IV" };
  return map[value] ?? value.toUpperCase();
}

/** Diagnóstico reconocido en un texto: con código (`code`) o etiqueta sin código (`code` = ""). */
export type DiagnosisMatch = { code: string; title: string; term: string; suggested?: SuggestedMapping };

export function diagnosisMatches(text: string): DiagnosisMatch[] {
  const original = text.normalize("NFC");
  const t = fold(original);
  // El término se devuelve tal como se dijo (con tildes) cuando el texto plegado conserva las posiciones.
  const said = (match: RegExpExecArray) => (t.length === original.length ? original.slice(match.index, match.index + match[0].length) : match[0]);
  const found: DiagnosisMatch[] = [];
  const matchedRanges: Array<[number, number]> = [];
  const overlaps = (ranges: Array<[number, number]>, start: number, end: number) =>
    ranges.some(([left, right]) => start < right && end > left);
  for (const rule of RULES) {
    const match = rule.re.exec(t);
    if (!match) continue;
    if (rule.dentalOnly && !dentalContext(t)) continue;
    // Una regla más específica ya cubrió esta frase («periodontitis aguda apical» no es además «periodontitis aguda»).
    if (overlaps(matchedRanges, match.index, match.index + match[0].length)) continue;
    if (found.some((done) => done.code && family(done.code) === family(rule.code))) continue;
    const entry = ICD11[rule.code];
    found.push({ code: entry.code, title: entry.title, term: said(match), ...(rule.aae ? { suggested: { from: "AAE" as const, term: said(match) } } : {}) });
    matchedRanges.push([match.index, match.index + match[0].length]);
  }

  const uncoded: DiagnosisMatch[] = [];
  const uncodedRanges: Array<[number, number]> = [];
  for (const rule of UNCODED) {
    if (rule.fallback) continue;
    const match = rule.re.exec(t);
    if (!match) continue;
    uncoded.push({ code: "", title: rule.title(match), term: said(match) });
    uncodedRanges.push([match.index, match.index + match[0].length]);
  }

  const catalogMatches: DiagnosisMatch[] = [];
  for (const candidate of CATALOG_DIAGNOSIS_TERMS) {
    const match = candidate.re.exec(t);
    if (!match) continue;
    if ((candidate.code === "DA08.11" || candidate.code === "DA08.12") && !dentalContext(t)) continue;
    const start = match.index, end = start + match[0].length;
    // Si una regla clínica o una etiqueta sin código ya cubre la frase, conserva esa decisión más específica.
    if (overlaps(matchedRanges, start, end) || overlaps(uncodedRanges, start, end)) continue;
    if ([...found, ...catalogMatches].some((done) => done.code && family(done.code) === family(candidate.code))) continue;
    catalogMatches.push({ code: candidate.code, title: candidate.title, term: candidate.term });
    matchedRanges.push([start, end]);
  }
  // Etiquetas de respaldo: solo cuando ningún código verificado cubre ese mismo término.
  for (const rule of UNCODED) {
    if (!rule.fallback) continue;
    const match = rule.re.exec(t);
    if (!match) continue;
    const start = match.index, end = start + match[0].length;
    if (overlaps(matchedRanges, start, end) || overlaps(uncodedRanges, start, end)) continue;
    uncoded.push({ code: "", title: rule.title(match), term: said(match) });
    uncodedRanges.push([start, end]);
  }
  return [...found, ...catalogMatches, ...uncoded];
}

/** Diagnósticos con código CIE-11 en un texto (sin las etiquetas sin código). */
export function icd11FromText(text: string): Icd11Entry[] {
  return diagnosisMatches(text).filter((item) => item.code).map((item) => ICD11[item.code]);
}

/** Etiquetas sin código que se pueden elegir a mano en la búsqueda. */
export const UNCODED_TAGS = [
  "Gingivitis inducida por placa (biofilm)",
  "Periodontitis (clasificación 2017, indicar estadio y grado)",
  "Hipomineralización incisivo-molar (HIM)",
  "Maloclusión clase II división 1",
  "Maloclusión clase III",
  "Bruxismo (sin precisar si es del sueño o de vigilia)",
  "Periodontitis crónica (clasificación previa a 2017)",
  "Gingivitis úlcero necrótica",
  "Flegmón de origen odontogénico",
  "Celulitis facial de origen odontogénico",
  "Hipersensibilidad dentinaria",
  "Periimplantitis",
  "Estomatitis subprotésica",
  "Desdentado total",
];

/** Diagnósticos dictados sin un código CIE-11 verificado: se registran sin código. */
export const ICD11_UNMAPPED = [...UNCODED_TAGS, "superficie palatina (se guarda como cara P del hallazgo, sin extensión CIE-11)"];

/** Sinónimos adicionales para buscar (términos AAE y de uso chileno), además de los del catálogo. */
const EXTRA_SYNONYMS: Record<string, string[]> = {
  "DA08.10": ["atrición", "atricion"],
  "DA09.70": ["periodontitis apical sintomática"],
  "DA09.71": ["periodontitis apical asintomática"],
  "DA09.62": ["absceso apical agudo"],
  "DA09.61": ["absceso apical crónico"],
  "DA09.6Z": ["absceso periapical", "absceso apical"],
  "DA09.7Z": ["periodontitis apical", "periodontitis periapical"],
  "1C1H.Z": ["gingivitis ulcerativa necrotizante", "GUN", "GUNA"],
};

export type DiagnosisSearchResult = { code: string; title: string; matched: string; group: string };

/**
 * Búsqueda por código, título o sinónimo chileno (sin tildes ni mayúsculas). Solo devuelve códigos guardables
 * (hojas troncales) y las etiquetas sin código. Una categoría con subcódigos remite a su residual «sin especificación».
 */
export function searchDiagnoses(query: string, limit = 12): DiagnosisSearchResult[] {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const scored: Array<DiagnosisSearchResult & { score: number }> = [];
  const seen = new Set<string>();
  const add = (code: string, title: string, matched: string, group: string, score: number) => {
    const key = code || title;
    const prior = scored.find((item) => (item.code || item.title) === key);
    if (prior) { if (score > prior.score) Object.assign(prior, { matched, score }); return; }
    if (seen.has(key) && !prior) return;
    seen.add(key);
    scored.push({ code, title, matched, group, score });
  };
  const score = (candidate: string): number => {
    const c = fold(candidate);
    if (c === q) return 100;
    if (c.startsWith(q)) return 80;
    if (words.every((word) => c.includes(word))) return c.includes(q) ? 60 : 40;
    return 0;
  };
  for (const entry of ICD11_CATALOG) {
    if (entry.kind !== "stem") continue;
    // Una categoría padre remite a su «sin especificación» (p. ej. DA09.6 → DA09.6Z).
    const target = entry.isLeaf ? entry : CATALOG_BY_CODE.get(`${entry.code}Z`) ?? CATALOG_BY_CODE.get(`${entry.code}.Z`);
    if (!target || !target.isLeaf) continue;
    const title = ICD11[target.code].title;
    const names = [entry.code, title, entry.title, ...entry.synonyms, ...(EXTRA_SYNONYMS[entry.code] ?? [])];
    let best = 0, matched = "";
    for (const name of names) {
      const base = score(name);
      if (!base) continue;
      const s = base + (name === entry.code ? 5 : 0) - (entry.isLeaf ? 0 : 3) - (target.isResidual ? 2 : 0);
      if (s > best) { best = s; matched = name; }
    }
    if (best > 0) add(target.code, title, matched, entry.group, best);
  }
  for (const title of UNCODED_TAGS) {
    const s = score(title);
    if (s > 0) add("", title, title, "Sin código CIE-11", s - 1);
  }
  // The score is used for ranking only and is deliberately omitted from the public result.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit).map(({ score: _score, ...rest }) => rest);
}


const NEAREST_STOP = new Set(["de", "del", "la", "el", "los", "las", "por", "y", "e", "con", "en", "a", "al", "un", "una", "otro", "otra", "otros", "otras", "especificado", "especificada", "especificados", "especificadas", "debido", "causa", "tipo"]);
const stemWords = (text: string) => fold(text).split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !NEAREST_STOP.has(word)).map((word) => (word.length > 6 ? word.slice(0, 6) : word));

/**
 * Diagnóstico del catálogo más cercano a un término que ninguna regla ni sinónimo reconoció (similitud de palabras
 * con el título y los sinónimos). Solo propone si el parecido es claro y hay un ganador; el profesional lo confirma.
 */
export function nearestDiagnosis(term: string): { code: string; title: string; score: number } | null {
  const wanted = stemWords(term);
  if (wanted.length === 0) return null;
  const wantedSet = new Set(wanted);
  const scored: Array<{ code: string; title: string; score: number }> = [];
  for (const entry of ICD11_CATALOG) {
    if (entry.kind !== "stem" || !entry.isLeaf || entry.isResidual) continue;
    let best = 0;
    for (const name of [entry.title, ...entry.synonyms]) {
      const words = new Set(stemWords(name));
      if (!words.size) continue;
      let shared = 0;
      for (const word of wantedSet) if (words.has(word)) shared += 1;
      best = Math.max(best, (2 * shared) / (wantedSet.size + words.size));
    }
    if (best > 0) scored.push({ code: entry.code, title: ICD11[entry.code]?.title ?? entry.title, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < 0.6) return null;
  if (second && first.score - second.score < 0.08) return null;
  return first;
}
