export const CLINICAL_DOCUMENT_KINDS = ["receta", "receta_magistral", "orden", "certificado", "consentimiento"] as const;
export type ClinicalDocumentKind = typeof CLINICAL_DOCUMENT_KINDS[number];
export type ClinicalDocumentContent = Record<string, string>;

const FIELDS: Record<ClinicalDocumentKind, Record<string, number>> = {
  receta: { indicacion: 800, medicamentos: 6000, prescripcion: 3000, instrucciones: 1800 },
  receta_magistral: { indicacion: 800, prescripcion: 3000, instrucciones: 1800 },
  orden: { diagnostico: 800, examenes: 3000, observaciones: 1800 },
  certificado: { motivo: 800, observaciones: 1800, vigencia: 300 },
  consentimiento: { procedimiento: 800, descripcion: 2500, riesgos: 3000, alternativas: 2000, declaracion: 1500 },
};

export const isClinicalDocumentKind = (value: unknown): value is ClinicalDocumentKind =>
  typeof value === "string" && CLINICAL_DOCUMENT_KINDS.includes(value as ClinicalDocumentKind);

export function cleanClinicalDocumentContent(kind: ClinicalDocumentKind, input: unknown): ClinicalDocumentContent {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(FIELDS[kind]).map(([key, max]) => [key,
    key === "medicamentos" ? cleanMedications(source[key]) :
    typeof source[key] === "string" ? source[key].normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "",
  ]));
}

export const CLINICAL_DOCUMENT_LABEL: Record<ClinicalDocumentKind, string> = {
  receta: "Receta médica", receta_magistral: "Receta magistral", orden: "Orden médica", certificado: "Certificado médico", consentimiento: "Consentimiento informado",
};

/** Las recetas (común y magistral) comparten diseño y exigen la habilitación del prestador para emitirse. */
export const isPrescriptionKind = (kind: string): boolean => kind === "receta" || kind === "receta_magistral";

/** Documentos que llevan SIEMPRE el QR de habilitación del prestador (Superintendencia de Salud): sin él no se emiten ni se imprimen. */
export const requiresHabilitacionQr = (kind: string): boolean => isPrescriptionKind(kind) || kind === "consentimiento";
/** Cómo nombrar el documento en los avisos de habilitación. */
export const habilitacionNoun = (kind: string): { esta: string; emitir: string } => kind === "consentimiento" ? { esta: "Este consentimiento", emitir: "consentimientos" } : { esta: "Esta receta", emitir: "recetas" };

export type PrescriptionLine = { name: string; detail: string };

/** Separa cada línea de la prescripción en medicamento (destacado) y pauta. No interpreta ni completa dosis. */
export function splitPrescriptionLines(text: string): PrescriptionLine[] {
  return text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map(line => {
    const cut = line.match(/\s[-–—·]\s|:\s|,\s/);
    if (!cut || cut.index === undefined || cut.index === 0) return { name: line, detail: "" };
    return { name: line.slice(0, cut.index).trim(), detail: line.slice(cut.index + cut[0].length).trim() };
  });
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate || "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Un medicamento de la receta, como en las recetas electrónicas (MekiDoc): nombre y concentración, posología estructurada, vía y cantidad a dispensar.
 *  `dosis` es la pauta en texto: en recetas nuevas se genera desde los campos estructurados; en recetas antiguas es el texto libre escrito. */
export type Medication = {
  nombre: string; dosis: string; via: string; cantidad: string;
  posologia?: string; unidad?: string; cada?: string; cadaUnidad?: string; duracion?: string; duracionUnidad?: string; indicaciones?: string;
};
export const MEDICATION_MAX = 15;
const MEDICATION_FIELD_MAX = { nombre: 160, dosis: 300, via: 60, cantidad: 80, indicaciones: 400 } as const;
const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

type UnitForms = { singular: string; plural: string; short: string; label?: string; countable?: boolean };
/** Unidades de posología (lista de MekiDoc más las habituales en odontología). `countable`: se dispensa por unidades y se puede calcular la cantidad. */
export const DOSE_UNITS: Record<string, UnitForms> = {
  ampolla: { singular: "ampolla", plural: "ampollas", short: "amp.", countable: true },
  "aplicación": { singular: "aplicación", plural: "aplicaciones", short: "aplic." },
  "cápsula": { singular: "cápsula", plural: "cápsulas", short: "cáps.", countable: true },
  comprimido: { singular: "comprimido", plural: "comprimidos", short: "comp.", countable: true },
  gota: { singular: "gota", plural: "gotas", short: "gotas" },
  gr: { singular: "gr", plural: "gr", short: "gr", label: "gr (gramo)" },
  ml: { singular: "ml", plural: "ml", short: "ml", label: "ml (mililitro)" },
  mg: { singular: "mg", plural: "mg", short: "mg", label: "mg (miligramo)" },
  "u.i.": { singular: "u.i.", plural: "u.i.", short: "u.i.", label: "u.i. (unidad internacional)" },
  parche: { singular: "parche", plural: "parches", short: "parches", countable: true },
  pomo: { singular: "pomo", plural: "pomos", short: "pomos" },
  puff: { singular: "puff", plural: "puffs", short: "puffs" },
  sobre: { singular: "sobre", plural: "sobres", short: "sobres", countable: true },
  supositorio: { singular: "supositorio", plural: "supositorios", short: "sup.", countable: true },
  tableta: { singular: "tableta", plural: "tabletas", short: "tab.", countable: true },
  cucharadita: { singular: "cucharadita", plural: "cucharaditas", short: "cdtas." },
  enjuague: { singular: "enjuague", plural: "enjuagues", short: "enjuagues" },
  unidad: { singular: "unidad", plural: "unidades", short: "u.", countable: true },
};
export const DOSE_UNIT_KEYS = Object.keys(DOSE_UNITS);
/** Unidades de tiempo, en horas para calcular la cantidad (mes = 30 días, año = 365 días). */
export const TIME_UNITS: Record<string, { singular: string; plural: string; hours: number }> = {
  hora: { singular: "hora", plural: "horas", hours: 1 },
  "día": { singular: "día", plural: "días", hours: 24 },
  semana: { singular: "semana", plural: "semanas", hours: 24 * 7 },
  mes: { singular: "mes", plural: "meses", hours: 24 * 30 },
  "año": { singular: "año", plural: "años", hours: 24 * 365 },
};
export const TIME_UNIT_KEYS = Object.keys(TIME_UNITS);

/** Vías de administración, en orden alfabético. Las frecuentes en odontología se muestran también arriba en el selector. */
export const VIAS = ["bucal", "enjuague bucal", "epidural", "gastrostomía", "inhalatoria", "intraarticular", "intracavernosa", "intramuscular", "intravenosa", "nasal", "nebulización", "ocular", "oral", "ótica", "rectal", "subcutánea", "sublingual", "tópica", "transdérmica", "vaginal"].sort((a, b) => a.localeCompare(b, "es"));
export const VIAS_FRECUENTES = ["oral", "bucal", "enjuague bucal", "sublingual", "tópica"];

/** Número positivo escrito con punto o coma ("1", "0,5", "1.5"); null si no es válido. */
export function parseAmount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}
const formatAmount = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const unitWord = (n: number, forms: { singular: string; plural: string }) => n > 1 ? forms.plural : forms.singular;

const isStructured = (m: Medication) => Boolean(m.unidad && DOSE_UNITS[m.unidad] && parseAmount(m.posologia));

/** Cantidad total de unidades para medicamentos que se dispensan por unidad (ej. 1 comprimido cada 8 horas por 7 días = 21). */
export function computeQuantity(m: Medication): number | null {
  const unit = m.unidad ? DOSE_UNITS[m.unidad] : undefined;
  const dose = parseAmount(m.posologia), every = parseAmount(m.cada), length = parseAmount(m.duracion);
  const everyUnit = m.cadaUnidad ? TIME_UNITS[m.cadaUnidad] : undefined, lengthUnit = m.duracionUnidad ? TIME_UNITS[m.duracionUnidad] : undefined;
  if (!unit?.countable || !dose || !every || !length || !everyUnit || !lengthUnit) return null;
  const takes = (length * lengthUnit.hours) / (every * everyUnit.hours);
  if (takes < 1 || takes > 10000) return null;
  return Math.ceil(Math.round(takes * 1000) / 1000 * dose);
}

/** Texto de "Cantidad a dispensar" calculado (ej. "21 comprimidos"); vacío si no se puede calcular. */
export function autoQuantityText(m: Medication): string {
  const q = computeQuantity(m);
  return q && m.unidad ? `${q} ${unitWord(q, DOSE_UNITS[m.unidad])}` : "";
}

/** Pauta legible: "1 comprimido cada 8 horas por 7 días (21 comp.)". Para recetas antiguas devuelve el texto escrito. */
export function medicationDosis(m: Medication): string {
  if (!isStructured(m)) return m.dosis;
  const unit = DOSE_UNITS[m.unidad!], dose = parseAmount(m.posologia)!;
  let text = `${formatAmount(dose)} ${unitWord(dose, unit)}`;
  const every = parseAmount(m.cada), everyUnit = m.cadaUnidad ? TIME_UNITS[m.cadaUnidad] : undefined;
  if (every && everyUnit) text += every === 1 ? ` cada ${everyUnit.singular}` : ` cada ${formatAmount(every)} ${unitWord(every, everyUnit)}`;
  const length = parseAmount(m.duracion), lengthUnit = m.duracionUnidad ? TIME_UNITS[m.duracionUnidad] : undefined;
  if (length && lengthUnit) text += ` por ${formatAmount(length)} ${unitWord(length, lengthUnit)}`;
  const q = computeQuantity(m);
  if (q) text += ` (${q} ${unit.short})`;
  return text;
}

/** Línea impresa: pauta + vía, con punto entre ambas. */
export function medicationLine(m: Medication): string {
  const dosis = medicationDosis(m).trim();
  if (!dosis) return m.via ? `Vía: ${m.via}` : "";
  return m.via ? `${dosis}${dosis.endsWith(".") ? "" : "."} Vía: ${m.via}` : dosis;
}

const cleanAmount = (value: unknown) => { const n = parseAmount(value); return n === null ? "" : String(Math.round(n * 100) / 100); };
const cleanKey = (value: unknown, keys: string[]) => typeof value === "string" && keys.includes(value) ? value : "";

/** Lista de medicamentos guardada como JSON dentro del contenido (texto). Se descarta lo que no tenga nombre. */
export function parseMedications(value: unknown): Medication[] {
  let list: unknown = value;
  if (typeof value === "string") { if (!value.trim()) return []; try { list = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.slice(0, MEDICATION_MAX).map(item => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const base: Medication = { nombre: cleanText(source.nombre, MEDICATION_FIELD_MAX.nombre), dosis: cleanText(source.dosis, MEDICATION_FIELD_MAX.dosis), via: cleanText(source.via, MEDICATION_FIELD_MAX.via), cantidad: cleanText(source.cantidad, MEDICATION_FIELD_MAX.cantidad) };
    const structured: Medication = { ...base,
      posologia: cleanAmount(source.posologia), unidad: cleanKey(source.unidad, DOSE_UNIT_KEYS),
      cada: cleanAmount(source.cada), cadaUnidad: cleanKey(source.cadaUnidad, TIME_UNIT_KEYS),
      duracion: cleanAmount(source.duracion), duracionUnidad: cleanKey(source.duracionUnidad, TIME_UNIT_KEYS),
      indicaciones: typeof source.indicaciones === "string" ? source.indicaciones.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, MEDICATION_FIELD_MAX.indicaciones) : "",
    };
    // Recetas antiguas (texto libre) se conservan tal cual; las nuevas guardan la pauta generada desde los campos.
    if (!isStructured(structured)) return structured.indicaciones ? { ...base, indicaciones: structured.indicaciones } : base;
    return { ...structured, dosis: medicationDosis(structured).slice(0, MEDICATION_FIELD_MAX.dosis), cantidad: structured.cantidad || autoQuantityText(structured) };
  }).filter(item => item.nombre);
}

export function cleanMedications(value: unknown): string {
  const list = parseMedications(value);
  return list.length ? JSON.stringify(list) : "";
}

/** Texto para enviar la receta emitida al paciente por WhatsApp o correo (solo con su propio contacto; incluye el enlace de verificación). */
export function prescriptionShareText(input: { patientName: string; clinic: string; doctor: string; dateText: string; medications: Medication[]; extra: string; url: string }): string {
  const first = input.patientName.trim().split(/\s+/)[0] ?? "";
  const items = input.medications.map((m, index) => {
    const detail = [medicationLine(m), m.cantidad ? `Cantidad a dispensar: ${m.cantidad}` : "", m.indicaciones?.trim() ?? ""].filter(Boolean).join(" ");
    return `${index + 1}. ${m.nombre}${detail ? ` — ${detail}` : ""}`;
  });
  const extra = input.extra.trim() ? splitPrescriptionLines(input.extra).map((line, index) => `${items.length + index + 1}. ${line.detail ? `${line.name} — ${line.detail}` : line.name}`) : [];
  const body = [...items, ...extra].join("\n");
  return `Hola${first ? ` ${first}` : ""}, te enviamos${input.clinic ? ` desde ${input.clinic}` : ""} tu receta médica, emitida por ${input.doctor || "tu profesional"}${input.dateText ? ` el ${input.dateText}` : ""}.${body ? `\n\nRp.\n${body}` : ""}\n\nPuedes verificar la receta aquí: ${input.url}`;
}
