/**
 * Fotos realistas (referenciales) de cada tipo de pieza permanente para la vista ampliada.
 * Hay una imagen por tipo de diente (8 por arcada) y por situación; las piezas del lado opuesto usan la misma
 * imagen espejada. No son fotos del paciente: ilustran el tipo de pieza y lo que consta en la ficha.
 */
export type ToothPhotoKind = "sano" | "corona" | "endodoncia" | "restauracion" | "caries" | "implante" | "implante-sumergido" | "implante-pilar";
/** Fase del implante: sumergido (solo el cuerpo), con pilar (sin corona) o rehabilitado con corona. */
export type ImplantPhase = "sumergido" | "pilar" | "corona";

const TYPES = ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"] as const;

/** Imágenes disponibles en /public/dientes (arcada-tipo-situación). Si falta una, la vista cae al esquema dibujado. */
export const TOOTH_PHOTOS: ReadonlySet<string> = new Set([
  "implante-pilar-ancho",
  "implante-pilar-angosto",
  "implante-pilar-regular",
  "implante-sumergido-ancho",
  "implante-sumergido-angosto",
  "implante-sumergido-regular",
  "lower-canino-caries",
  "lower-canino-corona",
  "lower-canino-endodoncia",
  "lower-canino-implante",
  "lower-canino-restauracion",
  "lower-canino-sano",
  "lower-incisivo-central-caries",
  "lower-incisivo-central-corona",
  "lower-incisivo-central-endodoncia",
  "lower-incisivo-central-restauracion",
  "lower-incisivo-central-sano",
  "lower-incisivo-lateral-caries",
  "lower-incisivo-lateral-corona",
  "lower-incisivo-lateral-endodoncia",
  "lower-incisivo-lateral-implante",
  "lower-incisivo-lateral-restauracion",
  "lower-incisivo-lateral-sano",
  "lower-molar-1-caries",
  "lower-molar-1-corona",
  "lower-molar-1-endodoncia",
  "lower-molar-1-implante",
  "lower-molar-1-restauracion",
  "lower-molar-1-sano",
  "lower-molar-2-caries",
  "lower-molar-2-corona",
  "lower-molar-2-endodoncia",
  "lower-molar-2-implante",
  "lower-molar-2-restauracion",
  "lower-molar-2-sano",
  "lower-molar-3-caries",
  "lower-molar-3-corona",
  "lower-molar-3-endodoncia",
  "lower-molar-3-implante",
  "lower-molar-3-restauracion",
  "lower-molar-3-sano",
  "lower-premolar-1-caries",
  "lower-premolar-1-corona",
  "lower-premolar-1-endodoncia",
  "lower-premolar-1-implante",
  "lower-premolar-1-restauracion",
  "lower-premolar-1-sano",
  "lower-premolar-2-caries",
  "lower-premolar-2-corona",
  "lower-premolar-2-endodoncia",
  "lower-premolar-2-implante",
  "lower-premolar-2-restauracion",
  "lower-premolar-2-sano",
  "upper-canino-caries",
  "upper-canino-corona",
  "upper-canino-endodoncia",
  "upper-canino-implante",
  "upper-canino-restauracion",
  "upper-canino-sano",
  "upper-incisivo-central-caries",
  "upper-incisivo-central-corona",
  "upper-incisivo-central-endodoncia",
  "upper-incisivo-central-implante",
  "upper-incisivo-central-restauracion",
  "upper-incisivo-central-sano",
  "upper-incisivo-lateral-caries",
  "upper-incisivo-lateral-corona",
  "upper-incisivo-lateral-endodoncia",
  "upper-incisivo-lateral-implante",
  "upper-incisivo-lateral-restauracion",
  "upper-incisivo-lateral-sano",
  "upper-molar-1-caries",
  "upper-molar-1-corona",
  "upper-molar-1-endodoncia",
  "upper-molar-1-implante",
  "upper-molar-1-restauracion",
  "upper-molar-1-sano",
  "upper-molar-2-caries",
  "upper-molar-2-corona",
  "upper-molar-2-endodoncia",
  "upper-molar-2-implante",
  "upper-molar-2-restauracion",
  "upper-molar-2-sano",
  "upper-molar-3-caries",
  "upper-molar-3-corona",
  "upper-molar-3-endodoncia",
  "upper-molar-3-implante",
  "upper-molar-3-restauracion",
  "upper-molar-3-sano",
  "upper-premolar-1-caries",
  "upper-premolar-1-corona",
  "upper-premolar-1-endodoncia",
  "upper-premolar-1-implante",
  "upper-premolar-1-restauracion",
  "upper-premolar-1-sano",
  "upper-premolar-2-caries",
  "upper-premolar-2-corona",
  "upper-premolar-2-endodoncia",
  "upper-premolar-2-implante",
  "upper-premolar-2-restauracion",
  "upper-premolar-2-sano",
]);

/** Superficie FDI con caries y su profundidad (null = sin profundidad registrada). */
export type CariesSpotInput = { surface: "V" | "P" | "M" | "D" | "O"; depth: "esmalte" | "dentina_superficial" | "dentina_profunda" | "pulpar" | null };
export type ToothPhotoState = { fdi: number; implant?: boolean; implantPhase?: ImplantPhase; crown?: boolean; endo?: boolean; caries?: boolean; restored?: boolean; cariesSurfaces?: CariesSpotInput[] };
/** upper: pieza superior, se muestra invertida (raíces arriba, corona hacia el plano oclusal). transform: CSS listo para la imagen. */
export type ToothPhoto = { src: string; kind: ToothPhotoKind; mirror: boolean; upper: boolean; transform: string | undefined; lesions: CariesSpot[] };

/** Lesión dibujada sobre la foto, en píxeles de la imagen tal como se ve (420×576, ya invertida/espejada). */
export type CariesSpot = { surface: CariesSpotInput["surface"]; depth: CariesSpotInput["depth"]; x: number; y: number; rx: number; ry: number; back: boolean; labelX: number; labelY: number };

const PHOTO_W = 420, PHOTO_H = 576;
// Ancho de la corona en la foto (fracción del ancho) según el tipo de pieza: incisivos angostos, molares anchos.
const CROWN_EDGE = [0.31, 0.32, 0.29, 0.25, 0.25, 0.17, 0.18, 0.2];
const SIZE: Record<string, number> = { esmalte: 0.07, dentina_superficial: 0.09, dentina_profunda: 0.115, pulpar: 0.14 };

/**
 * Dónde va cada caries sobre la foto. La foto es genérica: la lesión se dibuja en la superficie registrada.
 * En pantalla, mesial mira a la línea media (derecha en cuadrantes 1 y 4, izquierda en 2 y 3); la corona va
 * abajo en superiores y arriba en inferiores. Vestibular es la cara que mira al observador; palatina/lingual,
 * la de atrás (se marca con línea punteada).
 */
export function cariesSpots(fdi: number, findings: CariesSpotInput[]): CariesSpot[] {
  const quadrant = Math.floor(fdi / 10), index = fdi % 10;
  if (quadrant < 1 || quadrant > 4 || index < 1 || index > 8) return [];
  const upper = quadrant <= 2, mesialRight = quadrant === 1 || quadrant === 4;
  const edge = CROWN_EDGE[index - 1]!;
  const seen = new Set<string>();
  const spots: CariesSpot[] = [];
  for (const finding of findings) {
    if (seen.has(finding.surface)) continue;
    seen.add(finding.surface);
    const size = SIZE[finding.depth ?? ""] ?? 0.09;
    // Coordenadas con la corona arriba (y desde el borde oclusal hacia la raíz).
    let fx = 0.5, fy = 0.25;
    if (finding.surface === "O") { fx = 0.5; fy = 0.11 + size * 0.35; }
    else if (finding.surface === "M" || finding.surface === "D") {
      const towardRight = (finding.surface === "M") === mesialRight;
      fx = towardRight ? 1 - edge - size * 0.55 : edge + size * 0.55; fy = 0.24;
    } else if (finding.surface === "V") { fx = 0.5; fy = 0.31; }
    else { fx = 0.5; fy = 0.2; }
    const y = upper ? 1 - fy : fy;
    const rx = size * PHOTO_W, ry = size * PHOTO_W * 0.8;
    // La etiqueta va hacia la raíz, sobre la misma vertical, para no salirse de la foto.
    const labelX = fx * PHOTO_W;
    const labelY = y * PHOTO_H + (upper ? -1 : 1) * (ry + 26);
    spots.push({ surface: finding.surface, depth: finding.depth, x: fx * PHOTO_W, y: y * PHOTO_H, rx, ry, back: finding.surface === "P", labelX: Math.min(PHOTO_W - 18, Math.max(18, labelX)), labelY });
  }
  return spots;
}

/** Situación que manda la imagen: implante, corona, endodoncia, caries, obturación y, si no hay nada, pieza sana. */
export function toothPhotoKind(state: Omit<ToothPhotoState, "fdi">): ToothPhotoKind {
  if (state.implant) {
    const phase = state.implantPhase ?? (state.crown ? "corona" : "sumergido");
    return phase === "corona" ? "implante" : phase === "pilar" ? "implante-pilar" : "implante-sumergido";
  }
  if (state.crown) return "corona";
  if (state.endo) return "endodoncia";
  if (state.caries) return "caries";
  if (state.restored) return "restauracion";
  return "sano";
}

export function toothPhotoFor(state: ToothPhotoState): ToothPhoto | null {
  const quadrant = Math.floor(state.fdi / 10);
  const index = state.fdi % 10;
  if (quadrant < 1 || quadrant > 4 || index < 1 || index > 8) return null;
  const kind = toothPhotoKind(state);
  // Sin corona el implante no depende de la anatomía de la pieza: una imagen por diámetro (anterior, premolar/canino, molar).
  const name = kind === "implante-sumergido" || kind === "implante-pilar"
    ? `${kind}-${index <= 2 ? "angosto" : index <= 5 ? "regular" : "ancho"}`
    : `${quadrant <= 2 ? "upper" : "lower"}-${TYPES[index - 1]}-${kind}`;
  // La foto «caries» trae la lesión en oclusal. Si la ficha registra caries en otra cara, se usa la pieza
  // (sana u obturada) y la lesión se dibuja donde corresponde.
  const surfaces = state.cariesSurfaces ?? [];
  const drawn = kind === "caries" && surfaces.some(s => s.surface !== "O");
  const base = drawn ? `${quadrant <= 2 ? "upper" : "lower"}-${TYPES[index - 1]}-${state.restored ? "restauracion" : "sano"}` : name;
  if (!TOOTH_PHOTOS.has(base)) return null;
  const mirror = quadrant === 2 || quadrant === 3;
  const upper = quadrant === 1 || quadrant === 2;
  const transform = mirror && upper ? "scale(-1,-1)" : mirror ? "scaleX(-1)" : upper ? "scaleY(-1)" : undefined;
  return { src: `/dientes/${base}.webp`, kind, mirror, upper, transform, lesions: drawn ? cariesSpots(state.fdi, surfaces) : [] };
}
