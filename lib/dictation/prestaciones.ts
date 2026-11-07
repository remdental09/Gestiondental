/**
 * Prestaciones del arancel (catálogo de isapre) sugeridas desde lo realizado hoy. Sin dinero: solo código y nombre.
 * Reglas determinísticas: una obturación se clasifica por material, tipo de diente (anterior/posterior) y número de
 * caras; el resto de los procedimientos se busca por palabras clave. Nada se guarda sin que el profesional lo acepte.
 */
import { PRESTACIONES, matchPrestacion, prestacionLabel } from "../prestaciones-catalog.ts";
import type { OdontogramChange } from "./proposal.ts";

export type PrestacionItem = { id: string; code: string; name: string; tooth: number | null; evidence: string };

export const PRESTACIONES_HEADER = "Prestaciones (arancel)";

const byCode = new Map(PRESTACIONES.map((item) => [item.code, item]));
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const prestacionText = (item: Pick<PrestacionItem, "code" | "name" | "tooth">): string =>
  `${item.code} · ${prestacionLabel(item.name)}${item.tooth ? ` (FDI ${Math.floor(item.tooth / 10)}.${item.tooth % 10})` : ""}`;

/** Nombre de la prestación para mostrar en pantalla: sin código, con la pieza si la hay. */
export const prestacionName = (item: Pick<PrestacionItem, "name" | "tooth">): string =>
  `${prestacionLabel(item.name)}${item.tooth ? ` (FDI ${Math.floor(item.tooth / 10)}.${item.tooth % 10})` : ""}`;

function make(code: string, tooth: number | null, evidence: string, index: number): PrestacionItem | null {
  const found = byCode.get(code);
  return found ? { id: `pr-${index}`, code, name: found.name, tooth, evidence: evidence.slice(0, 300) } : null;
}

type Material = "composite" | "amalgama" | "ionomero";

function materialOf(text: string): Material | null {
  const plain = fold(text);
  // «Cambio de amalgama por resina»: vale el material nuevo.
  const replacement = plain.match(/\bpor\s+(?:una?\s+)?(?:restauracion\s+(?:de\s+)?)?(resina|composite|ionomero|amalgama)/);
  if (replacement && /\b(?:cambio|recambio|reemplazo|reposicion|reemplaz\w*)\b/.test(plain)) return replacement[1] === "amalgama" ? "amalgama" : replacement[1] === "ionomero" ? "ionomero" : "composite";
  if (/amalgama/.test(plain)) return "amalgama";
  if (/ionomero|\bciv\b/.test(plain)) return "ionomero";
  if (/resina|composite|composit|fotocur/.test(plain)) return "composite";
  return null;
}

/** Código de arancel para una obturación según material, diente anterior/posterior y número de caras. */
export function restorationCode(material: Material, tooth: number, faces: number): string | null {
  const anterior = tooth % 10 <= 3;
  if (material === "amalgama") return faces >= 2 ? "5005002" : "5005001";
  if (material === "ionomero") return "5005004";
  if (anterior) return faces >= 3 ? "5005041" : faces === 2 ? "5005006" : "5005005";
  return faces >= 3 ? "5005040" : faces === 2 ? "5005018" : "5005017";
}

/** Tratamiento de conductos según grupo dentario y vitalidad (necrosis / lesión apical → «con lesión apical»). Sin saber la vitalidad no se sugiere. */
export function endodonticCode(tooth: number, context: string): string | null {
  const unit = tooth % 10;
  if (tooth >= 50 || unit < 1 || unit > 8) return null;
  const lesion = /necrosis|necrotic|lesion\s+apical|periodontitis\s+apical|absceso|granuloma|fistula|quiste\s+(?:radicular|periapical)/.test(context);
  const vital = /pulpitis|vital|pulpectomia\s+de\s+urgencia|pulpitis\s+irreversible/.test(context);
  if (!lesion && !vital) return null;
  const upper = Math.floor(tooth / 10) <= 2;
  if (unit <= 3) return lesion ? "5006007" : "5006001";
  if (unit <= 5) return lesion ? "5006008" : "5006002";
  return upper ? (lesion ? "5006016" : "5006015") : (lesion ? "5006009" : "5006003");
}

const KEYWORDS: Array<{ test: RegExp; code: (text: string, teeth?: number[], context?: string) => string | null }> = [
  { test: /\btratamiento\s+(?:de\s+)?(?:conductos?|endodontic\w*)|\bendodoncia\b|\bpulpectomia\b|\bbiopulpectomia\b|\bnecropulpectomia\b/, code: (t, teeth = [], context = "") => (/retratamiento|desobtur|apertura\s+(?:cameral\s+)?y\s+medicacion|medicacion\s+intraconducto/.test(t) || teeth.length !== 1 ? null : endodonticCode(teeth[0], `${t} ${context}`)) },
  { test: /\bdestartraje\b|\bprofilaxis\b|\bhigiene\s+(?:oral|dental)\b|\blimpieza\s+(?:dental|coronaria)\b/, code: (t) => (/\buna\s+arcada\b|\bsolo\s+(?:la\s+)?(?:superior|inferior)\b/.test(t) ? "5001039" : /\bseis\s+grupos\b|\bgrupo\s+\d\b|\bsubgingival\b/.test(t) ? null : "5001030") },
  { test: /\bsellantes?\b/, code: () => "5005012" },
  // En el arancel, «pulido radicular» es el raspado y alisado por sextante: moderado a avanzado si hay bolsas profundas.
  { test: /\braspado\s+y\s+alisado\b|\balisado\s+radicular\b|\bpulido\s+radicular\b|\braspaje\b/, code: (t) => (/avanzad|bolsas?\s+profundas?|\b[6-9]\s*(?:mm|milimetros)\b/.test(t) ? "5009012" : "5009003") },
  { test: /\bdestartraje\s+subgingival\b/, code: () => "5009013" },
  { test: /\bexodoncia\b|\bextraccion\b|\bse\s+extrae\b/, code: (t) => (/\bresto\s+radicular\b/.test(t) ? "5001041" : /\bterce(?:r|ros)\s+molar|\bmuela\s+del\s+juicio\b|\bcordal/.test(t) ? "5003045" : "5003001") },
  { test: /\b(?:se\s+)?(?:instal|coloc)\w*\s+(?:un\s+|el\s+|los\s+|dos\s+)?implantes?\b|\binstalacion\s+de\s+(?:un\s+)?implante|\bimplantes?\s+(?:inmediato|unitario)\b/, code: (t) => (/corona|pilar\s+de\s+cicatrizacion|provisori|segunda\s+fase|control|\binstalar|\bcolocar|\bplan\b|\ben\s+\w+\s+meses|se\s+planifica|diferid/.test(t) ? null : "5011001") },
  { test: /\belevacion\s+(?:de\s+)?(?:del\s+)?seno|\bantrotomia\b|\bsinus\s+lift\b/, code: () => "5011005" },
  { test: /\bpreservacion\s+alveolar\b/, code: () => "5011020" },
  { test: /\bradiografia\s+retroalveolar\b/, code: () => "5002001" },
  { test: /\bradiografia\s+panoramica\b|\bortopantomografia\b/, code: () => "5002010" },
  { test: /\bbite\s?wing\b|\baleta\s+mordida\b/, code: () => "5002004" },
  { test: /\bfluor(?:uro)?\b/, code: () => "5005033" },
  { test: /\bpulido\s+de\s+restauraciones\b/, code: () => "5005034" },
];

function teethOf(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/(?<![\p{L}\d.,])([1-8])\.([1-8])(?![\d])/gu)) out.push(Number(match[1]) * 10 + Number(match[2]));
  return out;
}

/** Procedimiento realizado hoy, con el código que el modelo eligió del catálogo (si eligió alguno). */
export type CodedProcedure = { text: string; evidence?: string; code?: string };

/**
 * Sugiere prestaciones desde las obturaciones del odontograma, los procedimientos con código elegido por el modelo
 * (validado contra el catálogo) y las líneas de «Procedimientos realizados» (reglas y búsqueda por palabras).
 */
export function suggestPrestaciones(odontogram: OdontogramChange[], procedureLines: string[], coded: CodedProcedure[] = [], dictated = ""): PrestacionItem[] {
  const out: PrestacionItem[] = [];
  const push = (item: PrestacionItem | null) => {
    if (!item) return;
    if (out.some((done) => done.code === item.code && done.tooth === item.tooth)) return;
    out.push({ ...item, id: `pr-${out.length + 1}` });
  };
  const restored = new Map<number, { faces: Set<string>; text: string }>();
  for (const item of odontogram) {
    if (item.kind !== "surface" || item.finding?.condition !== "restored" || !item.surface) continue;
    const entry = restored.get(item.tooth) ?? { faces: new Set<string>(), text: "" };
    entry.faces.add(item.surface);
    entry.text = `${entry.text} ${item.sourceText ?? ""} ${item.material ?? ""}`;
    restored.set(item.tooth, entry);
  }
  const covered = new Set<number>();
  for (const [tooth, entry] of restored) {
    const line = procedureLines.find((text) => teethOf(text).includes(tooth)) ?? "";
    const material = materialOf(`${line} ${entry.text}`);
    if (!material) continue;
    const code = restorationCode(material, tooth, entry.faces.size);
    if (code) { push(make(code, tooth, line || entry.text.trim(), out.length + 1)); covered.add(tooth); }
  }
  const skipRestoration = (plain: string, teeth: number[]) => teeth.length > 0 && teeth.every((tooth) => covered.has(tooth)) && /obturaci|restauraci|composite|resina/.test(plain);
  // Código elegido por el modelo: solo vale si existe en el catálogo; la pieza sale del texto del procedimiento.
  for (const proc of coded) {
    const code = (proc.code ?? "").trim();
    if (!code || !byCode.has(code)) continue;
    const teeth = teethOf(proc.text);
    if (skipRestoration(fold(proc.text), teeth)) continue;
    push(make(code, teeth.length === 1 ? teeth[0] : null, proc.evidence || proc.text, out.length + 1));
  }
  // Una oración que el modelo ya codificó no se vuelve a evaluar con reglas ni búsqueda: evita duplicados (p. ej. un
  // sellante por pieza del modelo más el sellante de la regla) cuando la nota reescribe la frase.
  const contentWords = (value: string) => new Set(fold(value).replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter((word) => word.length > 3 || /^\d\.\d$/.test(word)).map((word) => word.slice(0, 6)));
  const modelWords = coded.filter((proc) => proc.code && byCode.has(proc.code.trim())).map((proc) => contentWords(proc.text));
  const modelCovers = (sentence: string) => {
    const words = contentWords(sentence);
    return words.size > 0 && modelWords.some((known) => known.size > 0 && [...words].filter((word) => known.has(word)).length / Math.min(words.size, known.size) >= 0.6);
  };
  const allPlain = fold(`${procedureLines.join(" ")} ${dictated}`);
  const implantTeeth = new Set(odontogram.filter((item) => item.kind === "status" && item.status === "Implante" && !item.advisory).map((item) => item.tooth));
  const sentencesOfLines = procedureLines.flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u).map((part) => part.trim()).filter(Boolean));
  for (const line of sentencesOfLines) {
    if (modelCovers(line)) continue;
    const plain = fold(line);
    const teeth = [...new Set(teethOf(line))];
    if (skipRestoration(plain, teeth)) continue;
    let ruled = false;
    for (const rule of KEYWORDS) {
      if (!rule.test.test(plain)) continue;
      let code = rule.code(plain, teeth, allPlain);
      // Extracción de una pieza que queda con implante en la misma sesión: «extracción para implante inmediato».
      if (code === "5003001" && teeth.length === 1 && (implantTeeth.has(teeth[0]) || /implante\s+inmediato/.test(plain))) code = "5011018";
      if (code) { ruled = true; push(make(code, teeth.length === 1 ? teeth[0] : null, line, out.length + 1)); }
    }
    // Sin regla ni código del modelo: búsqueda por palabras, solo si la coincidencia es clara (si hay duda, no se asigna).
    if (!ruled) {
      const found = matchPrestacion(line.replace(/\b[1-8]\.[1-8]\b/g, " "));
      if (found) push(make(found.code, teeth.length === 1 ? teeth[0] : null, line, out.length + 1));
    }
  }
  return out;
}

/** Líneas de la sección «Procedimientos realizados» de una nota. */
export function procedureLinesOf(body: string): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "Procedimientos realizados");
  if (start < 0) return [];
  const out: string[] = [];
  for (let index = start + 1; index < lines.length && lines[index].trim() !== ""; index++) out.push(lines[index].trim());
  return out;
}

/** Reemplaza la sección «Prestaciones (arancel)» de la nota por las prestaciones aceptadas. */
export function withPrestacionesSection(body: string, items: Pick<PrestacionItem, "code" | "name" | "tooth">[]): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => line.trim() === PRESTACIONES_HEADER);
  if (at >= 0) {
    let stop = at + 1;
    while (stop < lines.length && lines[stop].trim() !== "") stop += 1;
    lines.splice(at, stop - at + (stop < lines.length ? 1 : 0));
  }
  if (!items.length) return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const cut = lines.findIndex((line) => line.trim() === "Transcripción completa");
  const end = cut >= 0 ? cut : lines.length;
  lines.splice(end, 0, ...(end > 0 && lines[end - 1].trim() !== "" ? [""] : []), PRESTACIONES_HEADER, ...items.map(prestacionText), "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
