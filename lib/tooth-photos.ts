/**
 * Fotos realistas (referenciales) de cada tipo de pieza permanente para la vista ampliada.
 * Hay una imagen por tipo de diente (8 por arcada) y por situación; las piezas del lado opuesto usan la misma
 * imagen espejada. No son fotos del paciente: ilustran el tipo de pieza y lo que consta en la ficha.
 */
export type ToothPhotoKind = "sano" | "corona" | "endodoncia" | "restauracion" | "caries" | "implante";

const TYPES = ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"] as const;

/** Imágenes disponibles en /public/dientes (arcada-tipo-situación). Si falta una, la vista cae al esquema dibujado. */
export const TOOTH_PHOTOS: ReadonlySet<string> = new Set([
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

export type ToothPhotoState = { fdi: number; implant?: boolean; crown?: boolean; endo?: boolean; caries?: boolean; restored?: boolean };
export type ToothPhoto = { src: string; kind: ToothPhotoKind; mirror: boolean };

/** Situación que manda la imagen: implante, corona, endodoncia, caries, obturación y, si no hay nada, pieza sana. */
export function toothPhotoKind(state: Omit<ToothPhotoState, "fdi">): ToothPhotoKind {
  if (state.implant) return "implante";
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
  const name = `${quadrant <= 2 ? "upper" : "lower"}-${TYPES[index - 1]}-${kind}`;
  if (!TOOTH_PHOTOS.has(name)) return null;
  return { src: `/dientes/${name}.webp`, kind, mirror: quadrant === 2 || quadrant === 3 };
}
