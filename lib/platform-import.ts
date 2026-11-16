import { universalToFdi, chileToFdi } from "./dictation/proposal.ts";
import { cleanForeignDocument, cleanRutValue, isValidChileanRut, isValidForeignDocument } from "./patient-document.ts";
import { zoneLabel, zoneTeeth } from "./treatment-zones.ts";
import type { BudgetItem } from "./budget-plans.ts";

/**
 * Importación desde otra plataforma (exportación en CSV): pacientes, planes de tratamiento, evoluciones, pagos y aranceles.
 * Funciones puras: leen y convierten; nada se guarda aquí. Lo que no se puede convertir con seguridad se informa, no se inventa.
 */
export type CsvKind = "pacientes" | "planes" | "tratamientos" | "evoluciones" | "pagos" | "aranceles";
export type Numbering = "universal" | "chile";
export type Row = Record<string, string>;

/** CSV con comillas, saltos de línea dentro de campos, BOM y separador «,» o «;». */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = first.split(";").length > first.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some(cell => cell !== "")) rows.push(row); row = []; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some(cell => cell !== "")) rows.push(row); }
  return rows;
}

export function toRecords(rows: string[][]): Row[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const names = header.map(name => name.trim());
  return body.map(cells => Object.fromEntries(names.map((name, i) => [name, (cells[i] ?? "").trim()])));
}

/** Qué tabla es un archivo, según sus encabezados. */
export function detectKind(header: string[]): CsvKind | null {
  const has = (...names: string[]) => names.every(name => header.includes(name));
  if (has("Número Plan de tratamiento", "Tratamiento", "Precio Original")) return "tratamientos";
  if (has("Número Plan de tratamiento", "Método de Pago")) return "pagos";
  if (has("Número Plan de tratamiento", "Estado", "Total")) return "planes";
  if (has("Evolución", "Fecha Evolución")) return "evoluciones";
  if (has("DNI", "Nombre", "Apellido")) return "pacientes";
  if (has("Nombre", "Categoría", "Monto")) return "aranceles";
  return null;
}

export const parseMoney = (value: string): number => Number(value.replace(/[^\d]/g, "")) || 0;

/** «16/11/2026» → «2026-11-16»; null si no es una fecha real. */
export function parseDmy(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(value.trim()) ? value.trim().slice(0, 10) : null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Documento guardable: RUT válido, o documento extranjero válido; si no, null (no se inventa). */
export function importedDocument(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isValidChileanRut(value)) return cleanRutValue(value);
  const foreign = cleanForeignDocument(value);
  return isValidForeignDocument(foreign) ? foreign : null;
}

/** Clave para unir pacientes entre archivos: documento limpio o, si no hay, el nombre. */
export const patientKey = (dni: string, name: string) => {
  const doc = dni.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return doc ? `d:${doc}` : `n:${fold(name)}`;
};

export type ZoneResult = { zone?: string; teeth: number[]; text: string; unknown: string[] };

/** Sextantes de la otra plataforma (1–5, 6–11, 12–16, 17–21, 22–27, 28–32 en numeración Universal) → los de esta app (EPB MINSAL). */
const SEXTANT_MAP: Record<string, string> = { "1": "sext-1", "2": "sext-2", "3": "sext-3", "4": "sext-6", "5": "sext-5", "6": "sext-4" };
/** Dentición temporal en letras (Universal A–T) → FDI. */
const PRIMARY_LETTERS: Record<string, number> = { A: 55, B: 54, C: 53, D: 52, E: 51, F: 61, G: 62, H: 63, I: 64, J: 65, K: 75, L: 74, M: 73, N: 72, O: 71, P: 81, Q: 82, R: 83, S: 84, T: 85 };

/** Zona con nombre («Boca completa», «ARCADA_SUPERIOR», «Cuadrante 2», «Sextante Grupo 4»), o null si es otra cosa. */
function namedZone(text: string): string | null {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_]+/g, " ").trim();
  if (t === "boca completa") return "perm:boca";
  if (t === "denticion temporal completa") return "temp:boca";
  if (t === "denticion permanente completa") return "perm:boca";
  if (t === "arcada superior") return "perm:arc-sup";
  if (t === "arcada inferior") return "perm:arc-inf";
  const quad = /^cuadrante (?:grupo )?([1-4])$/.exec(t);
  if (quad) return `perm:cuad-${quad[1]}`;
  const sext = /^sextante (?:grupo )?([1-6])$/.exec(t);
  return sext ? `perm:${SEXTANT_MAP[sext[1]]}` : null;
}

/** Zona de la otra plataforma → zona/piezas FDI. Los números 1–32 exigen saber la numeración del archivo; las letras de la dentición temporal no. */
export function parseZone(raw: string, numbering: Numbering | null): ZoneResult {
  const text = raw.trim();
  if (!text) return { teeth: [], text: "", unknown: [] };
  const named = namedZone(text);
  if (named) return { zone: named, teeth: zoneTeeth(named), text: zoneLabel(named), unknown: [] };
  const teeth: number[] = [], unknown: string[] = [], labels: string[] = [];
  for (const part of text.split(/[,;]+/).map(p => p.trim()).filter(Boolean)) {
    const zone = namedZone(part);
    if (zone) { teeth.push(...zoneTeeth(zone)); labels.push(zoneLabel(zone)); continue; }
    const n = /^\d+$/.test(part) ? Number(part) : NaN;
    const fdi = PRIMARY_LETTERS[part.toUpperCase()] ?? (Number.isNaN(n) || !numbering ? null : numbering === "chile" ? chileToFdi(n) : universalToFdi(n));
    if (fdi) teeth.push(fdi); else unknown.push(part);
  }
  const unique = [...new Set(teeth)].sort((a, b) => a - b);
  return { teeth: unique, text: labels.length ? labels.join(" + ") : unique.map(t => `${Math.floor(t / 10)}.${t % 10}`).join(", "), unknown };
}

/** Zona numérica más frecuente de los tratamientos, para mostrar cómo se leería con cada numeración. */
export function commonZoneNumber(rows: Row[], minimum = 1): number | null {
  const counts = new Map<number, number>();
  for (const row of rows) for (const part of (row.Zona ?? "").split(/[,;]+/)) { const n = /^\s*\d+\s*$/.test(part) ? Number(part) : NaN; if (n >= minimum && n <= 32) counts.set(n, (counts.get(n) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
export const needsNumbering = (tables: Partial<Record<CsvKind, Row[]>>) =>
  [...(tables.tratamientos ?? []), ...(tables.evoluciones ?? [])].some(row => (row.Zona ?? "").split(/[,;]+/).some(part => /^\s*\d+\s*$/.test(part)));

export type ImportPatient = { key: string; name: string; document: string | null; documentRaw: string; birthDate: string; phone: string; email: string; street: string; commune: string; sex: string };
export type ImportItem = BudgetItem;
export type ImportPlan = { number: string; title: string; createdOn: string; status: string; items: ImportItem[]; paid: number };
export type ImportNote = { date: string; recordedOn: string; professional: string; zoneText: string; text: string; requestId: string };
export type ImportPayment = { plan: string; amount: number; method: string; concept: string; paidOn: string; requestId: string };
export type ImportBundle = { patient: ImportPatient; plans: ImportPlan[]; notes: ImportNote[]; payments: ImportPayment[] };
export type ImportTariff = { name: string; specialty: string; price: number };
export type ImportResultSet = { bundles: ImportBundle[]; tariffs: ImportTariff[]; warnings: string[]; totals: Record<string, number> };

const METHOD: Record<string, string> = { efectivo: "efectivo", "tarjeta de debito": "debito", "tarjeta de credito": "credito", transferencia: "transferencia" };
const SPECIALTY: Record<string, string> = { odontopediatria: "odontopediatria", "protesis fija": "protesis-fija", "protesis removible": "protesis-removible", cirugia: "cirugia", ortodoncia: "ortodoncia", operatoria: "operatoria", estetica: "estetica", implantologia: "implantologia", periodoncia: "periodoncia", endodoncia: "endodoncia", preventiva: "preventiva", radiologia: "radiologia", ttm: "ttm" };
const STATUS: Record<string, string> = { inactivo: "Importado · inactivo", "en progreso": "Importado · en progreso", finalizado: "Importado · finalizado" };

/** Identificador estable (53 bits) para no duplicar al repetir la importación. */
export function stableId(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const MAX_ITEMS = 30;

export function buildImport(tables: Partial<Record<CsvKind, Row[]>>, numbering: Numbering | null): ImportResultSet {
  const warnings: string[] = [];
  const bundles = new Map<string, ImportBundle>();
  let duplicatedPatients = 0, patientsWithoutDocument = 0, invalidDocuments = 0;

  const ensurePatient = (dni: string, name: string): ImportBundle => {
    const key = patientKey(dni, name);
    let bundle = bundles.get(key);
    if (!bundle) {
      bundle = { patient: { key, name: name.trim().replace(/\s+/g, " "), document: importedDocument(dni), documentRaw: dni.trim(), birthDate: "", phone: "", email: "", street: "", commune: "", sex: "" }, plans: [], notes: [], payments: [] };
      bundles.set(key, bundle);
    }
    return bundle;
  };

  for (const row of tables.pacientes ?? []) {
    const name = `${row.Nombre ?? ""} ${row.Apellido ?? ""}`.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = patientKey(row.DNI ?? "", name);
    if (bundles.has(key)) { duplicatedPatients++; continue; }
    const bundle = ensurePatient(row.DNI ?? "", name);
    const p = bundle.patient;
    p.birthDate = /^\d{4}-\d{2}-\d{2}$/.test(row["Fecha de Nacimiento"] ?? "") ? row["Fecha de Nacimiento"] : parseDmy(row["Fecha de Nacimiento"] ?? "") ?? "";
    // La otra plataforma deja el celular casi siempre en «Teléfono 2»: se usa el 1 y, si está vacío, el 2.
    p.phone = ((row["Teléfono 1"] ?? "").trim() || (row["Teléfono 2"] ?? "").trim()).replace(/[^\d+]/g, "").replace(/^\+-/, "+").slice(0, 24);
    p.email = (row.Email ?? "").trim().toLowerCase();
    p.street = (row["Dirección"] ?? "").trim(); p.commune = (row.Ciudad ?? "").trim(); p.sex = row.Sexo ?? "";
    if (!(row.DNI ?? "").trim()) patientsWithoutDocument++; else if (!p.document) invalidDocuments++;
  }

  // Planes y sus tratamientos
  const itemsByPlan = new Map<string, Row[]>();
  for (const row of tables.tratamientos ?? []) {
    const key = patientKey(row["DNI Paciente"] ?? "", row["Nombre Paciente"] ?? "") + "|" + (row["Número Plan de tratamiento"] ?? "");
    (itemsByPlan.get(key) ?? itemsByPlan.set(key, []).get(key)!).push(row);
  }
  let duplicatePlans = 0, emptyPlans = 0, plansWithObservations = 0, unconvertedZones = 0, inexactDiscounts = 0, sextantZones = 0, splitPlans = 0, itemsSkipped = 0, missingPatients = 0;
  const planRowsByKey = new Map<string, Row>();
  for (const row of tables.planes ?? []) {
    const pKey = patientKey(row["DNI Paciente"] ?? "", row["Nombre Paciente"] ?? "");
    if (!bundles.has(pKey)) { missingPatients++; }
    const bundle = ensurePatient(row["DNI Paciente"] ?? "", row["Nombre Paciente"] ?? "");
    const number = row["Número Plan de tratamiento"] ?? "";
    if (planRowsByKey.has(pKey + "|" + number)) { duplicatePlans++; continue; }
    planRowsByKey.set(pKey + "|" + number, row);
    const rows = itemsByPlan.get(pKey + "|" + number) ?? [];
    const createdOn = parseDmy(row["Fecha Creación"] ?? "") ?? new Date().toISOString().slice(0, 10);
    const items: ImportItem[] = [];
    for (const r of rows) {
      const original = parseMoney(r["Precio Original"] ?? ""), qty = Math.max(1, Number(r["Cantidad Zonas"]) || 1), discount = parseMoney(r.Descuento ?? "");
      const gross = original * qty, net = parseMoney(r["Total Item"] ?? "") || Math.max(0, gross - discount);
      if (net < 1 || !r.Tratamiento) { itemsSkipped++; continue; }
      const pct = gross > 0 ? Math.round(discount / gross * 100) : 0;
      const exact = discount === 0 || Math.round(gross * pct / 100) === discount;
      if (!exact) inexactDiscounts++;
      const zone = parseZone(r.Zona ?? "", numbering);
      if (zone.unknown.length) unconvertedZones++;
      if (/sextante/i.test(r.Zona ?? "")) sextantZones++;
      const doneOn = /finalizado/i.test(r.Estado ?? "") ? parseDmy(r["Fecha Creación"] ?? "") ?? undefined : undefined;
      items.push({
        label: r.Tratamiento.slice(0, 180), amount: exact ? gross : net, ...(exact && pct ? { discountPercent: pct } : {}),
        ...(zone.zone ? { zone: zone.zone } : {}), ...(zone.teeth.length ? { teeth: zone.teeth } : {}), ...(doneOn ? { doneOn } : {}),
      });
    }
    if (!items.length) { emptyPlans++; continue; }
    const obs = (row.Observaciones ?? "").trim().replace(/\s+/g, " ");
    if (obs) plansWithObservations++;
    const baseTitle = `Plan ${number} (importado)`;
    const parts = Math.ceil(items.length / MAX_ITEMS);
    if (parts > 1) splitPlans++;
    for (let part = 0; part < parts; part++) {
      const title = (parts > 1 ? `${baseTitle} · parte ${part + 1}` : baseTitle) + (obs && part === 0 ? ` · ${obs}` : "");
      bundle.plans.push({ number: parts > 1 ? `${number}.${part + 1}` : number, title: title.slice(0, 120), createdOn, status: STATUS[(row.Estado ?? "").toLowerCase()] ?? "Importado", items: items.slice(part * MAX_ITEMS, (part + 1) * MAX_ITEMS), paid: parseMoney(row["Total Pagado"] ?? "") });
    }
  }

  // Evoluciones (texto íntegro; no se interpreta ni se convierte en diagnóstico)
  const seen = new Map<string, number>();
  let notesWithoutDate = 0;
  for (const row of tables.evoluciones ?? []) {
    const rawText = (row["Evolución"] ?? "").trim(), text = plainNoteText(rawText);
    if (!text) continue;
    const date = parseDmy(row["Fecha Evolución"] ?? "") ?? parseDmy(row["Fecha de Creación"] ?? "");
    if (!date) { notesWithoutDate++; continue; }
    const bundle = ensurePatient(row["DNI Paciente"] ?? "", row["Nombre Paciente"] ?? "");
    const zone = parseZone(row.Zona ?? "", numbering);
    const base = `${bundle.patient.key}|${date}|${rawText}`; // el id se calcula con el texto original: no cambia aunque mejore la limpieza
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    bundle.notes.push({ date, recordedOn: parseDmy(row["Fecha de Creación"] ?? "") ?? date, professional: (row.Profesional ?? "").trim(), zoneText: zone.text, text, requestId: `imp:ev:${stableId(base + "|" + n)}` });
  }

  // Pagos
  const paySeen = new Map<string, number>();
  let paymentsSkipped = 0;
  for (const row of tables.pagos ?? []) {
    const amount = parseMoney(row.Monto ?? ""), paidOn = parseDmy(row["Fecha Pago"] ?? "");
    if (amount < 1 || !paidOn) { paymentsSkipped++; continue; }
    const bundle = ensurePatient(row["DNI Paciente"] ?? "", row["Nombre Paciente"] ?? "");
    const method = METHOD[fold(row["Método de Pago"] ?? "")] ?? "otro";
    const detail = [row["Método de Pago"], row["Cuotas"] ? `${row["Cuotas"]} cuotas` : "", row["Observación"]].map(v => (v ?? "").trim()).filter(Boolean);
    const plan = row["Número Plan de tratamiento"] ?? "";
    const base = `${bundle.patient.key}|${plan}|${paidOn}|${amount}|${row["Número Documento"] ?? ""}`;
    const n = (paySeen.get(base) ?? 0) + 1; paySeen.set(base, n);
    bundle.payments.push({ plan, amount, method, concept: `Importado · plan ${plan}${detail.length ? " · " + detail.join(" · ") : ""}`.slice(0, 200), paidOn, requestId: `imp:pay:${stableId(base + "|" + n)}` });
  }

  const tariffs: ImportTariff[] = [];
  const tariffSeen = new Set<string>();
  for (const row of tables.aranceles ?? []) {
    const name = (row.Nombre ?? "").replace(/\s+/g, " ").trim(), price = parseMoney(row.Monto ?? "");
    if (name.length < 3 || name.length > 120) continue;
    const specialty = SPECIALTY[fold(row["Categoría"] ?? "")] ?? "general";
    const k = `${specialty}|${name.toLowerCase()}`;
    if (tariffSeen.has(k)) continue;
    tariffSeen.add(k);
    tariffs.push({ name, specialty, price });
  }

  const list = [...bundles.values()];
  if (duplicatedPatients) warnings.push(`${duplicatedPatients} filas de pacientes repetían un documento o nombre y se unificaron en una sola ficha.`);
  if (patientsWithoutDocument) warnings.push(`${patientsWithoutDocument} pacientes no traen documento de identidad: se reconocen por nombre y quedan sin documento.`);
  if (invalidDocuments) warnings.push(`${invalidDocuments} pacientes traen un documento que no es un RUT válido ni un documento extranjero reconocible; se importan sin documento.`);
  if (missingPatients) warnings.push(`${missingPatients} planes no tenían su paciente en el archivo de pacientes; se creó la ficha con el nombre del plan.`);
  if (duplicatePlans) warnings.push(`${duplicatePlans} planes repetían el número de otro plan del mismo paciente; sus tratamientos quedaron en el primero.`);
  if (emptyPlans) warnings.push(`${emptyPlans} planes no tenían tratamientos y no se importaron.`);
  if (plansWithObservations) warnings.push(`${plansWithObservations} planes traían observaciones; se agregaron al título del plan.`);
  if (inexactDiscounts) warnings.push(`${inexactDiscounts} tratamientos tenían un descuento que no equivale a un porcentaje exacto; se importaron con el valor ya descontado.`);
  if (unconvertedZones) warnings.push(`${unconvertedZones} tratamientos tienen una zona que no se pudo convertir a piezas (sin numeración elegida o valor desconocido); quedan sin piezas.`);
  if (sextantZones) warnings.push(`${sextantZones} tratamientos usan «Sextante Grupo N»: se leyeron como 1–3 arcada superior (de derecha a izquierda) y 4–6 arcada inferior (de izquierda a derecha). Revísalos.`);
  if (splitPlans) warnings.push(`${splitPlans} planes tenían más de ${MAX_ITEMS} tratamientos y se dividieron en partes.`);
  if (itemsSkipped) warnings.push(`${itemsSkipped} tratamientos sin nombre o sin valor no se importaron.`);
  if (paymentsSkipped) warnings.push(`${paymentsSkipped} pagos sin monto o sin fecha válida no se importaron.`);
  if (notesWithoutDate) warnings.push(`${notesWithoutDate} evoluciones sin fecha válida no se importaron.`);
  const sum = (pick: (b: ImportBundle) => number) => list.reduce((total, b) => total + pick(b), 0);
  return {
    bundles: list, tariffs, warnings,
    totals: { pacientes: list.length, planes: sum(b => b.plans.length), tratamientos: sum(b => b.plans.reduce((n, p) => n + p.items.length, 0)), evoluciones: sum(b => b.notes.length), pagos: sum(b => b.payments.length), aranceles: tariffs.length },
  };
}

type Json = unknown;
const asArray = (value: Json): Json[] => (Array.isArray(value) ? value : []);
const asRecord = (value: Json): Record<string, Json> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : {});

/** Editor de texto enriquecido tipo ProseMirror/TipTap ({"type":"doc",…}) → texto con saltos de línea. */
function proseMirrorText(node: Json): string {
  const n = asRecord(node), type = String(n.type ?? "");
  if (type === "text") return String(n.text ?? "");
  if (type === "hardBreak") return "\n";
  const children = asArray(n.content);
  if (type === "listItem") return "• " + children.map(proseMirrorText).join("\n").replace(/\n/g, "\n  ");
  const inner = children.map(proseMirrorText);
  return type === "doc" || type === "bulletList" || type === "orderedList" ? inner.join("\n") : inner.join("");
}

/** Editor tipo Quill ({"ops":[{"insert":"texto\n"}]}) → texto; las viñetas de lista quedan como «• ». */
function deltaText(ops: Json[]): string {
  const lines: string[] = [];
  let line = "";
  for (const raw of ops) {
    const op = asRecord(raw), insert = typeof op.insert === "string" ? op.insert : "", attrs = asRecord(op.attributes);
    const parts = insert.split("\n");
    parts.forEach((part, index) => {
      line += part;
      if (index < parts.length - 1) { lines.push((attrs.list === "bullet" || attrs.list === "ordered" ? "• " : "") + line); line = ""; }
    });
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Texto legible de una evolución exportada: la otra plataforma la guarda a veces como JSON del editor
 * (con llaves, comillas y «\n» escritos). Se deja solo el texto del clínico, con sus saltos de línea y sin símbolos de formato.
 */
export function plainNoteText(raw: string): string {
  let text = raw.trim();
  if (/^[{[]/.test(text)) {
    try {
      const data = JSON.parse(text) as Json;
      const record = asRecord(data);
      if (record.type === "doc") text = proseMirrorText(data);
      else if (Array.isArray(record.ops)) text = deltaText(record.ops);
      else if (Array.isArray(data) && data.every(item => typeof item === "string")) text = (data as string[]).join("\n");
    } catch { /* no era JSON: se deja el texto tal cual */ }
  }
  return text
    .replace(/\r\n?/g, "\n").replace(/\\n/g, "\n")
    .replace(/_{4,}/g, "").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1").replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t\u00a0]+\n/g, "\n").replace(/[ \t\u00a0]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Texto de la evolución importada: el original íntegro más una línea de procedencia. */
export function importedNoteBody(note: ImportNote): string {
  const source = ["Importada desde la plataforma anterior", note.professional ? `profesional: ${note.professional}` : "", note.zoneText ? `zona: ${note.zoneText}` : ""].filter(Boolean).join(" · ");
  return `${note.text}\n\n— ${source}.`;
}

/** Reparte las fichas en grupos pequeños (≤ maxBundles fichas y ≤ maxRows filas por grupo) para enviarlas de a poco. Una ficha muy grande va sola, partida si hace falta. */
export function chunkBundles(bundles: ImportBundle[], maxBundles = 4, maxRows = 150): ImportBundle[][] {
  const pieces: ImportBundle[] = [];
  for (const bundle of bundles) {
    const rows = bundle.plans.length + bundle.notes.length + bundle.payments.length;
    if (rows <= maxRows) { pieces.push(bundle); continue; }
    // Se parte en trozos: los planes primero (los pagos se vinculan por número de plan al importar el trozo que los trae).
    const parts: ImportBundle[] = [];
    const take = <T,>(list: T[], size: number) => { const out: T[][] = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
    parts.push({ patient: bundle.patient, plans: bundle.plans, notes: [], payments: bundle.payments });
    for (const notes of take(bundle.notes, maxRows)) parts.push({ patient: bundle.patient, plans: [], notes, payments: [] });
    pieces.push(...parts);
  }
  const chunks: ImportBundle[][] = [];
  let current: ImportBundle[] = [], rows = 0;
  for (const piece of pieces) {
    const size = piece.plans.length + piece.notes.length + piece.payments.length;
    if (current.length && (current.length >= maxBundles || rows + size > maxRows)) { chunks.push(current); current = []; rows = 0; }
    current.push(piece); rows += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
