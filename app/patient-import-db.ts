import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { appointments, evolutions, patients } from "@/db/schema";
import { loadAddresses, saveAddress } from "@/app/patient-address-db";
import { loadProfiles, saveProfile } from "@/app/patient-profile-db";
import { emptyProfile } from "@/lib/patient-profile";
import { foldHeader, importedEvolutionBody, normalizeRut, parseDateAny, parseTimeAny, validEmail, type FieldKey, type PatientDraft } from "@/lib/patient-import";

/**
 * Importación de pacientes (Dentalsoft u otro sistema). Todo filtrado por owner_id.
 * Las filas llegan ya leídas desde el navegador; aquí se vuelven a validar y se guardan solo al confirmar.
 */
export const IMPORT_REASON_GENERIC = "Importado (Dentalsoft u otro sistema)";
export const IMPORT_SOURCE = "Dentalsoft u otro sistema";
export const MAX_ROWS = 150;

export type Outcome = { line: number; outcome: "creado" | "actualizado" | "omitido" | "error"; detail?: string };

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type RawDb = { prepare(sql: string): Stmt };
const raw = () => (env as unknown as { DB?: RawDb }).DB;

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const long = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const iso = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateAny(value) === value ? value : "");
const phoneOk = (value: string) => /^[+\d()\s.-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 8;
const empty = (value: string | null | undefined) => !value || !value.trim() || value.trim() === "Sin registrar";
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** RUT (limpios) de la cuenta, para marcar en la vista previa los que ya existen. */
export async function existingRuts(ownerId: string): Promise<string[]> {
  const rows = await getDb().select({ rut: patients.rut }).from(patients).where(eq(patients.ownerId, ownerId));
  return rows.map(row => row.rut ?? "").filter(Boolean);
}

/** Paciente validado de nuevo en el servidor (no se confía en el navegador). */
function cleanDraft(input: unknown): (PatientDraft & { rutOk: boolean }) | null {
  const d = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = str(d.name, 180);
  if (!name) return null;
  const rut = normalizeRut(str(d.rut, 20));
  if (!rut.empty && !rut.valid) return null;
  const today = new Date().toISOString().slice(0, 10);
  const birthDate = iso(d.birthDate);
  const phone = str(d.phone, 24), email = str(d.email, 254).toLowerCase();
  return {
    name, rut: rut.valid ? rut.value : "", rutOk: rut.valid, birthDate: birthDate && birthDate <= today ? birthDate : "",
    gender: str(d.gender, 20), phone: phoneOk(phone) ? phone : "", email: validEmail(email) ? email : "",
    street: str(d.street, 160), commune: str(d.commune, 80), insurance: str(d.insurance, 40), insurer: str(d.insurer, 80),
    history: long(d.history, 3000), allergies: long(d.allergies, 1000), ficha: str(d.ficha, 40),
  };
}

export async function importPatients(ownerId: string, rows: unknown[], mode: "omitir" | "completar"): Promise<Outcome[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const out: Outcome[] = [];
  const profiles = await loadProfiles(ownerId), addresses = await loadAddresses(ownerId);
  for (const item of rows) {
    const line = Number((item as { line?: unknown })?.line) || 0;
    const draft = cleanDraft((item as { data?: unknown })?.data);
    if (!draft) { out.push({ line, outcome: "error", detail: "Fila sin nombre o con RUT inválido" }); continue; }
    try {
      let found: typeof patients.$inferSelect | undefined;
      if (draft.rut) [found] = await db.select().from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, draft.rut))).limit(1);
      else {
        // Sin RUT: una ficha importada antes con el mismo nombre se considera la misma (repetir no duplica).
        const same = await db.select().from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.reason, IMPORT_REASON_GENERIC)));
        found = same.find(p => fold(p.name) === fold(draft.name));
      }
      if (found) {
        if (mode === "omitir") { out.push({ line, outcome: "omitido", detail: "Ya existe (se omitió)" }); continue; }
        const fill: Partial<typeof patients.$inferInsert> = {};
        if (!found.phone && draft.phone) fill.phone = draft.phone;
        if (!found.email && draft.email) fill.email = draft.email;
        if (!found.birthDate && draft.birthDate) fill.birthDate = draft.birthDate;
        if (empty(found.history) && draft.history) fill.history = draft.history;
        if (empty(found.allergies) && draft.allergies) fill.allergies = draft.allergies;
        let changed = Object.keys(fill).length > 0;
        if (changed) await db.update(patients).set({ ...fill, updatedAt: now }).where(and(eq(patients.id, found.id), eq(patients.ownerId, ownerId)));
        const profile = profiles.get(found.id) ?? emptyProfile();
        const profileFill: Record<string, string> = {};
        if (!profile.gender && draft.gender) profileFill.gender = draft.gender;
        if (!profile.insurance && draft.insurance) { profileFill.insurance = draft.insurance; if (draft.insurer) profileFill.insurer = draft.insurer; }
        if (Object.keys(profileFill).length) { await saveProfile(ownerId, found.id, { ...profile, ...profileFill }); changed = true; }
        const address = addresses.get(found.id);
        if ((!address || (!address.street && !address.commune)) && (draft.street || draft.commune)) { await saveAddress(ownerId, found.id, { street: draft.street, commune: draft.commune, country: "Chile" }); changed = true; }
        out.push(changed ? { line, outcome: "actualizado" } : { line, outcome: "omitido", detail: "Ya existe y no tenía campos vacíos que completar" });
        continue;
      }
      const [created] = await db.insert(patients).values({
        ownerId, name: draft.name, birthDate: draft.birthDate, rut: draft.rut || null, phone: draft.phone, email: draft.email,
        reason: IMPORT_REASON_GENERIC, status: "Evaluación", allergies: draft.allergies || "Sin registrar", history: draft.history || "Sin registrar",
        createdAt: now, updatedAt: now,
      }).returning({ id: patients.id });
      if (draft.gender || draft.insurance) await saveProfile(ownerId, created.id, { ...emptyProfile(), gender: draft.gender, insurance: draft.insurance, insurer: draft.insurer }).catch(() => null);
      if (draft.street || draft.commune) await saveAddress(ownerId, created.id, { street: draft.street, commune: draft.commune, country: "Chile" }).catch(() => null);
      out.push({ line, outcome: "creado" });
    } catch { out.push({ line, outcome: "error", detail: "No se pudo guardar esta ficha" }); }
  }
  return out;
}

async function patientIdsByRut(ownerId: string, ruts: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ruts.filter(Boolean))];
  const map = new Map<string, number>();
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await getDb().select({ id: patients.id, rut: patients.rut }).from(patients).where(and(eq(patients.ownerId, ownerId), inArray(patients.rut, unique.slice(i, i + 90))));
    for (const row of rows) if (row.rut) map.set(row.rut, row.id);
  }
  return map;
}

/** Evoluciones históricas por RUT; el requestId estable evita duplicarlas al repetir. */
export async function importNotes(ownerId: string, rows: unknown[]): Promise<Outcome[]> {
  const db = getDb(), now = new Date().toISOString(), today = now.slice(0, 10);
  const list = rows.map(item => (item && typeof item === "object" ? item : {}) as Record<string, unknown>);
  const ids = await patientIdsByRut(ownerId, list.map(r => normalizeRut(str(r.rut, 20)).value));
  const out: Outcome[] = [];
  for (const r of list) {
    const line = Number(r.line) || 0, rut = normalizeRut(str(r.rut, 20)).value, date = iso(r.date), text = long(r.text, 20000);
    const requestId = /^impx:[0-9a-z]{1,16}$/.test(String(r.requestId)) ? String(r.requestId) : "";
    const patientId = ids.get(rut);
    if (!patientId) { out.push({ line, outcome: "error", detail: "No hay ficha con ese RUT" }); continue; }
    if (!date || date > today || !text || !requestId) { out.push({ line, outcome: "error", detail: "Fecha o texto no válidos" }); continue; }
    try {
      const [dup] = await db.select({ id: evolutions.id }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.requestId, requestId))).limit(1);
      if (dup) { out.push({ line, outcome: "omitido", detail: "Ya importada antes" }); continue; }
      await db.insert(evolutions).values({
        ownerId, patientId, clinicalDate: date, recordedAt: now, title: "Evolución importada",
        body: importedEvolutionBody({ text, professional: str(r.professional, 120), pieza: str(r.pieza, 40) }, IMPORT_SOURCE), requestId, backupStatus: "not_configured",
      });
      out.push({ line, outcome: "creado" });
    } catch { out.push({ line, outcome: "error", detail: "No se pudo guardar esta evolución" }); }
  }
  return out;
}

/** Citas por RUT, sin duplicar (mismo paciente, día y hora). No se escriben en Google Calendar. */
export async function importAppointments(ownerId: string, rows: unknown[]): Promise<Outcome[]> {
  const db = getDb(), now = new Date().toISOString();
  const list = rows.map(item => (item && typeof item === "object" ? item : {}) as Record<string, unknown>);
  const ids = await patientIdsByRut(ownerId, list.map(r => normalizeRut(str(r.rut, 20)).value));
  const out: Outcome[] = [];
  for (const r of list) {
    const line = Number(r.line) || 0, rut = normalizeRut(str(r.rut, 20)).value, day = iso(r.day), time = parseTimeAny(str(r.time, 8)) ?? "";
    const patientId = ids.get(rut);
    if (!patientId) { out.push({ line, outcome: "error", detail: "No hay ficha con ese RUT" }); continue; }
    if (!day || !time) { out.push({ line, outcome: "error", detail: "Fecha u hora no válidas" }); continue; }
    try {
      const [dup] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.ownerId, ownerId), eq(appointments.patientId, patientId), eq(appointments.day, day), eq(appointments.time, time))).limit(1);
      if (dup) { out.push({ line, outcome: "omitido", detail: "La cita ya estaba en la agenda" }); continue; }
      await db.insert(appointments).values({ ownerId, patientId, day, time, reason: str(r.reason, 150) || "Cita importada", createdAt: now });
      out.push({ line, outcome: "creado" });
    } catch { out.push({ line, outcome: "error", detail: "No se pudo guardar esta cita" }); }
  }
  return out;
}

// ---------- Mapeo recordado por cuenta ----------
async function ensureMappings(db: RawDb) {
  await db.prepare("CREATE TABLE IF NOT EXISTS import_header_mappings (owner_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)").run();
}
const FIELD_RE = /^[a-zA-Z]{2,20}$/;
export async function loadMapping(ownerId: string): Promise<Record<string, FieldKey | "">> {
  const db = raw();
  if (!db) return {};
  try {
    await ensureMappings(db);
    const { results } = await db.prepare("SELECT data FROM import_header_mappings WHERE owner_id = ?").bind(ownerId).all<{ data: string }>();
    const parsed = results[0] ? JSON.parse(results[0].data) as Record<string, string> : {};
    return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => typeof k === "string" && k.length <= 80 && (v === "" || FIELD_RE.test(v)))) as Record<string, FieldKey | "">;
  } catch { return {}; }
}
export async function saveMapping(ownerId: string, input: unknown): Promise<void> {
  const db = raw();
  if (!db || !input || typeof input !== "object") return;
  const current = await loadMapping(ownerId);
  for (const [header, field] of Object.entries(input as Record<string, unknown>).slice(0, 200)) {
    const key = foldHeader(header).slice(0, 80);
    if (key && (field === "" || (typeof field === "string" && FIELD_RE.test(field)))) current[key] = field as FieldKey | "";
  }
  const entries = Object.entries(current).slice(-400);
  await ensureMappings(db);
  await db.prepare("INSERT INTO import_header_mappings (owner_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(ownerId, JSON.stringify(Object.fromEntries(entries)), new Date().toISOString()).run();
}
