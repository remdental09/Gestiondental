/**
 * CIE-11 (OMS, versión MMS 2026-01) para diagnósticos odontológicos.
 * Cada código y título se verificó contra la fuente oficial de la OMS:
 *  - tabla oficial: https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip
 *  - títulos en español: https://icd.who.int/browse/2026-01/mms/es#<id>
 * No agregar códigos sin verificarlos en esas fuentes.
 *
 * En CIE-11 la caries es una sola categoría (DA08.0 Caries dental); la profundidad se expresa por
 * poscoordinación con «Partes del diente» (XA1PT3): Esmalte XA5R09, Dentina XA6FX3, Pulpa XA5B71.
 * CIE-11 no separa dentina superficial de dentina profunda: ambas llevan DA08.0&XA6FX3.
 */
import type { CariesDepth } from "./caries.ts";

export type Icd11Entry = { code: string; title: string; titleEn: string; id: string };

const BROWSER = "https://icd.who.int/browse/2026-01/mms/es#";
export const icd11Url = (entry: Pick<Icd11Entry, "id">) => `${BROWSER}${entry.id}`;

export const ICD11: Record<string, Icd11Entry> = {
  "DA08.0": { code: "DA08.0", title: "Caries dental", titleEn: "Dental caries", id: "1983306720" },
  XA5R09: { code: "XA5R09", title: "Esmalte", titleEn: "Enamel", id: "1839377909" },
  XA6FX3: { code: "XA6FX3", title: "Dentina", titleEn: "Dentin", id: "1423573173" },
  XA5B71: { code: "XA5B71", title: "Pulpa", titleEn: "Pulp", id: "1620542411" },
  "DA08.10": { code: "DA08.10", title: "Erosión excesiva de los dientes", titleEn: "Excessive attrition of teeth", id: "421732399" },
  "DA08.11": { code: "DA08.11", title: "Abrasión de los dientes", titleEn: "Abrasion of teeth", id: "2087251387" },
  "DA08.12": { code: "DA08.12", title: "Erosión de los dientes", titleEn: "Erosion of teeth", id: "147176774" },
  "DA08.13": { code: "DA08.13", title: "Abfracción", titleEn: "Abfraction", id: "805506345" },
  "DA08.3": { code: "DA08.3", title: "Fractura no traumática de diente", titleEn: "Nontraumatic fracture of tooth", id: "1299071429" },
  "DA09.0": { code: "DA09.0", title: "Pulpitis", titleEn: "Pulpitis", id: "576344431" },
  "DA09.1": { code: "DA09.1", title: "Necrosis de la pulpa", titleEn: "Necrosis of pulp", id: "1192336635" },
  "DA09.2": { code: "DA09.2", title: "Absceso de la pulpa", titleEn: "Pulp abscess", id: "1391556257" },
  "DA09.6": { code: "DA09.6", title: "Absceso periapical", titleEn: "Periapical abscess", id: "2050987051" },
  "DA09.61": { code: "DA09.61", title: "Absceso periapical con fístula", titleEn: "Periapical abscess with sinus", id: "889130863" },
  "DA09.62": { code: "DA09.62", title: "Absceso periapical sin fístula", titleEn: "Periapical abscess without sinus", id: "1370800891" },
  "DA09.7": { code: "DA09.7", title: "Periodontitis periapical", titleEn: "Periapical periodontitis", id: "1395124674" },
  "DA09.70": { code: "DA09.70", title: "Periodontitis apical aguda originada en la pulpa", titleEn: "Acute apical periodontitis of pulpal origin", id: "622432774" },
  "DA09.71": { code: "DA09.71", title: "Periodontitis apical crónica", titleEn: "Chronic apical periodontitis", id: "1079140240" },
  "DA09.8": { code: "DA09.8", title: "Quiste radicular", titleEn: "Radicular cyst", id: "752736185" },
  "DA0A.1": { code: "DA0A.1", title: "Pérdida de dientes por traumatismo, extracción o enfermedad periodontal focal", titleEn: "Loss of teeth due to accident, extraction or local periodontal disease", id: "135458681" },
  "DA0A.3": { code: "DA0A.3", title: "Raíz dental retenida", titleEn: "Retained dental root", id: "435450388" },
  "DA0B.6": { code: "DA0B.6", title: "Pericoronitis", titleEn: "Pericoronitis", id: "1764886525" },
  "DA0C.0": { code: "DA0C.0", title: "Periodontitis aguda", titleEn: "Acute periodontitis", id: "792986757" },
  "DA0C.1": { code: "DA0C.1", title: "Periodontitis agresiva", titleEn: "Aggressive periodontitis", id: "351042657" },
  "DA0C.4": { code: "DA0C.4", title: "Absceso del periodonto", titleEn: "Abscess of periodontium", id: "946135091" },
  "DA0D.0": { code: "DA0D.0", title: "Retracción gingival", titleEn: "Gingival recession", id: "1059404242" },
  "DA0D.1": { code: "DA0D.1", title: "Agrandamiento gingival", titleEn: "Gingival enlargement", id: "1517220932" },
  "NA0D.00": { code: "NA0D.00", title: "Infracción de esmalte", titleEn: "Enamel infraction", id: "1539708026" },
  "NA0D.01": { code: "NA0D.01", title: "Fractura de esmalte", titleEn: "Enamel fracture", id: "1517691500" },
  "NA0D.02": { code: "NA0D.02", title: "Fractura de dentina-esmalte", titleEn: "Enamel-dentin fracture", id: "551460603" },
  "NA0D.03": { code: "NA0D.03", title: "Fractura de la corona, complicada", titleEn: "Complicated crown fracture", id: "1127661061" },
  "NA0D.06": { code: "NA0D.06", title: "Fractura de la raíz del diente", titleEn: "Root fracture", id: "61783276" },
};

/** Código CIE-11 para una caries según profundidad (poscoordinado cuando la profundidad se conoce). */
export type Icd11Code = { code: string; title: string };

const CARIES_PART: Record<CariesDepth, string> = {
  esmalte: "XA5R09",
  dentina_superficial: "XA6FX3",
  dentina_profunda: "XA6FX3",
  pulpar: "XA5B71",
};

export function cariesIcd11(depth: CariesDepth | null | undefined): Icd11Code {
  const base = ICD11["DA08.0"];
  if (!depth) return { code: base.code, title: base.title };
  const part = ICD11[CARIES_PART[depth]];
  return { code: `${base.code}&${part.code}`, title: `${base.title} · ${part.title}` };
}

export const icd11Label = (icd: Icd11Code) => `CIE-11 ${icd.code} ${icd.title}`;

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Diagnósticos dictados por el profesional que tienen código CIE-11 verificado.
 * Solo reconoce el nombre del diagnóstico; no deduce diagnósticos a partir de síntomas.
 */
const RULES: Array<{ re: RegExp; code: string }> = [
  { re: /\bperiodontitis\s+apical\s+aguda\b/, code: "DA09.70" },
  { re: /\bperiodontitis\s+apical\s+cronica\b/, code: "DA09.71" },
  { re: /\bperiodontitis\s+(?:periapical|apical)\b/, code: "DA09.7" },
  { re: /\babsceso\s+(?:periapical|apical)\s+con\s+fistula\b/, code: "DA09.61" },
  { re: /\babsceso\s+(?:periapical|apical)\s+sin\s+fistula\b/, code: "DA09.62" },
  { re: /\babsceso\s+(?:periapical|apical)\b/, code: "DA09.6" },
  { re: /\babsceso\s+(?:periodontal|del\s+periodonto)\b/, code: "DA0C.4" },
  { re: /\babsceso\s+pulpar\b|\babsceso\s+de\s+la\s+pulpa\b/, code: "DA09.2" },
  { re: /\bnecrosis\s+pulpar\b|\bnecrosis\s+de\s+(?:la\s+)?pulpa\b/, code: "DA09.1" },
  { re: /\bpulpitis\b/, code: "DA09.0" },
  { re: /\bquiste\s+radicular\b/, code: "DA09.8" },
  { re: /\bpericoronaritis\b|\bpericoronitis\b/, code: "DA0B.6" },
  { re: /\bperiodontitis\s+agresiva\b/, code: "DA0C.1" },
  { re: /\bperiodontitis\s+aguda\b/, code: "DA0C.0" },
  { re: /\b(?:retraccion|recesion)\s+gingival\b/, code: "DA0D.0" },
  { re: /\b(?:agrandamiento|hiperplasia)\s+gingival\b/, code: "DA0D.1" },
  { re: /\batricion\b/, code: "DA08.10" },
  { re: /\babrasion\b/, code: "DA08.11" },
  { re: /\berosion\b/, code: "DA08.12" },
  { re: /\babfraccion\b/, code: "DA08.13" },
  { re: /\bfractura\s+no\s+traumatica\b/, code: "DA08.3" },
  { re: /\binfraccion\s+(?:del?\s+)?esmalte\b/, code: "NA0D.00" },
  { re: /\bfractura\s+(?:de\s+)?(?:esmalte\s+y\s+dentina|esmalte[\s-]+dentina|dentina[\s-]+esmalte|dentina\s+y\s+esmalte)\b/, code: "NA0D.02" },
  { re: /\bfractura\s+(?:del?\s+)?esmalte\b/, code: "NA0D.01" },
  { re: /\bfractura\s+(?:coronaria|de\s+(?:la\s+)?corona)\s+complicada\b/, code: "NA0D.03" },
  { re: /\bfractura\s+(?:radicular|de\s+(?:la\s+)?raiz)\b/, code: "NA0D.06" },
  { re: /\bresto\s+radicular\b|\braiz\s+(?:dental\s+)?retenida\b/, code: "DA0A.3" },
];

/** Más específico primero: si «absceso periapical con fístula» calza, no se agrega también «absceso periapical». */
export function icd11FromText(text: string): Icd11Entry[] {
  const t = fold(text);
  const found: Icd11Entry[] = [];
  for (const rule of RULES) {
    if (!rule.re.test(t)) continue;
    const entry = ICD11[rule.code];
    if (found.some((done) => done.code.startsWith(entry.code) || (entry.code.startsWith("DA09.7") && done.code.startsWith("DA09.7")) || (entry.code.startsWith("DA09.6") && done.code.startsWith("DA09.6")) || (entry.code.startsWith("NA0D.0") && done.code.startsWith("NA0D.0")))) continue;
    found.push(entry);
  }
  return found;
}

/** Diagnósticos dictados sin un código CIE-11 verificado en esta lista: se registran sin código. */
export const ICD11_UNMAPPED = ["gingivitis (sin tipo)", "periodontitis crónica / estadios y grados", "desdentamiento total o parcial sin causa", "fractura sin precisar si es traumática"];
