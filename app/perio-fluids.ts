import type { ArchFace, SiteLevel } from "./perio-arch-layout";

/**
 * Capas fotográficas de sangrado y supuración del periodontograma (public/perio/fluidos/*.webp, fondo transparente).
 * Todas nacen con el fluido corriendo hacia abajo desde un punto superior; en pantalla se orientan hacia la corona.
 * `ratio` es alto/ancho de la imagen y `widthMm` su ancho clínico sobre la escala de la arcada (PX_PER_MM).
 */
export type FluidKind = "blood" | "pus";
export type FluidSpec = { kind: FluidKind; widthMm: number; ratio: number; label: string };

export const FLUIDS: Record<string, FluidSpec> = {
  b1: { kind: "blood", widthMm: 1.5, ratio: 2.683, label: "gota de sangre que escurre" },
  b2: { kind: "blood", widthMm: 4.2, ratio: 0.296, label: "hilo fino de sangre" },
  b3: { kind: "blood", widthMm: 3.4, ratio: 1.775, label: "sangrado abundante" },
  b4: { kind: "blood", widthMm: 2.8, ratio: 1.0, label: "microgotas de sangre" },
  p1: { kind: "pus", widthMm: 3.0, ratio: 0.838, label: "perla de pus" },
  p2: { kind: "pus", widthMm: 2.8, ratio: 1.567, label: "hilo espeso de pus" },
  p3: { kind: "pus", widthMm: 3.4, ratio: 1.363, label: "acúmulo de pus" },
  p4: { kind: "pus", widthMm: 2.8, ratio: 0.942, label: "pus con tinte de sangre" },
};

/** Variantes por intensidad: leve (sondaje <4 mm), moderada (4–5 mm) y marcada (≥6 mm). */
export const FLUID_TIERS: Record<FluidKind, readonly (readonly string[])[]> = {
  blood: [["b1", "b4"], ["b2", "b1"], ["b3", "b2"]],
  pus: [["p1", "p4"], ["p4", "p2"], ["p3", "p2"]],
};

export const fluidTier = (depth: number | null): 0 | 1 | 2 => (depth === null || depth < 4 ? 0 : depth >= 6 ? 2 : 1);

/** Número estable por pieza, sitio y cara: la misma lectura siempre se dibuja igual, y sitios vecinos no se ven copiados. */
export const siteHash = (tooth: number, siteIndex: number, face: ArchFace) => (tooth * 31 + siteIndex * 17 + (face === "lingual" ? 7 : 0)) % 997;

export function pickFluid(kind: FluidKind, tooth: number, siteIndex: number, face: ArchFace, depth: number | null): string {
  const options = FLUID_TIERS[kind][fluidTier(depth)];
  return options[siteHash(tooth, siteIndex, face) % options.length];
}

export type SiteFluid = { id: string; kind: FluidKind; mirror: boolean; dxMm: number; delayMs: number };

/** Capas de un sitio [0 distal, 1 central, 2 mesial]. Si sangra y supura a la vez, el pus se desplaza para que ambas se vean. */
export function siteFluids(tooth: number, siteIndex: number, face: ArchFace, site: Pick<SiteLevel, "bleeding" | "suppuration" | "depth">): SiteFluid[] {
  const both = site.bleeding && site.suppuration, hash = siteHash(tooth, siteIndex, face);
  const make = (kind: FluidKind, dxMm: number): SiteFluid => ({ id: pickFluid(kind, tooth, siteIndex, face, site.depth), kind, mirror: siteIndex === 0 ? hash % 2 === 0 : hash % 2 === 1, dxMm, delayMs: (hash % 5) * 110 + (kind === "pus" ? 260 : 0) });
  const out: SiteFluid[] = [];
  if (site.bleeding) out.push(make("blood", both ? -1.7 : 0));
  if (site.suppuration) out.push(make("pus", both ? 1.7 : 0));
  return out;
}

export const fluidFile = (id: string) => `/perio/fluidos/${id}.webp`;
