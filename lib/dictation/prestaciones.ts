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

function make(code: string, tooth: number | null, evidence: string, index: number): PrestacionItem | null {
  const found = byCode.get(code);
  return found ? { id: `pr-${index}`, code, name: found.name, tooth, evidence: evidence.slice(0, 300) } : null;
}

type Material = "composite" | "amalgama" | "ionomero";

function materialOf(text: string): Material | null {
  const plain = fold(text);
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

const KEYWORDS: Array<{ test: RegExp; code: (text: string) => string | null }> = [
  { test: /\bdestartraje\b|\bprofilaxis\b|\bhigiene\s+(?:oral|dental)\b|\blimpieza\s+(?:dental|coronaria)\b/, code: (t) => (/\buna\s+arcada\b|\bsolo\s+(?:la\s+)?(?:superior|inferior)\b/.test(t) ? "5001039" : /\bseis\s+grupos\b|\bgrupo\s+\d\b|\bsubgingival\b/.test(t) ? null : "5001030") },
  { test: /\bsellantes?\b/, code: () => "5005012" },
  { test: /\bexodoncia\b|\bextraccion\b|\bse\s+extrae\b/, code: (t) => (/\bresto\s+radicular\b/.test(t) ? "5001041" : /\bterce(?:r|ros)\s+molar|\bmuela\s+del\s+juicio\b|\bcordal/.test(t) ? "5003045" : "5003001") },
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
export function suggestPrestaciones(odontogram: OdontogramChange[], procedureLines: string[], coded: CodedProcedure[] = []): PrestacionItem[] {
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
  const modelCoded = new Set(coded.filter((proc) => proc.code && byCode.has(proc.code.trim())).map((proc) => fold(proc.text)));
  for (const line of procedureLines) {
    const plain = fold(line);
    const teeth = teethOf(line);
    if (skipRestoration(plain, teeth)) continue;
    let ruled = false;
    for (const rule of KEYWORDS) {
      if (!rule.test.test(plain)) continue;
      const code = rule.code(plain);
      if (code) { ruled = true; push(make(code, teeth.length === 1 ? teeth[0] : null, line, out.length + 1)); }
    }
    // Sin regla ni código del modelo: búsqueda por palabras, solo si la coincidencia es clara (si hay duda, no se asigna).
    if (!ruled && ![...modelCoded].some((text) => text && (plain.includes(text) || text.includes(plain)))) {
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
