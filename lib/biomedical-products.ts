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
  /** Descripción impresa del producto («Implante … 3,3X9mm + Tapa»). */
  model: string;
  /** Medidas en mm, tal como las dice la etiqueta (texto: no todo producto trae un número simple). */
  diameter: string; length: string;
  /** Registro sanitario con su organismo («ANVISA 12345678901»). */
  registration: string;
  /** Fecha de fabricación (AAAA-MM o AAAA-MM-DD). */
  manufactured: string;
  gtin: string;
  /** Todo lo demás impreso en la etiqueta, como JSON [{label, value}]. */
  details: string;
  /** Contenido literal del código leído (QR, Data Matrix o barras). */
  code: string;
};

/** Campos añadidos después del primer registro: se respaldan y se editan solo cuando existen. */
export const PRODUCT_EXTRA_FIELDS = ["model", "diameter", "length", "registration", "manufactured", "gtin", "details", "code"] as const;
export type ProductDetail = { label: string; value: string };
export const MAX_DETAILS = 30;

/** Datos nuevos de la etiqueta para el respaldo: solo los que existen, así un producto anterior queda igual que antes. */
export function labelExtras(p: Partial<Record<typeof PRODUCT_EXTRA_FIELDS[number], string | null>>): Record<string, unknown> {
  return Object.fromEntries(PRODUCT_EXTRA_FIELDS.flatMap(key => {
    const value = key === "details" ? parseDetails(p.details) : p[key];
    return value && value.length ? [[key, value]] : [];
  }));
}

/** Acepta la lista o su JSON; omite filas sin dato. */
export function parseDetails(value: unknown): ProductDetail[] {
  let list: unknown = value;
  if (typeof value === "string") { try { list = JSON.parse(value || "[]"); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    const label = text((item as ProductDetail | null)?.label, 60), data = text((item as ProductDetail | null)?.value, 240);
    return data ? [{ label, value: data }] : [];
  }).slice(0, MAX_DETAILS);
}

/** Medida en mm: «3,3», «Ø 3.3 mm» → «3,3». Lo que no sea un número simple se conserva como está escrito. */
export function cleanMeasure(value: unknown): string {
  const raw = text(value, 30);
  const number = /^(?:[ØøDLdl⌀]\s*[:=]?\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:mm)?$/i.exec(raw);
  return number ? number[1]!.replace(".", ",") : raw;
}

const LIMITS = { brand: 80, reference: 60, lot: 60, serial: 60, manufacturer: 200, note: 600, model: 200, registration: 100, code: 1500 } as const;
const cleanGtin = (value: unknown) => { const digits = text(value, 30).replace(/\s/g, ""); return /^\d{8,14}$/.test(digits) ? digits : ""; };
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
    model: text(input.model, LIMITS.model), diameter: cleanMeasure(input.diameter), length: cleanMeasure(input.length),
    registration: text(input.registration, LIMITS.registration), manufactured: cleanExpiry(input.manufactured), gtin: cleanGtin(input.gtin),
    details: JSON.stringify(parseDetails(input.details)), code: text(input.code, LIMITS.code),
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
  required: ["category", "brand", "model", "diameter", "length", "reference", "lot", "serial", "manufactured", "expiry", "manufacturer", "registration", "gtin", "other", "legible"],
  properties: {
    category: { type: "string", enum: ["implante", "injerto", "membrana", "pilar", "sutura", "otro", ""] },
    brand: { type: "string" }, model: { type: "string" }, diameter: { type: "string" }, length: { type: "string" },
    reference: { type: "string" }, lot: { type: "string" }, serial: { type: "string" }, manufactured: { type: "string" },
    expiry: { type: "string" }, manufacturer: { type: "string" }, registration: { type: "string" }, gtin: { type: "string" },
    other: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    legible: { type: "boolean" },
  },
} as const;

export const LABEL_PROMPT = [
  "Lees la foto de la etiqueta o envase de un producto biomédico odontológico (implante, injerto óseo, membrana, pilar, sutura) y transcribes TODO lo que se ve impreso, sin omitir datos.",
  "Reglas estrictas: no inventes, no completes ni corrijas números; si un dato no se ve con total claridad, devuélvelo como cadena vacía.",
  "model = descripción o nombre del producto como está impreso (si viene en varios idiomas, una sola vez, en español si existe).",
  "diameter y length = medidas en milímetros impresas en la etiqueta (por ejemplo «SIZE 3.3X9MM» o «Ø 3,3 x 9 mm» en un implante: diameter 3,3 y length 9). No las deduzcas del código de referencia. Otras medidas (volumen, granulometría, dimensiones de una membrana) van en other.",
  "Lote (LOT) y número de serie (SN): cópialos exactamente como están, carácter por carácter; un lote o serie dudoso va vacío.",
  "Referencia o código de catálogo (REF): tal cual. Marca = nombre comercial visible; manufacturer = empresa fabricante (nombre y, si aparece, dirección o país).",
  "registration = registro sanitario con el nombre del organismo (por ejemplo «ANVISA 12345678901», «ISP …»). gtin = número del código de barras si está impreso.",
  "manufactured (símbolo de fábrica con fecha) y expiry (reloj de arena o «EXP»): AAAA-MM-DD, o AAAA-MM si la etiqueta no trae día.",
  "other = lista con cada dato impreso que no tenga campo propio, con su nombre en español en label: material, superficie, conexión o plataforma, contenido del envase, esterilización, cantidad, revisión, representante autorizado, marcado CE, símbolos y advertencias, sitio de instrucciones, teléfono del fabricante.",
  "category: implante, injerto, membrana, pilar, sutura u otro según el producto; vacío si no se puede saber.",
  "legible=false si la foto no permite leer la etiqueta. No describas al paciente ni nada fuera de la etiqueta.",
].join("\n");

export type LabelReading = Partial<Pick<ProductFields, "category" | "brand" | "model" | "diameter" | "length" | "reference" | "lot" | "serial" | "manufactured" | "expiry" | "manufacturer" | "registration" | "gtin">> & { other?: ProductDetail[]; legible: boolean };

/** Convierte la respuesta del modelo en campos limpios (lo desconocido queda vacío). */
export function parseLabelReading(raw: unknown): LabelReading {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: LabelReading = { legible: data.legible === true };
  if (isProductCategory(data.category)) out.category = data.category;
  out.brand = text(data.brand, LIMITS.brand); out.reference = cleanCode(data.reference, LIMITS.reference);
  out.lot = cleanCode(data.lot, LIMITS.lot); out.serial = cleanCode(data.serial, LIMITS.serial);
  out.expiry = cleanExpiry(data.expiry); out.manufacturer = text(data.manufacturer, LIMITS.manufacturer);
  out.model = text(data.model, LIMITS.model); out.diameter = cleanMeasure(data.diameter); out.length = cleanMeasure(data.length);
  out.manufactured = cleanExpiry(data.manufactured); out.registration = text(data.registration, LIMITS.registration); out.gtin = cleanGtin(data.gtin);
  out.other = parseDetails(data.other);
  // Si el modelo dice que no es legible, no se propone nada: evita lotes «adivinados».
  if (!out.legible) return { legible: false };
  return out;
}

/** Fecha de hoy (AAAA-MM-DD) en America/Santiago: la interfaz y los registros clínicos usan esa zona. */
export const santiagoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** «1. Implante · Arcsys — pieza 3.6» (título de cada ficha del documento). */
export const productFigureTitle = (index: number, p: Pick<ProductFields, "brand" | "tooth">, category: string) =>
  `${index}. ${[category, p.brand].filter(Boolean).join(" · ")}${p.tooth ? ` — pieza ${p.tooth}` : ""}`;

export const expiryLabel = (value: string) => value.length === 7 ? `${value.slice(5)}/${value.slice(0, 4)}` : value ? value.split("-").reverse().join("/") : "";

/** «Ø 3,3 mm · largo 9 mm»: solo lo registrado. */
export function measureText(p: { diameter?: string; length?: string }): string {
  const mm = (value: string) => /^\d+(?:,\d+)?$/.test(value) ? `${value} mm` : value;
  return [p.diameter && `Ø ${mm(p.diameter)}`, p.length && `largo ${mm(p.length)}`].filter(Boolean).join(" · ");
}

/** Líneas de detalle del producto para el documento; solo lo que está registrado (no se imprimen «sin dato»). */
export function productFigureLines(p: Pick<ProductFields, "reference" | "lot" | "serial" | "expiry" | "manufacturer" | "note"> & Partial<Pick<ProductFields, "model" | "diameter" | "length" | "registration" | "manufactured" | "gtin" | "details">> & { placedOnLabel: string }): string[] {
  const measures = measureText(p);
  // El resto de la etiqueta va en un solo párrafo acotado: cada producto debe caber en una página (el dato completo queda en la ficha y su foto).
  const others = parseDetails(p.details).map(item => item.label ? `${item.label}: ${item.value}` : item.value).join(" · ");
  return [
    p.model && `Producto: ${p.model}`, measures && `Medidas: ${measures}`,
    p.reference && `Referencia / código: ${p.reference}`, p.lot && `Lote: ${p.lot}`, p.serial && `N.º de serie: ${p.serial}`,
    p.manufactured && `Fabricación: ${expiryLabel(p.manufactured)}`, p.expiry && `Vencimiento: ${expiryLabel(p.expiry)}`,
    p.manufacturer && `Fabricante: ${p.manufacturer}`, p.registration && `Registro sanitario: ${p.registration}`, p.gtin && `GTIN: ${p.gtin}`,
    others && `Otros datos: ${others.length > 700 ? `${others.slice(0, 700)}…` : others}`,
    `Colocado el ${p.placedOnLabel}`, p.note && `Nota: ${p.note}`,
  ].filter((line): line is string => Boolean(line));
}
