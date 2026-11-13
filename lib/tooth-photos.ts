/**
 * Fotos realistas (referenciales) de cada tipo de pieza permanente para la vista ampliada.
 * Hay una imagen por tipo de diente (8 por arcada) y por situación; las piezas del lado opuesto usan la misma
 * imagen espejada. No son fotos del paciente: ilustran el tipo de pieza y lo que consta en la ficha.
 */
export type ToothPhotoKind = "lesion" | "sano" | "corona" | "endodoncia" | "restauracion" | "caries" | "implante" | "implante-sumergido" | "implante-pilar";
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
  "lower-canino-caries-lado",
  "lower-canino-caries-vestibular",
  "lower-canino-restauracion-lado",
  "lower-canino-restauracion-vestibular",
  "lower-incisivo-central-caries-lado",
  "lower-incisivo-central-caries-vestibular",
  "lower-incisivo-central-restauracion-lado",
  "lower-incisivo-central-restauracion-vestibular",
  "lower-incisivo-lateral-caries-lado",
  "lower-incisivo-lateral-caries-vestibular",
  "lower-incisivo-lateral-restauracion-lado",
  "lower-incisivo-lateral-restauracion-vestibular",
  "lower-molar-1-caries-lado",
  "lower-molar-1-caries-vestibular",
  "lower-molar-1-restauracion-lado",
  "lower-molar-1-restauracion-vestibular",
  "lower-molar-2-caries-lado",
  "lower-molar-2-caries-vestibular",
  "lower-molar-2-restauracion-lado",
  "lower-molar-2-restauracion-vestibular",
  "lower-molar-3-caries-lado",
  "lower-molar-3-caries-vestibular",
  "lower-molar-3-restauracion-lado",
  "lower-molar-3-restauracion-vestibular",
  "lower-premolar-1-caries-lado",
  "lower-premolar-1-caries-vestibular",
  "lower-premolar-1-restauracion-lado",
  "lower-premolar-1-restauracion-vestibular",
  "lower-premolar-2-caries-lado",
  "lower-premolar-2-caries-vestibular",
  "lower-premolar-2-restauracion-lado",
  "lower-premolar-2-restauracion-vestibular",
  "upper-canino-caries-lado",
  "upper-canino-caries-vestibular",
  "upper-canino-restauracion-lado",
  "upper-canino-restauracion-vestibular",
  "upper-incisivo-central-caries-lado",
  "upper-incisivo-central-caries-vestibular",
  "upper-incisivo-central-restauracion-lado",
  "upper-incisivo-central-restauracion-vestibular",
  "upper-incisivo-lateral-caries-lado",
  "upper-incisivo-lateral-caries-vestibular",
  "upper-incisivo-lateral-restauracion-lado",
  "upper-incisivo-lateral-restauracion-vestibular",
  "upper-molar-1-caries-lado",
  "upper-molar-1-caries-vestibular",
  "upper-molar-1-restauracion-lado",
  "upper-molar-1-restauracion-vestibular",
  "upper-molar-2-caries-lado",
  "upper-molar-2-caries-vestibular",
  "upper-molar-2-restauracion-lado",
  "upper-molar-2-restauracion-vestibular",
  "upper-molar-3-caries-lado",
  "upper-molar-3-caries-vestibular",
  "upper-molar-3-restauracion-lado",
  "upper-molar-3-restauracion-vestibular",
  "upper-premolar-1-caries-lado",
  "upper-premolar-1-caries-vestibular",
  "upper-premolar-1-restauracion-lado",
  "upper-premolar-1-restauracion-vestibular",
  "upper-premolar-2-caries-lado",
  "upper-premolar-2-caries-vestibular",
  "upper-premolar-2-restauracion-lado",
  "upper-premolar-2-restauracion-vestibular",
  // Estados generales de lesión apical y fractura: una imagen por familia de pieza (incisivo, canino, premolar, molar).
  "lower-canino-absceso-apical-agudo",
  "lower-canino-absceso-apical-cronico",
  "lower-canino-fisura-coronaria",
  "lower-canino-fractura-coronaria-dentina",
  "lower-canino-fractura-coronaria-esmalte",
  "lower-canino-fractura-coronaria-pulpa",
  "lower-canino-fractura-corono-radicular",
  "lower-canino-fractura-radicular-horizontal",
  "lower-canino-fractura-radicular-vertical",
  "lower-canino-granuloma-apical",
  "lower-canino-osteitis-condensante",
  "lower-canino-periodontitis-apical",
  "lower-canino-quiste-radicular",
  "lower-incisivo-absceso-apical-agudo",
  "lower-incisivo-absceso-apical-cronico",
  "lower-incisivo-fisura-coronaria",
  "lower-incisivo-fractura-coronaria-dentina",
  "lower-incisivo-fractura-coronaria-esmalte",
  "lower-incisivo-fractura-coronaria-pulpa",
  "lower-incisivo-fractura-corono-radicular",
  "lower-incisivo-fractura-radicular-horizontal",
  "lower-incisivo-fractura-radicular-vertical",
  "lower-incisivo-granuloma-apical",
  "lower-incisivo-osteitis-condensante",
  "lower-incisivo-periodontitis-apical",
  "lower-incisivo-quiste-radicular",
  "lower-molar-absceso-apical-agudo",
  "lower-molar-absceso-apical-cronico",
  "lower-molar-fisura-coronaria",
  "lower-molar-fractura-coronaria-dentina",
  "lower-molar-fractura-coronaria-esmalte",
  "lower-molar-fractura-coronaria-pulpa",
  "lower-molar-fractura-corono-radicular",
  "lower-molar-fractura-radicular-horizontal",
  "lower-molar-fractura-radicular-vertical",
  "lower-molar-granuloma-apical",
  "lower-molar-osteitis-condensante",
  "lower-molar-periodontitis-apical",
  "lower-molar-quiste-radicular",
  "lower-premolar-absceso-apical-agudo",
  "lower-premolar-absceso-apical-cronico",
  "lower-premolar-fisura-coronaria",
  "lower-premolar-fractura-coronaria-dentina",
  "lower-premolar-fractura-coronaria-esmalte",
  "lower-premolar-fractura-coronaria-pulpa",
  "lower-premolar-fractura-corono-radicular",
  "lower-premolar-fractura-radicular-horizontal",
  "lower-premolar-fractura-radicular-vertical",
  "lower-premolar-granuloma-apical",
  "lower-premolar-osteitis-condensante",
  "lower-premolar-periodontitis-apical",
  "lower-premolar-quiste-radicular",
  "upper-canino-absceso-apical-agudo",
  "upper-canino-absceso-apical-cronico",
  "upper-canino-fisura-coronaria",
  "upper-canino-fractura-coronaria-dentina",
  "upper-canino-fractura-coronaria-esmalte",
  "upper-canino-fractura-coronaria-pulpa",
  "upper-canino-fractura-corono-radicular",
  "upper-canino-fractura-radicular-horizontal",
  "upper-canino-fractura-radicular-vertical",
  "upper-canino-granuloma-apical",
  "upper-canino-osteitis-condensante",
  "upper-canino-periodontitis-apical",
  "upper-canino-quiste-radicular",
  "upper-incisivo-absceso-apical-agudo",
  "upper-incisivo-absceso-apical-cronico",
  "upper-incisivo-fisura-coronaria",
  "upper-incisivo-fractura-coronaria-dentina",
  "upper-incisivo-fractura-coronaria-esmalte",
  "upper-incisivo-fractura-coronaria-pulpa",
  "upper-incisivo-fractura-corono-radicular",
  "upper-incisivo-fractura-radicular-horizontal",
  "upper-incisivo-fractura-radicular-vertical",
  "upper-incisivo-granuloma-apical",
  "upper-incisivo-osteitis-condensante",
  "upper-incisivo-periodontitis-apical",
  "upper-incisivo-quiste-radicular",
  "upper-molar-absceso-apical-agudo",
  "upper-molar-absceso-apical-cronico",
  "upper-molar-fisura-coronaria",
  "upper-molar-fractura-coronaria-dentina",
  "upper-molar-fractura-coronaria-esmalte",
  "upper-molar-fractura-coronaria-pulpa",
  "upper-molar-fractura-corono-radicular",
  "upper-molar-fractura-radicular-horizontal",
  "upper-molar-fractura-radicular-vertical",
  "upper-molar-granuloma-apical",
  "upper-molar-osteitis-condensante",
  "upper-molar-periodontitis-apical",
  "upper-molar-quiste-radicular",
  "upper-premolar-absceso-apical-agudo",
  "upper-premolar-absceso-apical-cronico",
  "upper-premolar-fisura-coronaria",
  "upper-premolar-fractura-coronaria-dentina",
  "upper-premolar-fractura-coronaria-esmalte",
  "upper-premolar-fractura-coronaria-pulpa",
  "upper-premolar-fractura-corono-radicular",
  "upper-premolar-fractura-radicular-horizontal",
  "upper-premolar-fractura-radicular-vertical",
  "upper-premolar-granuloma-apical",
  "upper-premolar-osteitis-condensante",
  "upper-premolar-periodontitis-apical",
  "upper-premolar-quiste-radicular",
]);

/** Superficie FDI con caries y su profundidad (null = sin profundidad registrada). */
export type CariesSpotInput = { surface: "V" | "P" | "M" | "D" | "O"; depth: "esmalte" | "dentina_superficial" | "dentina_profunda" | "pulpar" | null };
export type ToothPhotoState = { fdi: number; status?: string; implant?: boolean; implantPhase?: ImplantPhase; crown?: boolean; endo?: boolean; caries?: boolean; restored?: boolean; cariesSurfaces?: CariesSpotInput[]; restoredSurfaces?: CariesSpotInput["surface"][] };
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

/** Estado general de la pieza (lesión apical o fractura) → sufijo de la imagen. */
const LESION_PHOTO: Record<string, string> = {
  "Periodontitis apical": "periodontitis-apical",
  "Absceso apical agudo": "absceso-apical-agudo",
  "Absceso apical crónico (fístula)": "absceso-apical-cronico",
  "Granuloma apical": "granuloma-apical",
  "Quiste radicular": "quiste-radicular",
  "Osteítis condensante": "osteitis-condensante",
  "Fisura coronaria": "fisura-coronaria",
  "Fractura coronaria de esmalte": "fractura-coronaria-esmalte",
  "Fractura coronaria con dentina": "fractura-coronaria-dentina",
  "Fractura coronaria con pulpa expuesta": "fractura-coronaria-pulpa",
  "Fractura corono-radicular": "fractura-corono-radicular",
  "Fractura radicular horizontal": "fractura-radicular-horizontal",
  "Fractura radicular vertical": "fractura-radicular-vertical",
};
const LESION_FAMILY = ["incisivo", "incisivo", "canino", "premolar", "premolar", "molar", "molar", "molar"] as const;

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
  const lesion = !state.implant && !state.crown && state.status ? LESION_PHOTO[state.status] : undefined;
  if (lesion) {
    const arch = quadrant <= 2 ? "upper" : "lower";
    const base = `${arch}-${LESION_FAMILY[index - 1]}-${lesion}`;
    if (!TOOTH_PHOTOS.has(base)) return null;
    const mirror = quadrant === 2 || quadrant === 3, upper = quadrant <= 2;
    const transform = mirror && upper ? "scale(-1,-1)" : mirror ? "scaleX(-1)" : upper ? "scaleY(-1)" : undefined;
    return { src: `/dientes/${base}.webp`, kind: "lesion", mirror, upper, transform, lesions: [] };
  }
  const kind = toothPhotoKind(state);
  // Sin corona el implante no depende de la anatomía de la pieza: una imagen por diámetro (anterior, premolar/canino, molar).
  const name = kind === "implante-sumergido" || kind === "implante-pilar"
    ? `${kind}-${index <= 2 ? "angosto" : index <= 5 ? "regular" : "ancho"}`
    : `${quadrant <= 2 ? "upper" : "lower"}-${TYPES[index - 1]}-${kind}`;
  // Hay fotos con la lesión (o la obturación) en la cara proximal o en la vestibular. La foto trae la lesión a la
  // derecha: en pantalla eso es mesial en todos los cuadrantes (mesial mira a la línea media y los cuadrantes 2 y 3
  // van espejados); para distal se invierte el espejo.
  const arch = quadrant <= 2 ? "upper" : "lower";
  const surfaces = state.cariesSurfaces ?? [];
  const pickSurface = (list: CariesSpotInput["surface"][]) => list.find(s => s === "M" || s === "D") ?? list.find(s => s === "V");
  const primary = kind === "caries" ? pickSurface(surfaces.map(s => s.surface)) : kind === "restauracion" ? pickSurface(state.restoredSurfaces ?? []) : undefined;
  const variant = primary ? `${arch}-${TYPES[index - 1]}-${kind}-${primary === "V" ? "vestibular" : "lado"}` : null;
  // Con caries y obturación a la vez se mantiene la pieza obturada y la lesión se dibuja encima.
  const usesVariant = variant !== null && TOOTH_PHOTOS.has(variant) && !(kind === "caries" && state.restored);
  // La foto «caries» trae la lesión en oclusal. Si la ficha registra caries en otra cara sin foto propia, se usa
  // la pieza (sana u obturada) y la lesión se dibuja donde corresponde.
  const drawnSurfaces = usesVariant ? surfaces.filter(s => s.surface !== primary) : surfaces;
  const drawn = kind === "caries" && (usesVariant ? drawnSurfaces.length > 0 : surfaces.some(s => s.surface !== "O"));
  const base = usesVariant ? variant : drawn ? `${arch}-${TYPES[index - 1]}-${state.restored ? "restauracion" : "sano"}` : name;
  if (!TOOTH_PHOTOS.has(base)) return null;
  const mirror = (quadrant === 2 || quadrant === 3) !== (usesVariant && primary === "D");
  const upper = quadrant === 1 || quadrant === 2;
  const transform = mirror && upper ? "scale(-1,-1)" : mirror ? "scaleX(-1)" : upper ? "scaleY(-1)" : undefined;
  return { src: `/dientes/${base}.webp`, kind, mirror, upper, transform, lesions: drawn ? cariesSpots(state.fdi, usesVariant ? drawnSurfaces : surfaces) : [] };
}

/**
 * Videos de giro de 360° de piezas sanas, ya en posición anatómica (la superior va con la raíz arriba, no se invierte).
 * Por ahora solo el incisivo central superior; el 2.1 usa el mismo video espejado. Si falta, la ventana usa la foto.
 */
export const TOOTH_VIDEOS: ReadonlySet<string> = new Set(["upper-incisivo-central-sano"]);
export type ToothVideo = { src: string; poster: string; transform: string | undefined };
export function toothVideoFor(fdi: number, status?: string): ToothVideo | null {
  const quadrant = Math.floor(fdi / 10), index = fdi % 10;
  if (status !== undefined && status !== "Sin hallazgos") return null;
  if (quadrant < 1 || quadrant > 4 || index < 1 || index > 8) return null;
  const name = `${quadrant <= 2 ? "upper" : "lower"}-${TYPES[index - 1]}-sano`;
  if (!TOOTH_VIDEOS.has(name)) return null;
  const mirror = quadrant === 2 || quadrant === 3;
  return { src: `/dientes/video/${name}.mp4`, poster: `/dientes/video/${name}.jpg`, transform: mirror ? "scaleX(-1)" : undefined };
}
