/**
 * Formato del PDF del presupuesto, propio de cada profesional (en una clínica, cada colega usa el suyo, porque el
 * presupuesto sale con el nombre de quien lo armó). Colores, dónde va el nombre, qué datos mostrar y una nota al pie.
 */
export type PaletteKey = "lila" | "azul" | "verde" | "grafito" | "burdeo" | "propio";
export type NamePosition = "cabecera" | "firma" | "ambos";
export type BudgetFormat = {
  palette: PaletteKey;
  /** Colores en hex (#rrggbb). Con una paleta lista, son los de la paleta. */
  primary: string;
  accent: string;
  namePosition: NamePosition;
  showRut: boolean;
  showSpecialty: boolean;
  showTitles: boolean;
  /** N° de registro de prestador (Superintendencia de Salud) u otro, si se quiere mostrar. */
  registry: string;
  showLogo: boolean;
  /** Mostrar la numeración chilena junto a la FDI en «Dónde se trabaja». */
  showChile: boolean;
  /** Condiciones propias al pie (validez, formas de pago, garantías…), una por línea. */
  note: string;
  /** Mantener las condiciones generales de la app además de la nota propia. */
  keepDefaultNotes: boolean;
};

export const PALETTES: Record<Exclude<PaletteKey, "propio">, { label: string; primary: string; accent: string }> = {
  lila: { label: "Lila SpeakDent", primary: "#473a6d", accent: "#ef895f" },
  azul: { label: "Azul clínico", primary: "#1e3a8a", accent: "#38bdf8" },
  verde: { label: "Verde menta", primary: "#0f5f5a", accent: "#34d399" },
  grafito: { label: "Grafito", primary: "#2f3640", accent: "#f59e0b" },
  burdeo: { label: "Burdeo", primary: "#6b1d3a", accent: "#e9a96b" },
};

export const DEFAULT_FORMAT: BudgetFormat = {
  palette: "lila", primary: PALETTES.lila.primary, accent: PALETTES.lila.accent, namePosition: "ambos",
  showRut: true, showSpecialty: true, showTitles: false, registry: "", showLogo: true, showChile: true, note: "", keepDefaultNotes: true,
};

const HEX = /^#[0-9a-f]{6}$/i;
export function hexToRgb01(hex: string): [number, number, number] {
  const value = HEX.test(hex) ? hex : PALETTES.lila.primary;
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number];
}
/** Luminancia relativa (WCAG) de 0 a 1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb01(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Mezcla un color con blanco (t = 0 → color, t = 1 → blanco). */
export function tint(hex: string, t: number): [number, number, number] {
  return hexToRgb01(hex).map(c => c + (1 - c) * t) as [number, number, number];
}
export function shade(hex: string, t: number): [number, number, number] {
  return hexToRgb01(hex).map(c => c * (1 - t)) as [number, number, number];
}

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r/g, "").trim().slice(0, max) : "");

export type FormatCheck = { ok: true; format: BudgetFormat } | { ok: false; error: string };

/** Valida y completa un formato. El color principal lleva texto blanco encima: debe ser oscuro para que se lea. */
export function checkBudgetFormat(input: unknown): FormatCheck {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const palette: PaletteKey = typeof b.palette === "string" && (b.palette === "propio" || Object.hasOwn(PALETTES, b.palette)) ? b.palette as PaletteKey : DEFAULT_FORMAT.palette;
  let primary = palette === "propio" ? text(b.primary, 7).toLowerCase() : PALETTES[palette].primary;
  let accent = palette === "propio" ? text(b.accent, 7).toLowerCase() : PALETTES[palette].accent;
  if (palette === "propio") {
    if (!HEX.test(primary) || !HEX.test(accent)) return { ok: false, error: "Elige los dos colores." };
    if (luminance(primary) > 0.12) return { ok: false, error: "El color principal es muy claro: el texto blanco de la cabecera no se leería. Elige uno más oscuro." };
    if (luminance(accent) > 0.6) return { ok: false, error: "El color de acento es muy claro: se perdería sobre el papel blanco. Elige uno más intenso." };
  }
  primary ||= DEFAULT_FORMAT.primary; accent ||= DEFAULT_FORMAT.accent;
  const namePosition: NamePosition = b.namePosition === "cabecera" || b.namePosition === "firma" ? b.namePosition : "ambos";
  const noteLines = text(b.note, 600).split("\n").map(line => line.trim()).filter(Boolean);
  if (noteLines.length > 8) return { ok: false, error: "Las notas admiten hasta 8 líneas." };
  const note = noteLines.join("\n");
  return {
    ok: true,
    format: {
      palette, primary, accent, namePosition,
      showRut: bool(b.showRut, true), showSpecialty: bool(b.showSpecialty, true), showTitles: bool(b.showTitles, false),
      registry: text(b.registry, 60), showLogo: bool(b.showLogo, true), showChile: bool(b.showChile, true),
      note, keepDefaultNotes: bool(b.keepDefaultNotes, true),
    },
  };
}

/** Lee el formato guardado (JSON); si falta o está dañado, el formato por defecto. */
export function decodeBudgetFormat(value: string | null | undefined): BudgetFormat {
  if (!value) return { ...DEFAULT_FORMAT };
  try { const checked = checkBudgetFormat(JSON.parse(value)); return checked.ok ? checked.format : { ...DEFAULT_FORMAT }; }
  catch { return { ...DEFAULT_FORMAT }; }
}
