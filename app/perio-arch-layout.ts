import type { PerioReading, PerioSiteKey, PerioTooth } from "./clinical-data";

/** Piezas de cada arcada en el orden en que se ven por vestibular (la derecha del paciente queda a la izquierda de la pantalla). */
export const UPPER_ORDER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_ORDER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export type Jaw = "upper" | "lower";
export type ArchFace = "vestibular" | "lingual";

/** Píxeles del lienzo por milímetro. */
export const PX_PER_MM = 9;
/** Ancho mesiodistal medio de la corona (mm), por posición 1–8, para repartir las piezas a lo largo de la arcada. */
export const CROWN_MD_MM: Record<Jaw, readonly number[]> = {
  upper: [8.5, 6.5, 7.5, 7, 6.5, 10, 9, 8.5],
  lower: [5, 5.5, 7, 7, 7, 11, 10.5, 10],
};
export const TOOTH_TYPES = ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"] as const;

/** Sitios de cada cara en el orden [distal, central, mesial]. */
export const FACE_SITES: Record<ArchFace, readonly [PerioSiteKey, PerioSiteKey, PerioSiteKey]> = {
  vestibular: ["DV", "V", "MV"],
  lingual: ["DL", "L", "ML"],
};

/** Sin medida: la encía y el hueso se dibujan en una posición neutra que no se confunde con una lectura. */
export const DEFAULT_DEPTH_MM = 2; // sulco sano mientras el clínico no mida
export const DEFAULT_GUM_MM = 0; // margen en la UAC
export const DEFAULT_BONE_MM = 2.5;
/** Cresta y encía de un reborde sin diente, en mm bajo la línea amelocementaria típica. */
export const RIDGE_GUM_MM = 1.5;
export const RIDGE_BONE_MM = 4.5;

export const toothType = (tooth: number) => TOOTH_TYPES[(tooth % 10) - 1];
export const jawOf = (tooth: number): Jaw => (Math.floor(tooth / 10) <= 2 ? "upper" : "lower");

export type Excluded = "absent" | "implant" | null;
/** Una pieza ausente o con implante no se sondea como diente: se muestra su reborde o su implante. */
export function excludedKind(status: string | undefined): Excluded {
  if (!status) return null;
  if (status === "Ausente") return "absent";
  if (status.startsWith("Implante")) return "implant";
  return null;
}

export type ToothSlot = { tooth: number; cx: number; width: number; mesialSign: 1 | -1 };

/** Reparte las 16 piezas de una arcada. La cara lingual es el espejo de la vestibular. */
export function archSlots(jaw: Jaw, face: ArchFace, pxPerMm = PX_PER_MM, pad = 36) {
  const order = jaw === "upper" ? UPPER_ORDER : LOWER_ORDER;
  const seq = face === "lingual" ? [...order].reverse() : order;
  const widths = seq.map(tooth => CROWN_MD_MM[jaw][(tooth % 10) - 1] * pxPerMm);
  const width = widths.reduce((sum, w) => sum + w, 0) + pad * 2;
  let x = pad;
  const slots: ToothSlot[] = seq.map((tooth, i) => {
    const cx = x + widths[i] / 2;
    x += widths[i];
    return { tooth, cx, width: widths[i], mesialSign: cx < width / 2 ? 1 : -1 };
  });
  return { slots, width };
}

export type SiteLevel = { measured: boolean; depth: number | null; gumMm: number; boneMm: number; bleeding: boolean; suppuration: boolean };

/**
 * Posición del margen gingival y de la cresta ósea (mm respecto a la UAC, positivo hacia el ápice) en un sitio.
 * Con sondaje y sin margen se supone el margen en la UAC (inserción = sondaje). La cresta es una estimación:
 * nivel de inserción + 2 mm, y nunca queda por encima del margen.
 */
export function siteLevel(reading: PerioReading | undefined): SiteLevel {
  const depth = reading?.depth ?? null;
  const margin = reading?.margin ?? null;
  const bleeding = Boolean(reading?.bleeding), suppuration = Boolean(reading?.suppuration);
  // Sin medición se muestra un sitio sano (sondaje 2 mm, margen 0) con la misma matemática; `measured` indica si es dato real.
  const shownDepth = depth ?? DEFAULT_DEPTH_MM;
  const gumMm = margin ?? DEFAULT_GUM_MM;
  const boneMm = Math.max(gumMm + 1.5, shownDepth + gumMm + 2);
  return { measured: depth !== null, depth: shownDepth, gumMm, boneMm, bleeding, suppuration };
}

export type ToothLevels = { tooth: number; excluded: Excluded; sites: [SiteLevel, SiteLevel, SiteLevel] };
export function toothLevels(tooth: number, data: PerioTooth | undefined, face: ArchFace, status?: string): ToothLevels {
  const keys = FACE_SITES[face];
  const sites = keys.map(key => siteLevel(data?.sites[key])) as [SiteLevel, SiteLevel, SiteLevel];
  return { tooth, excluded: excludedKind(status), sites };
}

/** Posición x de los tres sitios [distal, central, mesial] de una pieza. El lado mesial es el que mira a la línea media. */
export const siteXs = (slot: ToothSlot): [number, number, number] => {
  const off = slot.width * 0.3;
  return [slot.cx - slot.mesialSign * off, slot.cx, slot.cx + slot.mesialSign * off];
};

export type Pt = [number, number];
/** Puntos de las curvas de encía y hueso a lo largo de toda la arcada (y en px, hacia el ápice). */
export function archCurves(slots: ToothSlot[], levels: ToothLevels[], cejPx: number[], width: number, pxPerMm = PX_PER_MM) {
  const gum: Pt[] = [], bone: Pt[] = [];
  slots.forEach((slot, i) => {
    const lv = levels[i], cej = cejPx[i];
    const left = slot.cx - slot.width / 2;
    if (lv.excluded) {
      const g = cej + RIDGE_GUM_MM * pxPerMm, b = cej + RIDGE_BONE_MM * pxPerMm;
      [left + slot.width * 0.12, slot.cx, left + slot.width * 0.88].forEach(x => { gum.push([x, g]); bone.push([x, b]); });
    } else {
      const xs = siteXs(slot);
      const order = [0, 1, 2].sort((a, b) => xs[a] - xs[b]);
      order.forEach(k => { gum.push([xs[k], cej + lv.sites[k].gumMm * pxPerMm]); bone.push([xs[k], cej + lv.sites[k].boneMm * pxPerMm]); });
    }
    if (i < slots.length - 1) {
      const gl = gum[gum.length - 1], bl = bone[bone.length - 1];
      const next = levels[i + 1], nextCej = cejPx[i + 1], nextSlot = slots[i + 1];
      const nx = next.excluded ? nextSlot.cx - nextSlot.width / 2 + nextSlot.width * 0.12 : Math.min(...siteXs(nextSlot));
      const nextGum = next.excluded ? nextCej + RIDGE_GUM_MM * pxPerMm : nextCej + next.sites[siteXs(nextSlot).indexOf(nx)].gumMm * pxPerMm;
      const nextBone = next.excluded ? nextCej + RIDGE_BONE_MM * pxPerMm : nextCej + next.sites[siteXs(nextSlot).indexOf(nx)].boneMm * pxPerMm;
      const both = !lv.excluded && !next.excluded;
      const bx = slot.cx + slot.width / 2;
      gum.push([bx, (gl[1] + nextGum) / 2 - (both ? 1.7 : 0.4) * pxPerMm]);
      bone.push([bx, (bl[1] + nextBone) / 2 - (both ? 0.7 : 0) * pxPerMm]);
    }
  });
  const edge = (pts: Pt[], lift: number): Pt[] => [[0, pts[0][1] - lift * pxPerMm], [slots[0].cx - slots[0].width / 2, pts[0][1] - lift * 0.8 * pxPerMm], ...pts, [slots[slots.length - 1].cx + slots[slots.length - 1].width / 2, pts[pts.length - 1][1] - lift * 0.8 * pxPerMm], [width, pts[pts.length - 1][1] - lift * pxPerMm]];
  return { gum: edge(gum, 1.2), bone: edge(bone, 0.5) };
}

/** Altura de una curva suave (Catmull-Rom) en cada x entero entre x0 y x1. */
export function sampleCurve(pts: Pt[], x0: number, x1: number): Float32Array {
  const dense: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] ?? pts[i], b = pts[i], c = pts[i + 1], e = pts[i + 2] ?? c;
    const c1: Pt = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6], c2: Pt = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, u = 1 - t;
      const x = u * u * u * b[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * c[0];
      const y = u * u * u * b[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * c[1];
      dense.push([Math.max(dense[dense.length - 1][0], x), y]);
    }
  }
  const out = new Float32Array(Math.max(1, Math.ceil(x1 - x0) + 1));
  let j = 0;
  const last = dense[dense.length - 1];
  for (let k = 0; k < out.length; k++) {
    const x = x0 + k;
    if (x <= dense[0][0]) out[k] = dense[0][1];
    else if (x >= last[0]) out[k] = last[1];
    else {
      while (j < dense.length - 2 && dense[j + 1][0] < x) j++;
      const a = dense[j], b = dense[j + 1];
      out[k] = b[0] === a[0] ? b[1] : a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
    }
  }
  return out;
}

/** Color de la sonda según la profundidad: 0–3 verde, 4–5 ámbar, ≥6 rojo, sin medir gris. */
export const depthTone = (depth: number | null): "none" | "ok" | "warn" | "crit" => (depth === null ? "none" : depth >= 6 ? "crit" : depth >= 4 ? "warn" : "ok");
