/**
 * Compresión de imágenes en el navegador antes de subirlas: lado mayor ≤ 1600 px (JPEG 0,88)
 * y una miniatura de 400 px para las grillas. Si algo falla, se sube el archivo original.
 * Los PDF no se tocan.
 */
export const MAX_EDGE = 1600;
export const THUMB_EDGE = 400;
/** Por debajo de este peso y tamaño, el archivo se sube tal cual. */
export const KEEP_BELOW_BYTES = 1_500_000;
export const MAX_THUMB_BYTES = 300_000;

/** Ancho y alto que caben en `max` px por lado, sin agrandar. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** ¿Hace falta recomprimir? Solo imágenes grandes (en px o en bytes). */
export function needsCompression(type: string, size: number, width: number, height: number, maxEdge = MAX_EDGE): boolean {
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return false;
  return Math.max(width, height) > maxEdge || size > KEEP_BELOW_BYTES;
}

/** Nombre con extensión .jpg (el archivo comprimido siempre es JPEG). */
export function jpegName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "") || "imagen";
  return base + ".jpg";
}

type Loaded = { image: HTMLImageElement; release: () => void };

/** Safari respeta la orientación EXIF al dibujar un <img>, así las fotos del iPhone no quedan giradas. */
function loadImage(file: Blob): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
    image.src = url;
  });
}

function draw(image: HTMLImageElement, max: number, quality: number): Promise<Blob | null> {
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, max);
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  // Fondo blanco: un PNG con transparencia no queda negro al pasar a JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/** Prepara la subida: imagen (posiblemente comprimida) + miniatura opcional. Nunca lanza. */
export async function prepareImageUpload(file: File, maxEdge = MAX_EDGE): Promise<{ file: File; thumb: Blob | null }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof document === "undefined") return { file, thumb: null };
  let loaded: Loaded | null = null;
  try {
    loaded = await loadImage(file);
    const { image } = loaded;
    let upload = file;
    if (needsCompression(file.type, file.size, image.naturalWidth, image.naturalHeight, maxEdge)) {
      const blob = await draw(image, maxEdge, 0.88);
      if (blob && blob.size > 0 && blob.size < file.size) upload = new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    }
    const thumb = await draw(image, THUMB_EDGE, 0.8);
    return { file: upload, thumb: thumb && thumb.size > 0 && thumb.size <= MAX_THUMB_BYTES ? thumb : null };
  } catch {
    return { file, thumb: null };
  } finally {
    loaded?.release();
  }
}

/** URL de la miniatura (el servidor entrega el original si la imagen es antigua y no la tiene). */
export function thumbUrl(url: string): string {
  return url.includes("?") ? url + "&thumb=1" : url + "?thumb=1";
}
