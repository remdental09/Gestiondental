/**
 * Implantología: una ficha por implante (pieza, fase, medidas, etiqueta e imágenes). Puro (sin DOM ni base de datos).
 * Principios: escribir lo mínimo, la app propone desde la etiqueta o el odontograma y el profesional confirma.
 * Un dato no informado queda vacío; no se deducen medidas, marcas ni estados clínicos.
 */
import { cleanTooth, isDay } from "./biomedical-products.ts";

export const IMPLANT_PHASES = [
  { id: "evaluacion", label: "Evaluación" },
  { id: "plan", label: "Plan" },
  { id: "cirugia", label: "Cirugía" },
  { id: "osteointegracion", label: "Osteointegración" },
  { id: "rehabilitacion", label: "Rehabilitación" },
  { id: "mantencion", label: "Mantención" },
] as const;
/** "" = sin registrar. */
export type ImplantPhase = typeof IMPLANT_PHASES[number]["id"] | "";
export const phaseLabel = (id: string) => IMPLANT_PHASES.find(item => item.id === id)?.label ?? "Sin fase registrada";

export const IMPLANT_VIEWS = ["Panorámica", "Transversal", "Axial", "Vista 3D", "Radiografía"] as const;
export type ImplantView = typeof IMPLANT_VIEWS[number];
export const imageKindForView = (view: ImplantView) => view === "Radiografía" ? "Radiografía" as const : "Captura CBCT" as const;
export const MAX_IMPLANT_IMAGES = 40;
export const MAX_IMPLANTS_PER_PATIENT = 80;

export const COMMON_DIAMETERS = [3, 3.3, 3.5, 3.75, 4, 4.1, 4.3, 4.5, 4.8, 5, 6];
export const COMMON_LENGTHS = [6, 8, 8.5, 10, 11.5, 12, 13, 14, 16];

/** Arcadas como se ven en pantalla (FDI compacto). */
export const UPPER_ARCH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_ARCH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export type ImplantFields = {
  tooth: string; phase: ImplantPhase; brand: string; system: string;
  diameter: number | null; length: number | null; placedOn: string; torque: number | null; isq: number | null;
  productId: number | null; note: string;
};
export type ImplantImage = { imageId: number; view: ImplantView };
export type Implant = ImplantFields & { id: number; images: ImplantImage[] };

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Pieza permanente FDI con punto («3.6»); los implantes no se registran en piezas temporales. */
export function implantTooth(value: unknown): string {
  const tooth = cleanTooth(value);
  return /^[1-4]\./.test(tooth) ? tooth : "";
}

/** Acepta coma decimal. null = no informado; undefined = fuera de rango o ilegible (se avisa, no se descarta en silencio). */
function measure(value: unknown, min: number, max: number, decimals: number): number | null | undefined {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value) ? Number(value.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(raw) || raw < min || raw > max) return undefined;
  const factor = 10 ** decimals;
  return Math.round(raw * factor) / factor;
}

export function cleanImplantFields(input: Record<string, unknown>, today: string): { fields: ImplantFields } | { error: string } {
  const tooth = implantTooth(input.tooth);
  if (!tooth) return { error: "Elige la pieza del implante." };
  const diameter = measure(input.diameter, 1.5, 8, 2);
  if (diameter === undefined) return { error: "Revisa el diámetro (1,5 a 8 mm)." };
  const length = measure(input.length, 3, 60, 1);
  if (length === undefined) return { error: "Revisa el largo (3 a 60 mm)." };
  const torque = measure(input.torque, 0, 150, 0);
  if (torque === undefined) return { error: "Revisa el torque (0 a 150 Ncm)." };
  const isq = measure(input.isq, 1, 100, 0);
  if (isq === undefined) return { error: "Revisa el ISQ (1 a 100)." };
  const placed = typeof input.placedOn === "string" ? input.placedOn.trim() : "";
  if (placed && (!isDay(placed) || placed > today)) return { error: "La fecha de instalación no puede ser futura." };
  const productId = Number(input.productId);
  return {
    fields: {
      tooth, phase: IMPLANT_PHASES.some(item => item.id === input.phase) ? input.phase as ImplantPhase : "",
      brand: text(input.brand, 80), system: text(input.system, 80), diameter, length, placedOn: placed, torque, isq,
      productId: Number.isSafeInteger(productId) && productId > 0 ? productId : null, note: text(input.note, 600),
    },
  };
}

export function cleanImplantImage(input: unknown): ImplantImage | null {
  if (!input || typeof input !== "object") return null;
  const { imageId, view } = input as { imageId?: unknown; view?: unknown };
  const id = Number(imageId);
  if (!Number.isSafeInteger(id) || id < 1 || !IMPLANT_VIEWS.includes(view as ImplantView)) return null;
  return { imageId: id, view: view as ImplantView };
}

/** Lee la lista guardada; lo dañado o repetido se omite. */
export function parseImplantImages(raw: string): ImplantImage[] {
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const seen = new Set<number>();
    return list.flatMap(item => { const image = cleanImplantImage(item); if (!image || seen.has(image.imageId)) return []; seen.add(image.imageId); return [image]; }).slice(0, MAX_IMPLANT_IMAGES);
  } catch { return []; }
}

export const mm = (value: number | null) => value === null ? "" : String(value).replace(".", ",");

/** «Straumann BLT · 4,1 × 10 mm»: solo lo registrado. */
export function implantSummary(item: Pick<ImplantFields, "brand" | "system" | "diameter" | "length">): string {
  const name = [item.brand, item.system].filter(Boolean).join(" ");
  const size = item.diameter !== null && item.length !== null ? `${mm(item.diameter)} × ${mm(item.length)} mm`
    : item.diameter !== null ? `Ø ${mm(item.diameter)} mm` : item.length !== null ? `largo ${mm(item.length)} mm` : "";
  return [name, size].filter(Boolean).join(" · ");
}

/** Datos de un implante tal como salen en el respaldo y las descargas (sin las imágenes que ya se borraron). */
export type StoredImplant = Omit<ImplantFields, "phase"> & { phase: string; id: number; images: string; createdByName: string; createdAt: string; updatedAt: string };
export function backupImplant(r: StoredImplant, available?: Set<number>) {
  return {
    id: r.id, tooth: r.tooth, phase: r.phase, brand: r.brand, system: r.system, diameter: r.diameter, length: r.length, placedOn: r.placedOn,
    torque: r.torque, isq: r.isq, productId: r.productId, note: r.note,
    images: parseImplantImages(r.images).filter(image => !available || available.has(image.imageId)),
    createdByName: r.createdByName, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export type ImplantLabel = { id: number; tooth: string; brand: string; reference: string; lot: string; serial: string; placedOn: string; model?: string; diameter?: string; length?: string };

/** Medidas de la etiqueta que sirven para la ficha del implante: solo un número simple dentro de rango. */
export function labelMeasures(label: Pick<ImplantLabel, "diameter" | "length"> | undefined): { diameter: number | null; length: number | null } {
  return { diameter: measure(label?.diameter, 1.5, 8, 2) ?? null, length: measure(label?.length, 3, 60, 1) ?? null };
}
export type ImplantSuggestion = { tooth: string; source: "etiqueta" | "odontograma"; draft: Partial<ImplantFields> };

/**
 * Fichas que se pueden crear con un toque: etiquetas de implante aún sin ficha y piezas marcadas como implante en el odontograma.
 * Son propuestas: nada se guarda hasta que el profesional confirma.
 */
export function implantSuggestions(input: {
  implants: Pick<Implant, "tooth" | "productId">[];
  labels: ImplantLabel[];
  teeth: Record<number, string>;
  crowns?: Record<number, { foundation?: string }>;
}): ImplantSuggestion[] {
  const covered = new Set(input.implants.map(item => item.tooth));
  const used = new Set(input.implants.map(item => item.productId).filter(Boolean));
  const out: ImplantSuggestion[] = [];
  for (const label of input.labels) {
    const tooth = implantTooth(label.tooth);
    if (!tooth || covered.has(tooth) || used.has(label.id)) continue;
    covered.add(tooth);
    const { diameter, length } = labelMeasures(label);
    out.push({ tooth, source: "etiqueta", draft: { tooth, brand: label.brand, placedOn: label.placedOn, productId: label.id, phase: "cirugia", ...(diameter !== null ? { diameter } : {}), ...(length !== null ? { length } : {}) } });
  }
  const chart = new Set<number>();
  for (const [key, status] of Object.entries(input.teeth)) if (/^Implante/.test(status)) chart.add(Number(key));
  for (const [key, crown] of Object.entries(input.crowns ?? {})) if (crown?.foundation === "implant") chart.add(Number(key));
  for (const code of [...chart].sort((a, b) => a - b)) {
    const tooth = implantTooth(String(code));
    if (!tooth || covered.has(tooth)) continue;
    covered.add(tooth);
    out.push({ tooth, source: "odontograma", draft: { tooth } });
  }
  return out;
}
