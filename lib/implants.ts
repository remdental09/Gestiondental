/**
 * Implantología: una ficha por implante (pieza, etapa e historial, medidas, conexión, etiqueta e imágenes). Puro (sin DOM ni base de datos).
 * Principios: escribir lo mínimo, la app propone desde la etiqueta o el odontograma y el profesional confirma.
 * Un dato no informado queda vacío; no se deducen medidas, marcas, conexiones ni estados clínicos.
 */
import { cleanTooth, isDay } from "./biomedical-products.ts";

/** Todas las etapas en su orden. `retired`: ya no se ofrece, pero lo que se marcó se conserva (no se convierte en otra etapa). */
const ALL_PHASES = [
  { id: "evaluacion", label: "Evaluación" },
  { id: "plan", label: "Plan" },
  { id: "cirugia", label: "Cirugía" },
  { id: "osteointegracion", label: "Osteointegración", retired: true },
  { id: "conexion", label: "Conexión de implante" },
  { id: "rehabilitacion", label: "Rehabilitación" },
  { id: "mantencion", label: "Mantención" },
] as const;
/** "" = sin registrar. */
export type ImplantPhase = typeof ALL_PHASES[number]["id"] | "";
/** Etapas que se ofrecen, más las retiradas que este implante ya tenga marcadas. */
export const stageOptions = (marked: readonly string[] = []) => ALL_PHASES.filter(item => !("retired" in item) || marked.includes(item.id));
export const phaseLabel = (id: string) => ALL_PHASES.find(item => item.id === id)?.label ?? "Sin etapa registrada";

export type RecordedPhase = Exclude<ImplantPhase, "">;
export const isPhase = (value: unknown): value is RecordedPhase => ALL_PHASES.some(item => item.id === value);

export const IMPLANT_CONNECTIONS = [
  { id: "hexagono-externo", label: "Hexágono externo", text: "Conexión hexágono externo" },
  { id: "hexagono-interno", label: "Hexágono interno", text: "Conexión hexágono interno" },
  { id: "conica", label: "Cónica (cono Morse)", text: "Conexión cónica" },
  { id: "otra", label: "Otra", text: "Otra conexión" },
] as const;
/** "" = sin registrar. */
export type ImplantConnection = typeof IMPLANT_CONNECTIONS[number]["id"] | "";
/** Frase para el recuadro y el respaldo («Conexión cónica»); vacía si no está registrada. */
export const connectionText = (id: string) => IMPLANT_CONNECTIONS.find(item => item.id === id)?.text ?? "";

export type KnownConnection = { brand: string; system: string; connection: string };
const same = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
/**
 * La conexión que el profesional ya confirmó para la misma marca y sistema (la lista viene de la más reciente a la más antigua).
 * Es solo una propuesta: no se escribe sin que la toque. Sin marca no se propone nada.
 */
export function suggestConnection(known: KnownConnection[], brand: string, system: string): ImplantConnection {
  if (!same(brand)) return "";
  const found = known.find(item => connectionText(item.connection) && same(item.brand) === same(brand) && same(item.system) === same(system));
  return (found?.connection ?? "") as ImplantConnection;
}

export const IMPLANT_VIEWS = ["Panorámica", "Transversal", "Axial", "Vista 3D", "Radiografía", "Foto clínica"] as const;
export type ImplantView = typeof IMPLANT_VIEWS[number];
export const imageKindForView = (view: ImplantView) => view === "Radiografía" ? "Radiografía" as const : view === "Foto clínica" ? "Foto clínica" as const : "Captura CBCT" as const;
/** Lo que no es un corte de tomografía no se pasa por el recorte de ventanas del visor. */
export const isCutView = (view: ImplantView) => view !== "Radiografía" && view !== "Foto clínica";
export const MAX_IMPLANT_IMAGES = 40;
export const MAX_IMPLANTS_PER_PATIENT = 80;

export const COMMON_DIAMETERS = [3, 3.3, 3.5, 3.75, 4, 4.1, 4.3, 4.5, 4.8, 5, 6];
export const COMMON_LENGTHS = [6, 8, 8.5, 10, 11.5, 12, 13, 14, 16];

/** Arcadas como se ven en pantalla (FDI compacto). */
export const UPPER_ARCH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_ARCH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export type ImplantFields = {
  tooth: string; phase: ImplantPhase; brand: string; system: string; connection: ImplantConnection;
  diameter: number | null; length: number | null; placedOn: string; torque: number | null; isq: number | null;
  productId: number | null; note: string;
};
/** `stage`: la fase donde se agregó; sin él, la imagen es del implante en general. */
export type ImplantImage = { imageId: number; view: ImplantView; stage?: RecordedPhase };
/** Paso por una etapa. `date` AAAA-MM-DD, o vacío si no se sabe cuándo fue. */
export type PhaseEntry = { phase: RecordedPhase; date: string };
export const MAX_PHASE_HISTORY = 40;
/** `history` guarda las etapas marcadas y su fecha; la actual (`phase`) es la más avanzada. */
export type Implant = ImplantFields & { id: number; images: ImplantImage[]; history: PhaseEntry[]; stageNotes: StageNotes };
/** Nota escrita en cada fase. */
export type StageNotes = Partial<Record<RecordedPhase, string>>;
export const MAX_STAGE_NOTE = 1000;

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
      tooth, phase: isPhase(input.phase) ? input.phase : "",
      brand: text(input.brand, 80), system: text(input.system, 80),
      connection: IMPLANT_CONNECTIONS.some(item => item.id === input.connection) ? input.connection as ImplantConnection : "", diameter, length, placedOn: placed, torque, isq,
      productId: Number.isSafeInteger(productId) && productId > 0 ? productId : null, note: text(input.note, 600),
    },
  };
}

export function cleanImplantImage(input: unknown): ImplantImage | null {
  if (!input || typeof input !== "object") return null;
  const { imageId, view, stage } = input as { imageId?: unknown; view?: unknown; stage?: unknown };
  const id = Number(imageId);
  if (!Number.isSafeInteger(id) || id < 1 || !IMPLANT_VIEWS.includes(view as ImplantView)) return null;
  return { imageId: id, view: view as ImplantView, ...(isPhase(stage) ? { stage } : {}) };
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

/** Nota de varias líneas: se conservan los saltos; el resto de los caracteres de control se quita. */
export const cleanStageNote = (value: unknown): string =>
  typeof value === "string" ? value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").trim().slice(0, MAX_STAGE_NOTE) : "";

/** Lee las notas guardadas; lo dañado o de una fase desconocida se omite. */
export function parseStageNotes(raw: unknown): StageNotes {
  try {
    const data = JSON.parse(String(raw)) as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(ALL_PHASES.flatMap(item => { const note = cleanStageNote(data[item.id]); return note ? [[item.id, note]] : []; }));
  } catch { return {}; }
}

/** Escribe, corrige o borra (vacía) la nota de una fase. `was` es la que mostraba la pantalla: si cambió en otro lado, no se pisa. */
export function setStageNote(raw: unknown, change: unknown): { notes: StageNotes } | { error: string; stale?: boolean } {
  const { phase, was, note } = (change ?? {}) as { phase?: unknown; was?: unknown; note?: unknown };
  if (!isPhase(phase) || typeof note !== "string") return { error: "Nota no válida." };
  if (note.trim().length > MAX_STAGE_NOTE) return { error: `La nota de la fase admite hasta ${MAX_STAGE_NOTE} caracteres.` };
  const notes = parseStageNotes(raw);
  if ((notes[phase] ?? "") !== cleanStageNote(was)) return { error: "La nota de esta fase cambió en otro lado. Revísala y guarda otra vez.", stale: true };
  const next = cleanStageNote(note);
  if (next) notes[phase] = next; else delete notes[phase];
  return { notes };
}

const historyDay = (value: unknown, today?: string): value is string => value === "" || (typeof value === "string" && isDay(value) && (!today || value <= today));

/** Lee el historial guardado; lo dañado se omite. */
export function parseHistory(raw: unknown): PhaseEntry[] {
  try {
    const list = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap(item => {
      const { phase, date } = (item ?? {}) as { phase?: unknown; date?: unknown };
      return isPhase(phase) && historyDay(date) ? [{ phase, date }] : [];
    }).slice(-MAX_PHASE_HISTORY);
  } catch { return []; }
}

type Staged = { phase: string; placedOn: string };
/**
 * Historial después de guardar la ficha. Una etapa que llega por aquí (ficha nueva) queda sin fecha porque nadie la informó;
 * la cirugía usa la fecha de instalación si está. Las fechas de etapa se anotan con `setStage`.
 * La etapa que un implante ya tenía antes de existir el historial se conserva sin inventarle fecha.
 * La entrada de cirugía que repetía la fecha de instalación la sigue cuando esta se corrige.
 */
export function recordPhase(history: PhaseEntry[], before: Staged, after: Staged): PhaseEntry[] {
  let list = before.placedOn === after.placedOn ? history
    : history.map(entry => entry.phase === "cirugia" && entry.date === before.placedOn ? { ...entry, date: after.placedOn } : entry);
  if (!isPhase(after.phase) || after.phase === before.phase) return list;
  if (!list.length && isPhase(before.phase)) list = [{ phase: before.phase, date: before.phase === "cirugia" ? after.placedOn : "" }];
  if (list.at(-1)?.phase === after.phase) return list;
  return [...list, { phase: after.phase, date: after.phase === "cirugia" ? after.placedOn : "" }].slice(-MAX_PHASE_HISTORY);
}

const EDITABLE = ["tooth", "phase", "brand", "system", "connection", "diameter", "length", "placedOn", "torque", "isq", "productId", "note"] as const;
/**
 * Corrección de una ficha que pudo quedar atrás: `base` es lo que la pantalla tenía antes de escribir. Lo que no se tocó conserva lo
 * guardado; si la etapa o la conexión cambiaron a la vez aquí y en otro lado, no se guarda y se avisa.
 * Una pantalla antigua no envía `base` (ni conexión): se guarda lo que manda y la conexión se conserva.
 */
export function mergeImplantEdit(current: Record<string, unknown>, body: Record<string, unknown>): { input: Record<string, unknown> } | { error: string } {
  const base = body.base && typeof body.base === "object" ? body.base as Record<string, unknown> : null;
  const input: Record<string, unknown> = { ...body };
  if (base) {
    for (const field of ["phase", "connection"] as const) {
      if (body[field] !== base[field] && current[field] !== base[field] && current[field] !== body[field])
        return { error: `${field === "phase" ? "La etapa" : "La conexión"} de este implante cambió mientras la ficha estaba abierta. Revísala y guarda otra vez.` };
    }
    for (const field of EDITABLE) if (body[field] === base[field]) input[field] = current[field];
  }
  if (input.connection === undefined) input.connection = current.connection;
  return { input };
}

/** Etapas marcadas de un implante con su fecha ("" = sin fecha). La fecha de la cirugía es la de instalación. */
export function stageMarks(history: PhaseEntry[], phase: string, placedOn: string): Partial<Record<RecordedPhase, string>> {
  const marks: Partial<Record<RecordedPhase, string>> = {};
  for (const entry of history) marks[entry.phase] = entry.date;
  if (isPhase(phase)) marks[phase] ??= "";
  if (marks.cirugia === "" && placedOn) marks.cirugia = placedOn;
  return marks;
}

/** `was` es lo que mostraba la pantalla para esa etapa: su fecha, "" si estaba sin fecha o null si no estaba marcada. */
export type StageChange = { phase: RecordedPhase; was: string | null } & ({ date: string } | { remove: true });

/**
 * Marca una etapa con su fecha (en cualquier orden), corrige la fecha o quita la marca. La etapa actual es la más avanzada marcada.
 * Si la etapa cambió en otro lado desde que se vio, no se toca nada.
 */
export function setStage(history: PhaseEntry[], current: Staged, change: unknown, today: string): { history: PhaseEntry[]; phase: RecordedPhase | ""; placedOn: string } | { error: string; stale?: boolean } {
  const { phase, was, date, remove } = (change ?? {}) as { phase?: unknown; was?: unknown; date?: unknown; remove?: unknown };
  if (!isPhase(phase)) return { error: "Etapa no válida." };
  const marks = stageMarks(history, current.phase, current.placedOn);
  if (was !== (marks[phase] ?? null)) return { error: "Esa etapa cambió. Revísala e intenta otra vez.", stale: true };
  let placedOn = current.placedOn;
  if (remove === true) {
    if (marks[phase] === undefined) return { error: "Esa etapa no estaba marcada." };
    delete marks[phase];
    if (phase === "cirugia") placedOn = "";
  } else {
    if (!historyDay(date, today)) return { error: "La fecha de la etapa no puede ser futura." };
    marks[phase] = date;
    if (phase === "cirugia") placedOn = date;
  }
  const list = ALL_PHASES.flatMap(item => { const day = marks[item.id]; return day === undefined ? [] : [{ phase: item.id, date: day }]; });
  return { history: list, phase: list.at(-1)?.phase ?? "", placedOn };
}

export const mm = (value: number | null) => value === null ? "" : String(value).replace(".", ",");

/** «4,1 × 10 mm», o solo la medida registrada. */
export function implantSize(item: Pick<ImplantFields, "diameter" | "length">): string {
  return item.diameter !== null && item.length !== null ? `${mm(item.diameter)} × ${mm(item.length)} mm`
    : item.diameter !== null ? `Ø ${mm(item.diameter)} mm` : item.length !== null ? `largo ${mm(item.length)} mm` : "";
}

/** «Straumann BLT · 4,1 × 10 mm»: solo lo registrado. */
export function implantSummary(item: Pick<ImplantFields, "brand" | "system" | "diameter" | "length">): string {
  return [[item.brand, item.system].filter(Boolean).join(" "), implantSize(item)].filter(Boolean).join(" · ");
}

/** Orden de los implantes como se ven en el implantograma (arcada superior y luego inferior). */
export function archOrder<T extends { id: number; tooth: string }>(list: T[]): T[] {
  const arch = [...UPPER_ARCH, ...LOWER_ARCH].map(code => `${Math.floor(code / 10)}.${code % 10}`);
  return [...list].sort((a, b) => arch.indexOf(a.tooth) - arch.indexOf(b.tooth) || a.id - b.id);
}

/** Datos de un implante tal como salen en el respaldo y las descargas (sin las imágenes que ya se borraron). */
export type StoredImplant = Omit<ImplantFields, "phase" | "connection"> & { phase: string; connection: string; history: string; id: number; images: string; stageNotes?: string | null; createdByName: string; createdAt: string; updatedAt: string };
export function backupImplant(r: StoredImplant, available?: Set<number>) {
  return {
    id: r.id, tooth: r.tooth, phase: r.phase, history: parseHistory(r.history), brand: r.brand, system: r.system, connection: r.connection ?? "", diameter: r.diameter, length: r.length, placedOn: r.placedOn,
    torque: r.torque, isq: r.isq, productId: r.productId, note: r.note,
    images: parseImplantImages(r.images).filter(image => !available || available.has(image.imageId)),
    // Solo si hay alguna: el respaldo de un implante sin notas por fase queda igual que antes.
    ...(Object.keys(parseStageNotes(r.stageNotes ?? "")).length ? { stageNotes: parseStageNotes(r.stageNotes ?? "") } : {}),
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
