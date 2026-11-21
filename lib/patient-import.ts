/**
 * Importar pacientes desde Dentalsoft u otro sistema (Excel o CSV con encabezados desconocidos).
 * Funciones puras: decodificar, separar columnas, reconocer encabezados en español, validar RUT y fechas.
 * Nada se guarda aquí; la pantalla muestra la vista previa y el servidor guarda solo al confirmar.
 */
import { cleanRutValue, isValidChileanRut } from "./patient-document.ts";

export type Cell = string | number | boolean | null | undefined;
export type FieldKey =
  | "rut" | "dv" | "nombres" | "apellidoPaterno" | "apellidoMaterno" | "nombreCompleto" | "fechaNacimiento" | "sexo" | "telefono" | "celular"
  | "email" | "direccion" | "comuna" | "prevision" | "observaciones" | "alertas" | "ficha"
  | "fechaAtencion" | "evolucion" | "profesional" | "pieza"
  | "fechaCita" | "horaCita" | "motivoCita";
export type SheetKind = "pacientes" | "evoluciones" | "citas" | "presupuestos" | "pagos" | "desconocido";

export const FIELD_GROUPS: Array<{ label: string; fields: Array<[FieldKey, string]> }> = [
  { label: "Paciente", fields: [["rut", "RUT / RUN"], ["dv", "Dígito verificador (DV)"], ["nombreCompleto", "Nombre completo"], ["nombres", "Nombres"], ["apellidoPaterno", "Apellido paterno"], ["apellidoMaterno", "Apellido materno"], ["fechaNacimiento", "Fecha de nacimiento"], ["sexo", "Sexo"], ["celular", "Celular"], ["telefono", "Teléfono"], ["email", "Correo"], ["direccion", "Dirección"], ["comuna", "Comuna"], ["prevision", "Previsión (Fonasa / Isapre)"], ["observaciones", "Observaciones / antecedentes"], ["alertas", "Alertas / alergias"], ["ficha", "N° de ficha"]] },
  { label: "Evolución", fields: [["fechaAtencion", "Fecha de la atención"], ["evolucion", "Texto de la evolución"], ["profesional", "Profesional"], ["pieza", "Pieza"]] },
  { label: "Cita", fields: [["fechaCita", "Fecha de la cita"], ["horaCita", "Hora de la cita"], ["motivoCita", "Motivo de la cita"]] },
];
export const FIELD_LABEL = Object.fromEntries(FIELD_GROUPS.flatMap(group => group.fields)) as Record<FieldKey, string>;

const SYNONYMS: Record<FieldKey, string[]> = {
  rut: ["rut", "run", "rut paciente", "rut del paciente", "run paciente", "documento", "n documento", "numero documento", "numero de documento", "cedula", "cedula identidad", "ci", "dni", "identificacion", "rut sin dv"],
  dv: ["dv", "digito verificador", "digito", "dig verificador"],
  nombres: ["nombres", "nombre", "primer nombre", "nombres paciente"],
  apellidoPaterno: ["apellido paterno", "ap paterno", "apellido 1", "primer apellido", "paterno", "apellido", "apellidos"],
  apellidoMaterno: ["apellido materno", "ap materno", "apellido 2", "segundo apellido", "materno"],
  nombreCompleto: ["nombre completo", "paciente", "nombre paciente", "nombre del paciente", "nombre y apellido", "nombre y apellidos", "nombre completo paciente"],
  fechaNacimiento: ["fecha nacimiento", "fecha de nacimiento", "f nacimiento", "nacimiento", "fec nac", "fnac", "f nac", "fecha nac", "cumpleanos"],
  sexo: ["sexo", "genero"],
  telefono: ["telefono", "fono", "telefono fijo", "tel", "telefono casa", "telefono particular", "fono fijo"],
  celular: ["celular", "movil", "telefono movil", "cel", "whatsapp", "telefono celular", "fono celular"],
  email: ["email", "e mail", "correo", "correo electronico", "mail"],
  direccion: ["direccion", "domicilio", "calle", "direccion particular"],
  comuna: ["comuna", "ciudad", "localidad"],
  prevision: ["prevision", "isapre", "fonasa", "aseguradora", "seguro", "prevision de salud", "convenio", "isapre fonasa"],
  observaciones: ["observaciones", "observacion", "comentarios", "comentario", "antecedentes", "antecedentes medicos", "antecedentes morbidos", "notas paciente"],
  alertas: ["alertas", "alerta", "alergias", "alergia", "advertencias", "alerta medica"],
  ficha: ["n ficha", "numero ficha", "numero de ficha", "ficha", "nro ficha", "n de ficha", "id paciente", "codigo paciente", "folio", "n paciente"],
  fechaAtencion: ["fecha", "fecha atencion", "fecha de atencion", "fecha evolucion", "fecha registro", "fecha de registro", "fecha tratamiento"],
  evolucion: ["evolucion", "evoluciones", "nota", "notas", "nota clinica", "detalle", "descripcion", "registro clinico", "atencion realizada", "texto evolucion", "observacion clinica"],
  profesional: ["profesional", "dentista", "doctor", "odontologo", "tratante", "atendido por", "profesional tratante"],
  pieza: ["pieza", "diente", "piezas", "pieza dental"],
  fechaCita: ["fecha cita", "fecha de la cita", "dia cita", "fecha agenda", "dia"],
  horaCita: ["hora", "hora cita", "hora inicio", "inicio", "hora de la cita", "hora agenda"],
  motivoCita: ["motivo", "motivo cita", "motivo de consulta", "tipo cita", "asunto", "tipo de atencion"],
};
const OTHER_KIND: Array<[SheetKind, string[]]> = [
  ["pagos", ["pago", "pagos", "abono", "medio de pago", "forma de pago", "monto pagado", "boleta", "fecha pago"]],
  ["presupuestos", ["presupuesto", "plan de tratamiento", "n presupuesto", "total presupuesto", "prestacion", "precio", "valor", "monto", "saldo"]],
];

/** Encabezado comparable: sin tildes, minúsculas, «N°»/«Nº»/«Nro.» → «n», sin signos. */
export function foldHeader(value: Cell): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/n\s*[°º]|nro\.?|num\./g, "n ").replace(/[^a-z0-9]+/g, " ").trim();
}

function headerScore(header: string, synonym: string): number {
  if (!header) return 0;
  if (header === synonym) return 1;
  const h = ` ${header} `, s = ` ${synonym} `;
  if (h.includes(s)) return 0.6 + 0.3 * (synonym.length / header.length);
  const ht = new Set(header.split(" ")), st = synonym.split(" ");
  const shared = st.filter(token => ht.has(token)).length;
  return shared && shared === st.length ? 0.5 : 0;
}

/** Mejor campo para un encabezado (o null). `remembered` = lo que el profesional eligió antes para ese encabezado. */
export function guessField(header: Cell, remembered: Record<string, FieldKey | ""> = {}): { field: FieldKey | null; score: number } {
  const key = foldHeader(header);
  if (key in remembered) return { field: remembered[key] || null, score: 2 };
  let best: { field: FieldKey | null; score: number } = { field: null, score: 0 };
  for (const [field, list] of Object.entries(SYNONYMS) as Array<[FieldKey, string[]]>) {
    for (const synonym of list) { const score = headerScore(key, synonym); if (score > best.score) best = { field, score }; }
  }
  return best.score >= 0.5 ? best : { field: null, score: 0 };
}

/** Mapeo automático de todas las columnas: cada campo va a una sola columna (la de mejor coincidencia). */
export function autoMap(headers: Cell[], remembered: Record<string, FieldKey | ""> = {}): Array<FieldKey | ""> {
  const guesses = headers.map(header => guessField(header, remembered));
  const result: Array<FieldKey | ""> = headers.map(() => "");
  const order = guesses.map((guess, index) => ({ ...guess, index })).filter(g => g.field).sort((a, b) => b.score - a.score || a.index - b.index);
  const taken = new Set<FieldKey>();
  for (const guess of order) { if (!taken.has(guess.field!)) { taken.add(guess.field!); result[guess.index] = guess.field!; } }
  const has = (field: FieldKey) => result.includes(field);
  // Las correcciones de abajo no tocan columnas que el usuario ya eligió antes (mapeo recordado).
  const fixable = (index: number) => index >= 0 && !(foldHeader(headers[index]) in remembered);
  // «Fecha» sola en una hoja con «Hora» y sin texto de evolución es la fecha de la cita.
  if (has("horaCita") && !has("evolucion") && !has("fechaCita")) { const i = result.indexOf("fechaAtencion"); if (fixable(i)) result[i] = "fechaCita"; }
  // «Nombre» solo, sin apellidos en otra columna, es el nombre completo.
  if (has("nombres") && !has("apellidoPaterno") && !has("apellidoMaterno") && !has("nombreCompleto") && fixable(result.indexOf("nombres"))) result[result.indexOf("nombres")] = "nombreCompleto";
  // «Motivo» sin hora de cita y sin fecha de cita: no es una agenda.
  if (has("motivoCita") && !has("horaCita") && !has("fechaCita") && fixable(result.indexOf("motivoCita"))) result[result.indexOf("motivoCita")] = "";
  return result;
}

/** Tipo de hoja según lo mapeado (y encabezados de presupuestos/pagos, que aún no se importan). */
export function detectSheetKind(headers: Cell[], mapping: Array<FieldKey | "">): SheetKind {
  const has = (field: FieldKey) => mapping.includes(field);
  if (has("evolucion")) return "evoluciones";
  if (has("horaCita") || has("fechaCita")) return "citas";
  const folded = headers.map(foldHeader);
  const patientish = has("nombreCompleto") || has("nombres") || has("apellidoPaterno");
  for (const [kind, words] of OTHER_KIND) {
    const hits = folded.filter(h => words.some(word => headerScore(h, word) >= 0.6)).length;
    if (hits >= 2 || (hits >= 1 && !patientish)) return kind;
  }
  if (patientish) return "pacientes";
  return "desconocido";
}

/** Fila de encabezados: entre las 10 primeras, la que más columnas reconoce (Dentalsoft puede traer un título arriba). */
export function findHeaderRow(rows: Cell[][]): number {
  let best = 0, bestScore = -1;
  rows.slice(0, 10).forEach((row, index) => {
    const filled = row.filter(cell => String(cell ?? "").trim()).length;
    const score = row.filter(cell => typeof cell === "string" && guessField(cell).field).length * 10 + Math.min(filled, 9);
    if (filled >= 2 && score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

// ---------- Texto: codificación y separador ----------

/** UTF-8 si es válido; si no, Latin-1 / Windows-1252 (Excel en Windows guarda así los CSV). */
export function decodeText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "latin-1" } {
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""), encoding: "utf-8" }; }
  catch { return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "latin-1" }; }
}

/** «;», «,» o tabulador: el que da un número de columnas más parejo y mayor en las primeras líneas (fuera de comillas). */
export function detectDelimiter(text: string): ";" | "," | "\t" {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 20);
  let best: ";" | "," | "\t" = ",", bestScore = -1;
  for (const delimiter of [";", ",", "\t"] as const) {
    const counts = lines.map(line => { let n = 0, quoted = false; for (const ch of line) { if (ch === '"') quoted = !quoted; else if (ch === delimiter && !quoted) n++; } return n; });
    if (!counts.length || !counts[0]) continue;
    const same = counts.filter(n => n === counts[0]).length / counts.length;
    const score = same * 100 + counts[0];
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

/** CSV con comillas, comillas dobles escapadas y saltos de línea dentro de campos. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; }
    else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some(c => c.trim())) rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field); if (row.some(c => c.trim())) rows.push(row);
  return rows;
}

// ---------- Valores ----------

/** RUT: acepta «12.345.678-5», «123456785», «12345678-k» o el cuerpo con el DV en otra columna. */
export function normalizeRut(value: Cell, dv?: Cell): { value: string; valid: boolean; empty: boolean } {
  let raw = String(value ?? "").trim();
  if (typeof value === "number") raw = String(Math.trunc(value));
  const digit = String(dv ?? "").trim();
  if (digit) raw = `${raw.replace(/-.*$/, "")}-${digit}`;
  const clean = cleanRutValue(raw);
  if (!clean) return { value: "", valid: false, empty: true };
  return { value: clean, valid: clean.length >= 2 && isValidChileanRut(clean), empty: false };
}

const realDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

/** Fecha en AAAA-MM-DD: dd-mm-aaaa, dd/mm/aaaa, dd.mm.aaaa, aaaa-mm-dd, año de 2 dígitos o número de serie de Excel. */
export function parseDateAny(value: Cell, today = new Date()): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d{4,5}(\.\d+)?$/.test(String(value).trim())) {
    const serial = Math.floor(Number(value));
    if (serial < 1 || serial > 80000) return null;
    // Excel (sistema 1900): el día 1 es 1900-01-01 e incluye el 29-02-1900 inexistente → base 1899-12-30.
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (m) return realDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/.exec(text);
  if (!m) return null;
  let year = +m[3];
  if (m[3].length === 2) { const yy = today.getUTCFullYear() % 100; year += year <= yy ? 2000 : 1900; }
  return realDate(year, +m[2], +m[1]);
}

/** Hora HH:MM desde «10:30», «10.30», «10:30:00», «9:05 hrs» o fracción de día de Excel (0,4375 = 10:30). */
export function parseTimeAny(value: Cell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const fraction = value - Math.floor(value);
    if (fraction <= 0 && value !== 0) return null;
    const minutes = Math.round(fraction * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const m = /(?:^|\s)(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(String(value).trim());
  if (!m) return null;
  let hour = +m[1]; const minute = +m[2];
  if (m[3] && /^p/i.test(m[3]) && hour < 12) hour += 12;
  if (m[3] && /^a/i.test(m[3]) && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null;
}

/** Teléfono chileno: «912345678» → «+56 9 1234 5678»; otro formato válido se deja como viene. */
export function normalizePhone(value: Cell): string {
  let raw = String(value ?? "").trim();
  if (typeof value === "number") raw = String(Math.trunc(value));
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("56") && digits.length === 11 ? digits.slice(2) : digits;
  if (local.length === 9 && local.startsWith("9")) return `+56 9 ${local.slice(1, 5)} ${local.slice(5)}`;
  if (local.length === 9) return `+56 ${local}`;
  if (local.length === 8) return `+56 9 ${local.slice(0, 4)} ${local.slice(4)}`;
  return /^[+\d()\s.-]{7,24}$/.test(raw) && digits.length >= 8 ? raw : "";
}

export const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const INSURANCE_NAMES = ["Fonasa", "Banmédica", "Colmena", "Consalud", "Cruz Blanca", "Esencial", "Nueva Masvida", "Vida Tres", "Capredena", "Dipreca", "Particular"];
/** Previsión: la de la lista de la ficha si se reconoce («FONASA B» → Fonasa); si no, «Otra» con el texto original. */
export function normalizeInsurance(value: Cell): { insurance: string; insurer: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { insurance: "", insurer: "" };
  const folded = foldHeader(raw);
  const found = INSURANCE_NAMES.find(name => folded.includes(foldHeader(name)) || (name === "Banmédica" && folded.includes("banmedica")) || (name === "Nueva Masvida" && folded.includes("masvida")));
  return found ? { insurance: found, insurer: "" } : { insurance: "Otra", insurer: raw.slice(0, 80) };
}

export function normalizeGender(value: Cell): string {
  const v = foldHeader(value);
  if (!v) return "";
  if (/^(f|fem|femenino|mujer)$/.test(v)) return "Femenino";
  if (/^(m|masc|masculino|hombre|varon)$/.test(v)) return "Masculino";
  return "Otro";
}

const tidy = (value: Cell, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const longText = (value: Cell, max: number) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);

// ---------- Filas ----------

export type RowStatus = "nuevo" | "existe" | "duplicado" | "error";
export type PatientDraft = { name: string; rut: string; birthDate: string; gender: string; phone: string; email: string; street: string; commune: string; insurance: string; insurer: string; history: string; allergies: string; ficha: string };
export type PatientRow = { line: number; status: RowStatus; data: PatientDraft; errors: string[]; warnings: string[]; duplicateOf?: number };

const pick = (row: Cell[], mapping: Array<FieldKey | "">, field: FieldKey): Cell => { const i = mapping.indexOf(field); return i >= 0 ? row[i] : ""; };

/** Fichas de pacientes con validación. `existing` = RUT (limpios) que ya tiene la cuenta. `firstLine` = n° de fila del archivo de la primera fila de datos. */
export function buildPatientRows(rows: Cell[][], mapping: Array<FieldKey | "">, existing: ReadonlySet<string>, firstLine = 2, today = new Date()): PatientRow[] {
  const seen = new Map<string, number>();
  const todayIso = today.toISOString().slice(0, 10);
  return rows.map((row, offset) => {
    const line = firstLine + offset, get = (field: FieldKey) => pick(row, mapping, field);
    const errors: string[] = [], warnings: string[] = [];
    const name = tidy(get("nombreCompleto"), 180) || [get("nombres"), get("apellidoPaterno"), get("apellidoMaterno")].map(v => tidy(v, 80)).filter(Boolean).join(" ");
    if (!name) errors.push("Sin nombre");
    const rut = normalizeRut(get("rut"), get("dv"));
    if (!rut.empty && !rut.valid) errors.push(`RUT inválido (${tidy(get("rut"), 20)}${tidy(get("dv"), 2) ? `-${tidy(get("dv"), 2)}` : ""}): dígito verificador no coincide`);
    if (rut.empty) warnings.push("Sin RUT: no se puede detectar si ya existe");
    const birthRaw = get("fechaNacimiento");
    let birthDate = parseDateAny(birthRaw, today) ?? "";
    if (String(birthRaw ?? "").trim() && !birthDate) warnings.push(`Fecha de nacimiento no reconocida (${tidy(birthRaw, 20)})`);
    if (birthDate && (birthDate > todayIso || birthDate < "1900-01-01")) { warnings.push(`Fecha de nacimiento fuera de rango (${birthDate})`); birthDate = ""; }
    const phone = normalizePhone(get("celular")) || normalizePhone(get("telefono"));
    if (!phone && (String(get("celular") ?? "").trim() || String(get("telefono") ?? "").trim())) warnings.push("Teléfono no reconocido");
    let email = tidy(get("email"), 254).toLowerCase();
    if (email && !validEmail(email)) { warnings.push(`Correo no válido (${email})`); email = ""; }
    const { insurance, insurer } = normalizeInsurance(get("prevision"));
    const ficha = tidy(get("ficha"), 40);
    const observaciones = longText(get("observaciones"), 2500);
    const data: PatientDraft = {
      name, rut: rut.valid ? rut.value : "", birthDate, gender: normalizeGender(get("sexo")), phone, email,
      street: tidy(get("direccion"), 160), commune: tidy(get("comuna"), 80), insurance, insurer,
      history: [observaciones, ficha ? `N° de ficha en el sistema anterior: ${ficha}` : ""].filter(Boolean).join("\n").slice(0, 3000),
      allergies: longText(get("alertas"), 1000), ficha,
    };
    let status: RowStatus = errors.length ? "error" : "nuevo", duplicateOf: number | undefined;
    if (status !== "error" && data.rut) {
      if (seen.has(data.rut)) { status = "duplicado"; duplicateOf = seen.get(data.rut); }
      else { seen.set(data.rut, line); if (existing.has(data.rut)) status = "existe"; }
    }
    return { line, status, data, errors, warnings, ...(duplicateOf ? { duplicateOf } : {}) };
  });
}

export type NoteDraft = { line: number; rut: string; date: string; text: string; professional: string; pieza: string; requestId: string; errors: string[] };
export type ApptDraft = { line: number; rut: string; day: string; time: string; reason: string; errors: string[] };

/** Identificador estable (dos FNV-1a de 32 bits en base 36): repetir la importación no duplica. */
export function stableKey(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const byte of new TextEncoder().encode(text)) { a = Math.imul(a ^ byte, 0x01000193) >>> 0; b = Math.imul(b ^ byte, 0x01000193 + 2) >>> 0; }
  return a.toString(36) + b.toString(36);
}

/** Evoluciones históricas: se vinculan por RUT a una ficha que ya existe o que se crea en esta importación. */
export function buildNoteRows(rows: Cell[][], mapping: Array<FieldKey | "">, knownRuts: ReadonlySet<string>, firstLine = 2, today = new Date()): NoteDraft[] {
  const todayIso = today.toISOString().slice(0, 10);
  return rows.map((row, offset) => {
    const get = (field: FieldKey) => pick(row, mapping, field), errors: string[] = [];
    const rut = normalizeRut(get("rut"), get("dv"));
    const date = parseDateAny(get("fechaAtencion"), today) ?? "";
    const text = longText(get("evolucion"), 20000);
    if (!rut.valid) errors.push(rut.empty ? "Sin RUT para vincular al paciente" : "RUT inválido");
    else if (!knownRuts.has(rut.value)) errors.push("No hay ficha con ese RUT");
    if (!date) errors.push("Fecha de atención no reconocida");
    else if (date > todayIso) errors.push("Fecha de atención futura");
    if (!text) errors.push("Evolución vacía");
    const professional = tidy(get("profesional"), 120), pieza = tidy(get("pieza"), 40);
    return { line: firstLine + offset, rut: rut.valid ? rut.value : "", date, text, professional, pieza, requestId: `impx:${stableKey(`${rut.value}|${date}|${text}`)}`, errors };
  });
}

/** Citas: fecha y hora claras, vinculadas por RUT. */
export function buildApptRows(rows: Cell[][], mapping: Array<FieldKey | "">, knownRuts: ReadonlySet<string>, firstLine = 2, today = new Date()): ApptDraft[] {
  return rows.map((row, offset) => {
    const get = (field: FieldKey) => pick(row, mapping, field), errors: string[] = [];
    const rut = normalizeRut(get("rut"), get("dv"));
    const dateCell = get("fechaCita");
    const day = parseDateAny(dateCell, today) ?? "";
    const time = parseTimeAny(get("horaCita")) ?? (typeof dateCell === "number" ? parseTimeAny(dateCell) : parseTimeAny(String(dateCell ?? "").replace(/^\S+/, ""))) ?? "";
    if (!rut.valid) errors.push(rut.empty ? "Sin RUT para vincular al paciente" : "RUT inválido");
    else if (!knownRuts.has(rut.value)) errors.push("No hay ficha con ese RUT");
    if (!day) errors.push("Fecha de la cita no reconocida");
    if (!time) errors.push("Hora de la cita no reconocida");
    return { line: firstLine + offset, rut: rut.valid ? rut.value : "", day, time, reason: tidy(get("motivoCita"), 150) || "Cita importada", errors };
  });
}

/** Texto de la evolución importada (se guarda tal cual, con su origen). */
export function importedEvolutionBody(note: Pick<NoteDraft, "text" | "professional" | "pieza">, source: string): string {
  const meta = [`Importada desde ${source}`, note.professional ? `Profesional: ${note.professional}` : "", note.pieza ? `Pieza: ${note.pieza}` : ""].filter(Boolean).join(" · ");
  return `${meta}\n\n${note.text}`;
}

export type RejectedRow = { file: string; sheet: string; line: number; reason: string; cells: Array<[string, Cell]> };
/** CSV para Excel (separador «;», BOM UTF-8): archivo, hoja, fila, motivo y los datos originales de cada fila rechazada. */
export function rejectedCsv(rows: RejectedRow[]): string {
  const esc = (value: Cell) => { const text = String(value ?? ""); return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const columns: string[] = [];
  for (const row of rows) for (const [header] of row.cells) if (header && !columns.includes(header)) columns.push(header);
  const lines = [["Archivo", "Hoja", "Fila", "Motivo del rechazo", ...columns], ...rows.map(row => {
    const byHeader = new Map(row.cells);
    return [row.file, row.sheet, row.line, row.reason, ...columns.map(column => byHeader.get(column) ?? "")];
  })];
  return "\uFEFF" + lines.map(line => line.map(esc).join(";")).join("\r\n") + "\r\n";
}

export const KIND_LABEL: Record<SheetKind, string> = { pacientes: "Pacientes", evoluciones: "Evoluciones / notas", citas: "Citas (agenda)", presupuestos: "Presupuestos", pagos: "Pagos", desconocido: "No reconocida" };
