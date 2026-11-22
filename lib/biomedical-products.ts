/**
 * Trazabilidad de productos biomédicos (implantes, injertos, membranas, pilares…).
 * Puro (sin DOM ni base de datos) para poder probarlo. Principio: la IA solo PROPONE lo que se lee en la etiqueta;
 * lo que se guarda es lo que el profesional confirma. Un dato ilegible queda vacío, nunca se completa a ojo.
 */
export const PRODUCT_IMAGE_KIND = "Producto biomédico";

export const PRODUCT_CATEGORIES = [
  { id: "implante", label: "Implante" },
  { id: "injerto", label: "Injerto / biomaterial" },
  { id: "membrana", label: "Membrana" },
  { id: "pilar", label: "Pilar, tornillo o aditamento" },
  { id: "sutura", label: "Sutura o hemostático" },
  { id: "otro", label: "Otro producto" },
] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number]["id"];
export const isProductCategory = (value: unknown): value is ProductCategory => PRODUCT_CATEGORIES.some(item => item.id === value);
export const categoryLabel = (id: string) => PRODUCT_CATEGORIES.find(item => item.id === id)?.label ?? "Producto";

export type ProductFields = {
  category: ProductCategory;
  brand: string; reference: string; lot: string; serial: string; expiry: string; manufacturer: string;
  tooth: string; note: string; placedOn: string;
};

const LIMITS = { brand: 80, reference: 60, lot: 60, serial: 60, manufacturer: 80, note: 600 } as const;
const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Lote o serie: tal como está impreso (sin cambiar mayúsculas ni formato), solo sin espacios sobrantes. */
export const cleanCode = (value: unknown, max = 60): string => text(value, max);

/** Vencimiento como AAAA-MM o AAAA-MM-DD (también acepta MM/AAAA, como lo traen muchas etiquetas). "" si no se entiende. */
export function cleanExpiry(value: unknown): string {
  const raw = text(value, 20);
  let year: number, month: number, day = 0;
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = iso[3] ? Number(iso[3]) : 0; }
  else {
    const latin = /^(\d{2})[\/.](\d{4})$/.exec(raw);
    if (!latin) return "";
    month = Number(latin[1]); year = Number(latin[2]);
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || (day && (day < 1 || day > 31))) return "";
  const mm = String(month).padStart(2, "0");
  return day ? `${year}-${mm}-${String(day).padStart(2, "0")}` : `${year}-${mm}`;
}

/** Pieza FDI («1.6», «16») → «1.6». Permanentes 11–48 y temporales 51–85. "" si no es una pieza válida. */
export function cleanTooth(value: unknown): string {
  const digits = text(value, 6).replace(/\D/g, "");
  if (digits.length !== 2) return "";
  const quadrant = Number(digits[0]), position = Number(digits[1]);
  const permanent = quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8;
  const primary = quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5;
  return permanent || primary ? `${digits[0]}.${digits[1]}` : "";
}

export const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Normaliza lo que llega del formulario: nunca confía en el navegador. null si falta lo mínimo (categoría y fecha). */
export function cleanProductFields(input: Record<string, unknown>, today: string): ProductFields | null {
  if (!isProductCategory(input.category)) return null;
  const placedOn = isDay(input.placedOn) ? input.placedOn : today;
  if (placedOn > today) return null; // no se registra un producto «colocado» en el futuro
  return {
    category: input.category,
    brand: text(input.brand, LIMITS.brand), reference: cleanCode(input.reference, LIMITS.reference),
    lot: cleanCode(input.lot, LIMITS.lot), serial: cleanCode(input.serial, LIMITS.serial),
    expiry: cleanExpiry(input.expiry), manufacturer: text(input.manufacturer, LIMITS.manufacturer),
    tooth: cleanTooth(input.tooth), note: text(input.note, LIMITS.note), placedOn,
  };
}

/** Una línea con lo esencial para listas y para el documento. */
export function productSummary(p: Pick<ProductFields, "category" | "brand" | "reference" | "lot" | "serial">): string {
  const ids = [p.reference && `Ref. ${p.reference}`, p.lot && `Lote ${p.lot}`, p.serial && `N.º serie ${p.serial}`].filter(Boolean).join(" · ");
  return [categoryLabel(p.category), p.brand].filter(Boolean).join(" · ") + (ids ? ` — ${ids}` : "");
}

/** ¿Falta algún identificador clave para trazar el producto? (aviso suave, no bloquea). */
export const missingTrace = (p: Pick<ProductFields, "lot" | "serial">) => !p.lot && !p.serial;

/* ───────── Lectura de la etiqueta con IA ───────── */

export const LABEL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["category", "brand", "reference", "lot", "serial", "expiry", "manufacturer", "legible"],
  properties: {
    category: { type: "string", enum: ["implante", "injerto", "membrana", "pilar", "sutura", "otro", ""] },
    brand: { type: "string" }, reference: { type: "string" }, lot: { type: "string" }, serial: { type: "string" },
    expiry: { type: "string" }, manufacturer: { type: "string" }, legible: { type: "boolean" },
  },
} as const;

export const LABEL_PROMPT = [
  "Lees la foto de la etiqueta o envase de un producto biomédico odontológico (implante, injerto óseo, membrana, pilar, sutura) y transcribes SOLO lo que se ve impreso.",
  "Reglas estrictas: no inventes, no completes ni corrijas números; si un dato no se ve con total claridad, devuélvelo como cadena vacía.",
  "Lote (LOT) y número de serie (SN): cópialos exactamente como están, carácter por carácter; un lote o serie dudoso va vacío.",
  "Referencia o código de catálogo (REF): tal cual. Marca = nombre comercial visible; fabricante = empresa fabricante si aparece.",
  "Vencimiento (símbolo de reloj de arena o «EXP»): entrégalo como AAAA-MM o AAAA-MM-DD.",
  "category: implante, injerto, membrana, pilar, sutura u otro según el producto; vacío si no se puede saber.",
  "legible=false si la foto no permite leer la etiqueta. No describas al paciente ni nada fuera de la etiqueta.",
].join("\n");

export type LabelReading = Partial<Pick<ProductFields, "category" | "brand" | "reference" | "lot" | "serial" | "expiry" | "manufacturer">> & { legible: boolean };

/** Convierte la respuesta del modelo en campos limpios (lo desconocido queda vacío). */
export function parseLabelReading(raw: unknown): LabelReading {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: LabelReading = { legible: data.legible === true };
  if (isProductCategory(data.category)) out.category = data.category;
  out.brand = text(data.brand, LIMITS.brand); out.reference = cleanCode(data.reference, LIMITS.reference);
  out.lot = cleanCode(data.lot, LIMITS.lot); out.serial = cleanCode(data.serial, LIMITS.serial);
  out.expiry = cleanExpiry(data.expiry); out.manufacturer = text(data.manufacturer, LIMITS.manufacturer);
  // Si el modelo dice que no es legible, no se propone nada: evita lotes «adivinados».
  if (!out.legible) return { legible: false };
  return out;
}

/** Fecha de hoy (AAAA-MM-DD) en America/Santiago: la interfaz y los registros clínicos usan esa zona. */
export const santiagoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** «1. Implante · Arcsys — pieza 3.6» (título de cada ficha del documento). */
export const productFigureTitle = (index: number, p: Pick<ProductFields, "brand" | "tooth">, category: string) =>
  `${index}. ${[category, p.brand].filter(Boolean).join(" · ")}${p.tooth ? ` — pieza ${p.tooth}` : ""}`;

const expiryLabel = (value: string) => value.length === 7 ? `${value.slice(5)}/${value.slice(0, 4)}` : value ? value.split("-").reverse().join("/") : "";

/** Líneas de detalle del producto para el documento; solo lo que está registrado (no se imprimen «sin dato»). */
export function productFigureLines(p: Pick<ProductFields, "reference" | "lot" | "serial" | "expiry" | "manufacturer" | "note"> & { placedOnLabel: string }): string[] {
  return [
    p.reference && `Referencia / código: ${p.reference}`, p.lot && `Lote: ${p.lot}`, p.serial && `N.º de serie: ${p.serial}`,
    p.expiry && `Vencimiento: ${expiryLabel(p.expiry)}`, p.manufacturer && `Fabricante: ${p.manufacturer}`,
    `Colocado el ${p.placedOnLabel}`, p.note && `Nota: ${p.note}`,
  ].filter((line): line is string => Boolean(line));
}
