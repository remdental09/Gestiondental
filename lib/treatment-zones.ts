/**
 * Zonas de aplicación de una prestación: no siempre es una pieza; a veces es un cuadrante,
 * un sextante, una arcada o la boca completa. Todo en FDI (permanente 1.1–4.8, temporal 5.1–8.5).
 * La zona se guarda como texto («perm:cuad-1») y se expande a las piezas FDI que cubre.
 */
export type Dentition = "perm" | "temp";
export type ZoneGroup = "general" | "cuadrante" | "sextante";
export type ZoneOption = { key: string; group: ZoneGroup; label: string; range: string; teeth: number[] };

const range = (quadrants: number[], last: number): number[] =>
  quadrants.flatMap(q => Array.from({ length: last }, (_, i) => q * 10 + i + 1));
const between = (quadrant: number, from: number, to: number): number[] => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let p = from; p !== to + step; p += step) out.push(quadrant * 10 + p);
  return out;
};
const sorted = (teeth: number[]) => [...new Set(teeth)].sort((a, b) => a - b);

/** Opciones de zona para la dentición dada. Los sextantes siguen la numeración del EPB MINSAL. */
export function zoneOptions(dentition: Dentition): ZoneOption[] {
  const perm = dentition === "perm";
  const upper = perm ? [1, 2] : [5, 6];
  const lower = perm ? [4, 3] : [8, 7];
  const last = perm ? 8 : 5;
  // posterior = molares/premolares (perm. 8–4; temp. 5–4); anterior = de canino a canino (3–1)
  const post = perm ? [8, 4] as const : [5, 4] as const;
  const fdi = (teeth: number[]) => `${teeth[0] / 10 | 0}.${teeth[0] % 10}–${teeth[teeth.length - 1] / 10 | 0}.${teeth[teeth.length - 1] % 10}`;
  const opt = (key: string, group: ZoneGroup, label: string, teeth: number[], text?: string): ZoneOption => {
    const t = sorted(teeth);
    return { key, group, label, range: text ?? fdi(t), teeth: t };
  };
  const quadrants = (perm ? [1, 2, 3, 4] : [5, 6, 7, 8]).map((q, i) => opt(`cuad-${i + 1}`, "cuadrante", `Cuadrante ${i + 1}`, range([q], last), `${q}.1–${q}.${last}`));
  const sextants = [
    opt("sext-1", "sextante", "Sextante 1 · Superior derecho", between(upper[0], post[0], post[1]), `${upper[0]}.${post[0]}–${upper[0]}.${post[1]}`),
    opt("sext-2", "sextante", "Sextante 2 · Superior anterior", [...between(upper[0], 3, 1), ...between(upper[1], 1, 3)], `${upper[0]}.3–${upper[1]}.3`),
    opt("sext-3", "sextante", "Sextante 3 · Superior izquierdo", between(upper[1], post[1], post[0]), `${upper[1]}.${post[1]}–${upper[1]}.${post[0]}`),
    opt("sext-4", "sextante", "Sextante 4 · Inferior derecho", between(lower[0], post[0], post[1]), `${lower[0]}.${post[0]}–${lower[0]}.${post[1]}`),
    opt("sext-5", "sextante", "Sextante 5 · Inferior anterior", [...between(lower[0], 3, 1), ...between(lower[1], 1, 3)], `${lower[0]}.3–${lower[1]}.3`),
    opt("sext-6", "sextante", "Sextante 6 · Inferior izquierdo", between(lower[1], post[1], post[0]), `${lower[1]}.${post[1]}–${lower[1]}.${post[0]}`),
  ];
  return [
    opt("boca", "general", "Boca completa", range([...upper, ...lower], last), "todas las piezas"),
    opt("arc-sup", "general", "Arcada superior", range(upper, last), `${upper[0]}.1–${upper[1]}.${last}`),
    opt("arc-inf", "general", "Arcada inferior", range(lower, last), `${lower[0]}.1–${lower[1]}.${last}`),
    ...quadrants,
    ...sextants,
  ];
}

export type ParsedZone = { dentition: Dentition; option: ZoneOption };

/** Lee «perm:cuad-1» / «temp:boca». Devuelve null si no es una zona válida. */
export function parseZone(value: unknown): ParsedZone | null {
  if (typeof value !== "string") return null;
  const [dentition, key] = value.split(":");
  if (dentition !== "perm" && dentition !== "temp") return null;
  const option = zoneOptions(dentition).find(item => item.key === key);
  return option ? { dentition, option } : null;
}

export const zoneValue = (dentition: Dentition, key: string) => `${dentition}:${key}`;

/** Piezas FDI que cubre la zona; vacío si la zona no es válida. */
export function zoneTeeth(value: unknown): number[] {
  return parseZone(value)?.option.teeth ?? [];
}

/** Texto corto para el plan: «Cuadrante 1 (temporal)». */
export function zoneLabel(value: unknown): string {
  const zone = parseZone(value);
  if (!zone) return "";
  return `${zone.option.label}${zone.dentition === "temp" ? " (temporal)" : ""}`;
}

export type PriceUnit = "pieza" | "cara" | "sextante" | "cuadrante" | "arcada" | "boca";
export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  pieza: "Por pieza", cara: "Por cara", sextante: "Por sextante", cuadrante: "Por cuadrante", arcada: "Por arcada", boca: "Boca completa",
};

/** Unidad en que se cobra una prestación, deducida del nombre del arancel; null si no lo dice. */
export function priceUnitFromName(name: string): PriceUnit | null {
  const text = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/boca completa|bucal completa|\btotal de la boca/.test(text)) return "boca";
  if (/sextante/.test(text)) return "sextante";
  if (/cuadrante/.test(text)) return "cuadrante";
  if (/arcada|maxilar completo|\bpor arco\b/.test(text)) return "arcada";
  if (/\bpor (cara|superficie)|\b(una|dos|tres|cuatro|cinco)\s+(cara|superficie)s?\b|\b[1-5]\s*(cara|superficie)s?\b/.test(text)) return "cara";
  return null;
}

/** Zona que se sugiere al elegir una prestación según su unidad de cobro. */
export function suggestedZoneKind(unit: PriceUnit | null): ZoneGroup | null {
  if (unit === "boca" || unit === "arcada") return "general";
  if (unit === "cuadrante") return "cuadrante";
  if (unit === "sextante") return "sextante";
  return null;
}
