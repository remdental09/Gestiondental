import { findViews, type DetectedView, type Rect } from "./capture-detect.ts";

export type Cut = { view: DetectedView; file: File };

/** Un corte que ocupa más que esto de la imagen ya venía recortado: no hay ventana que quitar. */
const WINDOW_SHARE = 0.85;
export const partOfWindow = (rect: Rect, width: number, height: number) => rect.width * rect.height <= width * height * WINDOW_SHARE;

/** Rótulo del corte: nombre que mostraba el visor (si se leyó), tipo y fecha en Chile (`date` null: no se sabe de cuándo es). */
export function cutLabel(patient: string | null, view: string, date: Date | null = new Date()): string {
  const day = date && new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return [patient, view, day].filter(Boolean).join(" · ");
}

async function draw(bitmap: ImageBitmap, rect: Rect, label: string): Promise<Blob> {
  const band = Math.max(28, Math.round(rect.width * 0.045));
  const canvas = document.createElement("canvas");
  canvas.width = rect.width; canvas.height = rect.height + band;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("sin lienzo");
  context.fillStyle = "#1f1b30"; context.fillRect(0, 0, canvas.width, band);
  context.fillStyle = "#ffffff"; context.textBaseline = "middle";
  const font = (size: number) => `600 ${size}px system-ui, sans-serif`;
  context.font = font(Math.round(band * 0.6));
  const room = canvas.width - 16, needed = context.measureText(label).width;
  if (needed > room) context.font = font(Math.max(10, Math.floor(band * 0.6 * room / needed)));
  context.fillText(label, 8, band / 2, room);
  context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, band, rect.width, rect.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("sin imagen")), "image/png"));
}

/**
 * Recorta en el navegador las vistas pedidas de una captura de la ventana de Blue Sky Plan.
 * Devuelve solo las que encontró; si no pudo leer la imagen, ninguna.
 */
export async function cutViews(file: File, wanted: readonly string[] | "all", patient: string | null,
  { date, partsOnly = false }: { date?: Date | null; partsOnly?: boolean } = {}): Promise<Cut[]> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(bitmap, 0, 0);
    const found = findViews(context.getImageData(0, 0, bitmap.width, bitmap.height));
    const order: DetectedView[] = ["Transversal", "Axial", "Panorámica", "Vista 3D"];
    const cuts: Cut[] = [];
    for (const view of order) {
      const rect = found[view];
      if (!rect || (wanted !== "all" && !wanted.includes(view))) continue;
      if (partsOnly && !partOfWindow(rect, bitmap.width, bitmap.height)) continue;
      cuts.push({ view, file: new File([await draw(bitmap, rect, cutLabel(patient, view, date))], "corte.png", { type: "image/png" }) });
    }
    return cuts;
  } catch { return []; }
  finally { bitmap?.close(); }
}
