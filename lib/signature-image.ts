/**
 * Firma del profesional: recorte del espacio en blanco alrededor del trazo y medidas del recuadro de firma.
 * Puro (sin DOM) para poder probarlo; el componente le pasa los píxeles RGBA del canvas.
 */
/** Recuadro de firma impreso: ~6,5 × 2,7 cm, la imagen se escala para llenarlo sin deformarse. */
export const SIGNATURE_BOX_CM = { width: 6.5, height: 2.7 } as const;
/** Imagen guardada: hasta 900 px de ancho (nítida a 6,5 cm ≈ 350 ppp) y como data URL de hasta ~400 KB. */
export const SIGNATURE_MAX_WIDTH = 900;
export const SIGNATURE_MAX_HEIGHT = 400;
export const SIGNATURE_MAX_CHARS = 400_000;

export const validSignature = (value: string) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= SIGNATURE_MAX_CHARS;

export type Bounds = { x: number; y: number; width: number; height: number };

/** Píxel con tinta: no transparente y no (casi) blanco. */
const ink = (r: number, g: number, b: number, a: number) => a > 24 && r + g + b < 690;

/** Rectángulo mínimo que contiene el trazo (con margen), o null si la imagen está vacía. */
export function inkBounds(data: ArrayLike<number>, width: number, height: number, padding = 6): Bounds | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!ink(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - padding), y = Math.max(0, minY - padding);
  return { x, y, width: Math.min(width, maxX + padding + 1) - x, height: Math.min(height, maxY + padding + 1) - y };
}

/** Escala de salida para no superar el máximo guardado (nunca agranda). */
export function outputScale(bounds: Bounds): number {
  return Math.min(1, SIGNATURE_MAX_WIDTH / bounds.width, SIGNATURE_MAX_HEIGHT / bounds.height);
}

/** ¿Vale la pena recortar? (firma antigua: un trazo pequeño en un cuadro grande). */
export const worthTrimming = (bounds: Bounds, width: number, height: number) => bounds.width * bounds.height < width * height * 0.8;

/** Tamaño (en puntos PDF) de la firma dentro del recuadro, llenándolo sin deformar. */
export function fitInBox(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): { width: number; height: number } {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}
export const cmToPt = (cm: number) => cm / 2.54 * 72;
