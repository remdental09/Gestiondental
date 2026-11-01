/**
 * Caries por profundidad de la lesión, como se registra en Chile:
 * esmalte, dentina superficial, dentina profunda y compromiso pulpar.
 * Las fichas antiguas pueden traer ICDAS (1–6) y actividad; se conservan y se muestran como registro anterior.
 */
export const CARIES_DEPTHS = ["esmalte", "dentina_superficial", "dentina_profunda", "pulpar"] as const;
export type CariesDepth = (typeof CARIES_DEPTHS)[number];

export const CARIES_DEPTH_LABEL: Record<CariesDepth, string> = {
  esmalte: "Caries de esmalte",
  dentina_superficial: "Caries de dentina superficial",
  dentina_profunda: "Caries de dentina profunda",
  pulpar: "Caries con compromiso pulpar",
};

/** Etiqueta corta para listas y selectores. */
export const CARIES_DEPTH_SHORT: Record<CariesDepth, string> = {
  esmalte: "Esmalte",
  dentina_superficial: "Dentina superficial",
  dentina_profunda: "Dentina profunda",
  pulpar: "Compromiso pulpar",
};

export const CARIES_DEPTH_QUESTION = "esmalte, dentina superficial, dentina profunda o compromiso pulpar";

export const isCariesDepth = (value: unknown): value is CariesDepth => typeof value === "string" && (CARIES_DEPTHS as readonly string[]).includes(value);

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export type DepthReading = { depth: CariesDepth | null; ambiguous?: string };

/**
 * Lee la profundidad dicha: «caries de esmalte», «dentina superficial», «caries profunda»,
 * «penetrante» o «compromiso pulpar». «Caries de dentina» o «caries superficial» solas quedan ambiguas.
 */
export function cariesDepthFrom(text: string): DepthReading {
  const t = fold(text);
  const found: CariesDepth[] = [];
  if (/\b(?:compromiso|exposicion|comunicacion)\s+(?:de\s+(?:la\s+)?)?pulp(?:ar|a)\b|\bpulpa\s+expuesta\b|\bpenetrante\b|\bcaries\s+pulpar\b/.test(t)) found.push("pulpar");
  if (/\bdentina\s+profunda\b|\bcaries\s+(?:\w+\s+){0,3}?profunda\b|\bprofunda\s+en\s+dentina\b/.test(t)) found.push("dentina_profunda");
  if (/\bdentina\s+(?:superficial|media|externa)\b|\bcaries\s+(?:\w+\s+){0,3}?(?:media|mediana)\b/.test(t)) found.push("dentina_superficial");
  if (/\besmalte\b|\bmancha\s+blanca\b|\bincipiente\b/.test(t)) found.push("esmalte");
  const unique = [...new Set(found)];
  if (unique.length === 1) return { depth: unique[0] };
  if (unique.length > 1) return { depth: null, ambiguous: "Se dijo más de una profundidad" };
  if (/\bdentina\b/.test(t)) return { depth: null, ambiguous: "Caries de dentina sin decir si es superficial o profunda" };
  if (/\bcaries\s+(?:\w+\s+){0,3}?superficial\b/.test(t)) return { depth: null, ambiguous: "«Superficial» puede ser esmalte o dentina superficial" };
  return { depth: null };
}

type AnyFinding = { condition?: string; depth?: CariesDepth | null; icdas?: number | null; activity?: string | null };

/** Detalle de una caries: profundidad si existe; si no, el ICDAS de un registro anterior; si no, sin registrar. */
export function cariesDetail(finding: AnyFinding): string {
  const parts: string[] = [];
  if (finding.depth && isCariesDepth(finding.depth)) parts.push(CARIES_DEPTH_SHORT[finding.depth]);
  else if (finding.icdas) parts.push(`ICDAS ${finding.icdas} (registro anterior)`);
  else parts.push("profundidad sin registrar");
  if (finding.activity === "active") parts.push("activa");
  else if (finding.activity === "inactive") parts.push("inactiva");
  return parts.join(" · ");
}
