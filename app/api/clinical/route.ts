import { and, desc, eq, ne, sql } from "drizzle-orm";
import { ALL_TOOTH_STATUSES, applyStatusToChart, isLesionStatus, pruneChartExtras, removeLesionFromChart } from "@/lib/tooth-status";
import { isCariesDepth } from "@/lib/caries";
import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf, spaceRoleOf, type ChatGPTUser } from "@/app/chatgpt-auth";
import { authorOf, authorsOf, budgetAuthorOf, budgetAuthors, budgetAuthorsOf, ensureTeamTables, evolutionAuthors, type TeamDb } from "@/app/clinic-team-db";
import { canChangeBudget, canChangeEvolution, canManageTeam, evolutionAuthor, isSupportRole } from "@/lib/clinic-team";
import { clinicalActionDenied, filterClinicalLoad } from "@/lib/role-policy";
import { CLINICAL_AUDIT, recordEvent } from "@/app/account-events";
import { loadProfile } from "@/app/clinician-profile-db";
import { touchAppUser } from "@/app/app-users-db";
import { isDeveloperEmail } from "@/lib/developer-dashboard";
import { loadAddresses, saveAddress } from "@/app/patient-address-db";
import { emptyAddress } from "@/lib/patient-address";
import { loadProfiles, saveProfile } from "@/app/patient-profile-db";
import { emptyProfile, normalizeProfile, profilePhonesValid } from "@/lib/patient-profile";
import { displayName } from "@/lib/clinician-profile";
import { ClinicalImportError, runDriveRecordImport } from "@/app/clinical-import";
import { syncInstalledImplants } from "@/app/sync-odontogram";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import { fullNameRequiredMessage, hasFourNameParts } from "@/app/patient-identity";
import { getDb } from "@/db";
import { appointments, budgets, calendarEvents, clinicalImages, evolutionDiagnoses, evolutions, patients, payments, periodontalExams, toothStatuses } from "@/db/schema";
import { settlePerformed, type Settled } from "@/lib/tooth-performed";
import { budgetTotals, decodeBudgetData, encodeBudgetData, ITEM_STATUSES, normalizeBudgetItems, validIsoDate, withItemStatus, type ItemStatus } from "@/lib/budget-plans";
import { sanitizeDiagnosisTags } from "@/lib/evolution-diagnoses";
import { EVOLUTION_PIECES_DDL, sanitizeChips, type PieceChip } from "@/lib/evolution-lines";
import { PAYMENT_ALLOCATIONS_DDL, PAYMENT_ALLOCATIONS_INDEX, sanitizeAllocations, type Allocation } from "@/lib/payment-allocation";
import type { OdontogramData, OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";
import { appendToothHistory, mergeRecentSurfaceEvent, toothHistorySnapshot } from "@/app/odontogram-history";
import { revertEvolution } from "@/lib/odontogram-timeline";
import { addLink, revertLinks, LINK_KINDS, type LinkKind } from "@/app/evolution-links-db";
import { crownShadeAfterDictation } from "@/lib/dictation/tooth-mode";

export const runtime = "edge";
export const dynamic = "force-dynamic";

import { asDocumentType, isValidDocument, storedDocument } from "@/lib/patient-document";

const now = () => new Date().toISOString();
const cleanRut = (value: string) => value.toUpperCase().replace(/[^0-9K]/g, "");
const validRut = (value: string) => {
  const v = cleanRut(value), body = v.slice(0, -1), digit = v.slice(-1);
  if (!/^\d{1,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0, m = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * m; m = m === 7 ? 2 : m + 1; }
  const d = 11 - sum % 11;
  return (d === 11 ? "0" : d === 10 ? "K" : String(d)) === digit;
};
const dateInChile = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const displayDate = (value: string) => {
  if (!value) return "Fecha de atención no consignada";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};
const diagnosisView = (d: typeof evolutionDiagnoses.$inferSelect) => ({ id: d.id, evolutionId: d.evolutionId, code: d.code, title: d.title, tooth: d.tooth, findings: d.findings, evidence: d.evidence, origin: d.origin, suggestedFrom: d.suggestedFrom });
type ChartHistoryMetadata = { source: "manual" | "evolution"; sourceEvolutionId?: number; sourceActionId?: string; clinicalDate?: string; title: string; detail?: string };
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const string = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizePatientName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Fecha de atención opcional (registro retroactivo): válida, no futura y no anterior a 5 años.
const attentionDateOk = (value: string) => !value || (validDate(value) && value <= dateInChile() && Number(value.slice(0, 4)) >= Number(dateInChile().slice(0, 4)) - 5);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPhone = (value: string) => !value || (/^[+\d()\s.-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 8);
const validEmail = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const protect = async () => (await getChatGPTUser())?.userId ?? null;
const teamDb = () => (env as unknown as { DB?: TeamDb }).DB;

/** Autor (id personal, correo y nombre) de lo que se guarda ahora en el espacio. */
async function currentAuthor() {
  const viewer = await getChatGPTUser();
  const raw = teamDb();
  if (!viewer) throw new Error("Sin sesión para registrar el autor.");
  if (raw) await ensureTeamTables(raw);
  const personalId = personalIdOf(viewer);
  const profile = await loadProfile(personalId).catch(() => null);
  return { authorId: personalId, authorEmail: viewer.email, authorName: (profile ? displayName(profile) : viewer.displayName).slice(0, 120), recordedAt: new Date().toISOString() };
}

/**
 * Sentencia que registra al autor de la evolución recién insertada. Va en el MISMO batch que el INSERT
 * (usa last_insert_rowid()): si no se puede registrar el autor, tampoco se guarda la evolución, así una
 * evolución de un colega nunca queda atribuida por error al titular.
 * Se devuelve envuelto: una función async que devolviera la consulta la ejecutaría al resolverse.
 */
async function authorStatement(db: ReturnType<typeof getDb>, spaceId: string) {
  return { statement: db.insert(evolutionAuthors).values({ ownerId: spaceId, evolutionId: sql`last_insert_rowid()`, ...await currentAuthor() }) };
}

/** Igual que `authorStatement`, para el presupuesto recién creado: su autor es quien firma el PDF. */
async function budgetAuthorStatement(db: ReturnType<typeof getDb>, spaceId: string) {
  return { statement: db.insert(budgetAuthors).values({ ownerId: spaceId, budgetId: sql`last_insert_rowid()`, ...await currentAuthor() }) };
}

/** Solo quien escribió una evolución la edita, anula o elimina. Las antiguas, sin autor registrado, son del titular del espacio. */
async function mayChangeEvolution(spaceId: string, evolutionId: number): Promise<boolean> {
  const viewer = await getChatGPTUser();
  if (!viewer) return false;
  const db = teamDb();
  const author = db ? await authorOf(db, spaceId, evolutionId) : null;
  return canChangeEvolution(author, spaceId, personalIdOf(viewer));
}
const NOT_AUTHOR = "Solo quien escribió esta evolución puede corregirla, anularla o eliminarla.";

/** Quién armó el presupuesto y si quien mira puede modificarlo (autor, o dueño/administrador de la clínica). */
async function budgetAccess(spaceId: string, budgetId: number, authors?: Map<number, { author_id: string }>) {
  const viewer = await getChatGPTUser();
  if (!viewer) return { editable: false, mine: false };
  const personalId = personalIdOf(viewer);
  const role = spaceRoleOf(viewer);
  const db = teamDb();
  // El dueño o un administrador modifican siempre: no dependen de leer el autor.
  if (canManageTeam(role) && !authors && personalId === spaceId) return { editable: true, mine: true };
  const recorded = authors ? authors.get(budgetId)?.author_id ?? null : db ? await budgetAuthorOf(db, spaceId, budgetId) : null;
  return { editable: canChangeBudget(recorded, spaceId, personalId, role), mine: evolutionAuthor(recorded, spaceId) === personalId };
}
const NOT_BUDGET_OWNER = "Este presupuesto lo armó otro profesional: solo él o el dueño de la clínica pueden modificarlo.";

/** Vista de un presupuesto recién cambiado, con su autor, para que la ficha no pierda «Presupuesto de…». */
async function budgetViewWithAuthor(b: typeof budgets.$inferSelect, spaceId: string, authors?: Map<number, { author_id: string; author_name: string }>) {
  const db = teamDb();
  const rows = authors ?? (db ? await budgetAuthorsOf(db, spaceId).catch(() => null) : new Map());
  // Si no se pudo leer el autor, la ficha no ofrece editar (el servidor igual lo valida al guardar).
  if (!rows) return { ...budgetView(b), authorName: "", mine: false, editable: false };
  const access = await budgetAccess(spaceId, b.id, rows).catch(() => ({ editable: false, mine: false }));
  return { ...budgetView(b), authorName: rows.get(b.id)?.author_name || "", ...access };
}
// This snapshot is supplied by a private runtime secret, never committed to Git.
function calendarSnapshot(email: string, persisted: typeof calendarEvents.$inferSelect[]) {
  if (email.toLowerCase() !== "lpaulr@gmail.com") return { events: [], capturedAt: null };
  const raw = (env as unknown as Record<string, unknown>).CALENDAR_WEEK_SNAPSHOT_JSON;
  if (typeof raw !== "string") return { events: [], capturedAt: null };
  try {
    const snapshot = JSON.parse(raw) as { calendarId?: string; capturedAt?: string; events?: Array<{ eventId?: string; title?: string; startAt?: string; endAt?: string; status?: string; htmlLink?: string }> };
    if (snapshot.calendarId !== "lpaulr@gmail.com" || !Array.isArray(snapshot.events)) return { events: [], capturedAt: null };
    const stored = new Set(persisted.filter(e => e.calendarId === snapshot.calendarId).map(e => e.googleEventId));
    const events = snapshot.events.flatMap((item, index) => {
      if (!item.eventId || stored.has(item.eventId) || !item.title || item.status !== "confirmed" || !item.startAt || !item.endAt || !Number.isFinite(Date.parse(item.startAt)) || !Number.isFinite(Date.parse(item.endAt))) return [];
      return [{ id: -index - 1, title: item.title, startAt: new Date(item.startAt).toISOString(), endAt: new Date(item.endAt).toISOString(), sourceTimeZone: "America/Santiago", htmlLink: item.htmlLink || null, status: "confirmed", allDay: false, patientId: null }];
    });
    return { events, capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : null };
  } catch { return { events: [], capturedAt: null }; }
}

const allowedTeeth = new Set([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]);
const surfaceKeys = new Set(["V","P","M","D","O"]);
const validPerioTeeth = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const perioSites = new Set(["MV","V","DV","ML","L","DL"]), gingivalSites = new Set(["V","L","D","M"]);
  for (const [key,raw] of Object.entries(value)) {
    const tooth = Number(key);
    if (!Number.isSafeInteger(tooth) || tooth < 11 || tooth > 48 || !allowedTeeth.has(tooth) || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string,unknown>;
    if (entry.sites !== undefined) {
      if (!entry.sites || typeof entry.sites !== "object" || Array.isArray(entry.sites)) return false;
      for (const [site,reading] of Object.entries(entry.sites)) {
        if (!perioSites.has(site) || !reading || typeof reading !== "object" || Array.isArray(reading)) return false;
        const r = reading as Record<string,unknown>;
        if (!(r.depth === null || (Number.isInteger(r.depth) && Number(r.depth) >= 0 && Number(r.depth) <= 20)) || !(r.margin === null || (Number.isInteger(r.margin) && Number(r.margin) >= -10 && Number(r.margin) <= 20)) || typeof r.bleeding !== "boolean" || typeof r.suppuration !== "boolean") return false;
      }
    }
    if (entry.gingivalIndex !== undefined) {
      if (!entry.gingivalIndex || typeof entry.gingivalIndex !== "object" || Array.isArray(entry.gingivalIndex)) return false;
      for (const [site,score] of Object.entries(entry.gingivalIndex)) if (!gingivalSites.has(site) || !Number.isInteger(score) || Number(score) < 0 || Number(score) > 3) return false;
    }
    if (entry.mobility !== undefined && !["","0","I","II","III"].includes(String(entry.mobility))) return false;
    if (entry.furcation !== undefined && !["","I","II","III"].includes(String(entry.furcation))) return false;
  }
  return true;
};
const normalizeOdontogram = (raw: unknown): OdontogramData => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const teeth = source.teeth && typeof source.teeth === "object" && !Array.isArray(source.teeth) ? { ...(source.teeth as Record<number,string>) } : {};
  const surfaces = source.surfaces && typeof source.surfaces === "object" && !Array.isArray(source.surfaces) ? { ...(source.surfaces as OdontogramData["surfaces"]) } : {};
  const missingReason = source.missingReason && typeof source.missingReason === "object" && !Array.isArray(source.missingReason) ? { ...(source.missingReason as OdontogramData["missingReason"]) } : {};
  for (const [key,value] of Object.entries(source)) if (/^\d{2}$/.test(key) && typeof value === "string") teeth[Number(key)] = value;
  const crowns = source.crowns && typeof source.crowns === "object" && !Array.isArray(source.crowns) ? { ...(source.crowns as NonNullable<OdontogramData["crowns"]>) } : {};
  const history = Array.isArray(source.history) ? source.history as NonNullable<OdontogramData["history"]> : [];
  for (const value of Object.values(crowns)) {
    if (!value || typeof value !== "object") continue;
    if (value.foundation !== "implant" && value.foundation !== "tooth") delete value.foundation;
  }
  const extras: NonNullable<OdontogramData["extras"]> = {};
  if (source.extras && typeof source.extras === "object" && !Array.isArray(source.extras)) {
    for (const [key, value] of Object.entries(source.extras)) {
      if (!/^\d{2}$/.test(key) || !Array.isArray(value)) continue;
      const list = value.filter((item): item is string => typeof item === "string" && isLesionStatus(item));
      if (list.length) extras[Number(key)] = [...new Set(list)];
    }
  }
  const chart = { teeth, surfaces, missingReason, crowns, extras, history };
  pruneChartExtras(chart);
  return chart;
};
const normalizePerio = (raw: unknown) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
  return source.teeth && typeof source.teeth === "object" && !Array.isArray(source.teeth)
    ? { teeth:source.teeth, epb:source.epb, classification:source.classification }
    : { teeth:source };
};

const PAYMENT_METHODS = new Set(["efectivo", "debito", "credito", "transferencia", "otro"]);

function paymentView(p: typeof payments.$inferSelect) {
  return { id: p.id, patientId: p.patientId, budgetId: p.budgetId, amount: p.amount, method: p.method, concept: p.concept, paidOn: p.paidOn, date: displayDate(p.paidOn) };
}

function budgetView(b: typeof budgets.$inferSelect) {
  const data = decodeBudgetData(b.items);
  return {
    id: b.id,
    patientId: b.patientId,
    date: displayDate(b.createdAt.slice(0, 10)),
    createdOn: b.createdAt.slice(0, 10),
    title: b.title,
    status: b.status,
    items: data.items,
    isAlternative: data.isAlternative,
    parentBudgetId: data.parentBudgetId,
  };
}

/** Datos de anulación de una evolución (solo si está anulada o reemplaza a otra). */
function annulView(n: typeof evolutions.$inferSelect) {
  return {
    status: n.status === "anulada" ? "anulada" as const : "vigente" as const,
    ...(n.status === "anulada" ? { annulledAt: n.annulledAt, annulledBy: n.annulledBy, annulReason: n.annulReason } : {}),
    ...(n.replacesId ? { replacesId: n.replacesId } : {}),
  };
}


/** Al borrar o anular una evolución, sus cambios en el odontograma se deshacen y las piezas se recalculan con lo que queda. */
async function revertChartOf(db: ReturnType<typeof getDb>, ownerId: string, patientId: number, evolutionId: number): Promise<number[]> {
  const [row] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
  if (!row) return [];
  const { chart, teeth } = revertEvolution(normalizeOdontogram(JSON.parse(row.data)), evolutionId);
  if (!teeth.length) return [];
  await db.update(toothStatuses).set({ data: JSON.stringify(chart), updatedAt: now() }).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
  return teeth;
}

/** Lo que la evolución generó en otras especialidades (endograma, examen periodontal) se deshace con ella. */
function revertLinkedRecords(db: ReturnType<typeof getDb>, ownerId: string, patientId: number, evolutionId: number) {
  return revertLinks(ownerId, patientId, evolutionId, async examId => {
    await db.delete(periodontalExams).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.ownerId, ownerId), eq(periodontalExams.patientId, patientId)));
  });
}

/** Copia íntegra de una evolución antes de quitarla de la ficha («error del sistema»). Devuelve false si no se pudo archivar. */
export const EVOLUTION_REMOVALS_DDL = "CREATE TABLE IF NOT EXISTS evolution_removals (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, evolution_id INTEGER NOT NULL, clinical_date TEXT, recorded_at TEXT, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT, request_id TEXT, diagnoses TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL, removed_by TEXT NOT NULL, removed_at TEXT NOT NULL)";
export const EVOLUTION_REMOVALS_COPY = "INSERT INTO evolution_removals (owner_id, patient_id, evolution_id, clinical_date, recorded_at, title, body, status, request_id, diagnoses, reason, removed_by, removed_at) " +
  "SELECT e.owner_id, e.patient_id, e.id, e.clinical_date, e.recorded_at, e.title, e.body, e.status, e.request_id, " +
  "COALESCE((SELECT json_group_array(json_object('code', d.code, 'title', d.title, 'tooth', d.tooth, 'findings', d.findings, 'evidence', d.evidence, 'origin', d.origin, 'createdAt', d.created_at)) FROM evolution_diagnoses d WHERE d.evolution_id = e.id AND d.owner_id = e.owner_id), '[]'), " +
  "'error del sistema', ?, ? FROM evolutions e WHERE e.id = ? AND e.owner_id = ? AND e.patient_id = ?";
async function archiveEvolution(ownerId: string, patientId: number, evolutionId: number, removedBy: string, at: string): Promise<boolean> {
  const raw = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<{ meta?: { changes?: number } }> }; run(): Promise<unknown> } } }).DB;
  if (!raw) return false;
  try {
    await raw.prepare(EVOLUTION_REMOVALS_DDL).run();
    const result = await raw.prepare(EVOLUTION_REMOVALS_COPY).bind(removedBy, at, evolutionId, ownerId, patientId).run();
    return (result?.meta?.changes ?? 1) > 0;
  } catch { return false; }
}

export async function GET() {
  const viewer = await getChatGPTUser();
  const ownerId = viewer?.userId;
  if (!ownerId) return error("Inicia sesión para ver las fichas.", 401);
  try {
    const db = getDb();
    let profileFailed = false;
    const personalId = viewer ? personalIdOf(viewer) : ownerId;
    const spaceRole = viewer ? spaceRoleOf(viewer) : "titular";
    // Todo lo que no depende de lo demás se pide a la vez: cada consulta a la base tiene su propia ida y vuelta.
    const profileP = loadProfile(personalId).catch(() => { profileFailed = true; return null; });
    // Registro de ingresos para el panel del desarrollador; si falla, la ficha carga igual.
    const touchP = touchAppUser(personalId, viewer?.email || "", viewer?.fullName || "").catch(() => undefined);
    const authorDb = teamDb();
    const authorsP = authorDb ? authorsOf(authorDb, ownerId).catch(() => new Map()) : Promise.resolve(new Map());
    const budgetAuthorsP = authorDb ? budgetAuthorsOf(authorDb, ownerId).catch(() => new Map()) : Promise.resolve(new Map());
    const addressesP = loadAddresses(ownerId);
    const profilesP = loadProfiles(ownerId);
    const rawDb = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }> } } } }).DB;
    const allocationRowsP = rawDb
      ? rawDb.prepare("SELECT payment_id, item_index, item_label, amount FROM payment_allocations WHERE owner_id = ? ORDER BY id").bind(ownerId).all<{ payment_id: number; item_index: number; item_label: string; amount: number }>().catch(() => ({ results: [] as { payment_id: number; item_index: number; item_label: string; amount: number }[] }))
      : Promise.resolve({ results: [] as { payment_id: number; item_index: number; item_label: string; amount: number }[] });
    const pieceRowsP = rawDb
      ? rawDb.prepare("SELECT evolution_id, pieces FROM evolution_pieces WHERE owner_id = ?").bind(ownerId).all<{ evolution_id: number; pieces: string }>().catch(() => ({ results: [] as { evolution_id: number; pieces: string }[] }))
      : Promise.resolve({ results: [] as { evolution_id: number; pieces: string }[] });
    // Ida y vuelta con Google: duración real, citas sin paciente y marcas «pendiente de sincronizar» (si falla, la agenda carga igual).
    const agendaSyncP = import("@/app/calendar-two-way").then(m => m.agendaSyncFlags(ownerId)).catch(() => ({ minutes: {} as Record<number, number>, needsPatient: [] as number[], pendingAppointments: [] as number[], pendingEvents: [] as number[] }));
    const authorView = (id: number) => {
      const row = authors.get(id);
      const authorId = evolutionAuthor(row?.author_id, ownerId);
      return { authorName: row?.author_name || "", authorEmail: row?.author_email || "", mine: authorId === personalId };
    };
    const [ps, ns, bs, as, pe, ts, imgs, ces, pays, dxs, profile, , authors, addresses, profiles, budgetAuthorMap, allocationRows, pieceRows, agendaSync] = await Promise.all([
      db.select().from(patients).where(eq(patients.ownerId, ownerId)).orderBy(patients.name),
      db.select().from(evolutions).where(eq(evolutions.ownerId, ownerId)).orderBy(desc(evolutions.clinicalDate), desc(evolutions.recordedAt)),
      db.select().from(budgets).where(eq(budgets.ownerId, ownerId)).orderBy(desc(budgets.id)),
      db.select().from(appointments).where(eq(appointments.ownerId, ownerId)).orderBy(appointments.day),
      db.select().from(periodontalExams).where(eq(periodontalExams.ownerId, ownerId)).orderBy(desc(periodontalExams.id)),
      db.select().from(toothStatuses).where(eq(toothStatuses.ownerId, ownerId)),
      db.select().from(clinicalImages).where(eq(clinicalImages.ownerId, ownerId)).orderBy(desc(clinicalImages.id)),
      db.select().from(calendarEvents).where(eq(calendarEvents.ownerId, ownerId)).orderBy(calendarEvents.startAt),
      // Si la migración de pagos aún no se aplicó, la ficha carga igual.
      db.select().from(payments).where(eq(payments.ownerId, ownerId)).orderBy(desc(payments.paidOn), desc(payments.id)).catch(() => [] as (typeof payments.$inferSelect)[]),
      // Igual con las etiquetas de diagnóstico (migración 0005).
      db.select().from(evolutionDiagnoses).where(eq(evolutionDiagnoses.ownerId, ownerId)).orderBy(evolutionDiagnoses.id).catch(() => [] as (typeof evolutionDiagnoses.$inferSelect)[]),
      profileP, touchP, authorsP, addressesP, profilesP, budgetAuthorsP, allocationRowsP, pieceRowsP, agendaSyncP,
    ]);
    // Resumen por pieza de cada evolución (tabla aditiva; si no existe aún, la ficha carga igual).
    const piecesByNote = new Map<number, PieceChip[]>();
    for (const row of pieceRows.results) { try { piecesByNote.set(row.evolution_id, sanitizeChips(JSON.parse(row.pieces))); } catch { /* fila dañada: se omite */ } }
    const diagnosesByNote = new Map<number, ReturnType<typeof diagnosisView>[]>();
    for (const dx of dxs) diagnosesByNote.set(dx.evolutionId, [...(diagnosesByNote.get(dx.evolutionId) ?? []), diagnosisView(dx)]);
    const notesByPatient = new Map<number, typeof ns>();
    for (const note of ns) {
      const patientNotes = notesByPatient.get(note.patientId);
      if (patientNotes) patientNotes.push(note);
      else notesByPatient.set(note.patientId, [note]);
    }
    const examsByPatient = new Map<number, typeof pe>();
    for (const exam of pe) {
      const patientExams = examsByPatient.get(exam.patientId);
      if (patientExams) patientExams.push(exam);
      else examsByPatient.set(exam.patientId, [exam]);
    }
    const toothStatusByPatient = new Map(ts.map(status => [status.patientId, status]));
    const snapshot = calendarSnapshot(viewer?.email || "", ces);
    const charts = Object.fromEntries(ps.map(p => {
      const saved = toothStatusByPatient.get(p.id);
      const chart = normalizeOdontogram(saved ? JSON.parse(saved.data) : {});
      for (const note of notesByPatient.get(p.id) ?? []) {
        if (note.status === "anulada") continue;
        const crown = cementedCrownFromEvolution(note.body);
        const status = chart.teeth[crown?.tooth ?? -1];
        if (crown?.material && !chart.crowns?.[crown.tooth] && ((crown.onImplant && status === "Implante") || (!crown.onImplant && status === "Corona"))) {
          chart.crowns![crown.tooth] = { material: crown.material, shade: crown.shade, source: "evolution", clinicalDate: note.clinicalDate, foundation: crown.onImplant ? "implant" : "tooth" };
        }
      }
      return [p.id, chart];
    }));
    return Response.json(filterClinicalLoad(spaceRole, {
      patients: ps.map(p => ({ ...p, rut: p.rut || "", address: addresses.get(p.id) ?? emptyAddress(), profile: profiles.get(p.id) ?? emptyProfile() })),
      notes: ns.map(n => ({ id: n.id, patientId: n.patientId, date: displayDate(n.clinicalDate), clinicalDate: n.clinicalDate, recordedAt: n.recordedAt, title: n.title, body: n.body, sourceDocumentId: n.sourceDocumentId, backupStatus: n.backupStatus, diagnoses: diagnosesByNote.get(n.id) ?? [], pieces: piecesByNote.get(n.id) ?? [], ...annulView(n), ...authorView(n.id) })),
      budgets: await (async () => {
        // Quién armó cada presupuesto (en una clínica, el colega que lo estableció); los antiguos, del titular.
        return bs.map(b => {
          const row = budgetAuthorMap.get(b.id);
          const author = row?.author_id || ownerId;
          return { ...budgetView(b), authorName: row?.author_name || "", mine: author === personalId, editable: canChangeBudget(row?.author_id, ownerId, personalId, spaceRole) };
        });
      })(),
      appointments: as.map(a => ({ id: a.id, patientId: a.patientId, day: a.day.split("-").reverse().join("-"), time: a.time, reason: a.reason, ...(agendaSync.minutes[a.id] ? { minutes: agendaSync.minutes[a.id] } : {}) })),
      agendaSync: { needsPatient: agendaSync.needsPatient, pendingAppointments: agendaSync.pendingAppointments, pendingEvents: agendaSync.pendingEvents },
      payments: (() => {
        // Abonos aplicados a ítems (tabla aditiva); los abonos sin asignación son «libres».
        const byPayment = new Map<number, Allocation[]>();
        for (const row of allocationRows.results) byPayment.set(row.payment_id, [...(byPayment.get(row.payment_id) ?? []), { index: row.item_index, label: row.item_label, amount: row.amount }]);
        return pays.map(p => ({ ...paymentView(p), ...(byPayment.has(p.id) ? { allocations: byPayment.get(p.id) } : {}) }));
      })(),
      calendarEvents: [...ces.filter(e => e.status !== "cancelled").map(e => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, sourceTimeZone: e.sourceTimeZone, htmlLink: e.htmlLink, status: e.status, allDay: e.allDay, patientId: e.patientId })), ...snapshot.events],
      calendarSnapshotAt: snapshot.events.length ? snapshot.capturedAt : null,
      calendarSyncedAt: ces.reduce<string | null>((latest, e) => (e.importedAt && (!latest || e.importedAt > latest) ? e.importedAt : latest), null),
      viewer: { name: profile ? displayName(profile) : viewer?.displayName || "", email: viewer?.email || "", registered: Boolean(profile) || profileFailed || isSupportRole(spaceRole), personalName: viewer?.fullName || viewer?.displayName || "", specialty: profile?.specialty || "", clinicName: (personalId === ownerId ? profile?.clinicName : (await loadProfile(ownerId).catch(() => null))?.clinicName) || "", developer: isDeveloperEmail(viewer?.email, (env as unknown as { DEVELOPER_EMAILS?: string }).DEVELOPER_EMAILS), spaceRole, inClinic: personalId !== ownerId, manageTeam: canManageTeam(spaceRole) },
      periodontalExams: Object.fromEntries(ps.map(p => [p.id, (examsByPatient.get(p.id) ?? []).map(x => ({ id: x.id, recordedAt: x.recordedAt, ...normalizePerio(JSON.parse(x.teeth)) }))])),
      toothStatuses: charts,
      clinicalImages: imgs.map(i => ({ id: i.id, patientId: i.patientId, url: "/api/images/" + i.id, name: i.name, kind: i.kind, note: i.note, addedAt: displayDate(i.addedAt.slice(0, 10)), size: i.size, contentType: i.contentType })),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("No se pudo cargar la base de datos. Intenta de nuevo.", 503);
  }
}

/**
 * Permisos por rol (Recepción / Asistente) antes de cualquier acción, y auditoría de quién hizo cada cambio relevante.
 * La acción misma está en `handlePost`.
 */
export async function POST(request: Request) {
  const actor = await getChatGPTUser();
  if (!actor?.userId) return error("Inicia sesión para guardar.", 401);
  const peek = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  const action = peek && typeof peek === "object" ? peek.action : undefined;
  const denied = clinicalActionDenied(spaceRoleOf(actor), action);
  if (denied) return error(denied, 403);
  const response = await handlePost(request);
  const kind = typeof action === "string" ? CLINICAL_AUDIT[action] : undefined;
  if (kind && response.ok) await recordEvent(actor, kind, peek?.appointmentId ?? peek?.budgetId ?? peek?.patientId ?? "", { patientId: peek?.patientId ?? null, ...(typeof peek?.status === "string" ? { status: peek.status } : {}), ...(typeof peek?.amount === "number" ? { amount: peek.amount } : {}) });
  return response;
}

async function handlePost(request: Request) {
  const ownerId = await protect();
  if (!ownerId) return error("Inicia sesión para guardar.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let input: Record<string, unknown>;
  try { input = await request.json(); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
  catch { return error("Solicitud inválida."); }
  const db = getDb();
  const action = input.action, patientId = Number(input.patientId);
  try {
    if (action === "importCalendarEvents") {
      const raw = input.events;
      const calendarId = string(input.calendarId, 512);
      if (!calendarId || !Array.isArray(raw) || raw.length < 1 || raw.length > 250) return error("Lote de calendario inválido.");
      const parsed: Array<{eventId:string;title:string;startAt:string;endAt:string;htmlLink:string|null;status:string}> = [];
      const ids = new Set<string>();
      for (const item of raw) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return error("Evento inválido.");
        const e = item as Record<string,unknown>;
        const eventId=string(e.eventId,512), title=string(e.title,500), start=string(e.startAt,64), end=string(e.endAt,64), link=string(e.htmlLink,2000), status=string(e.status,20)||"confirmed";
        const validTime=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
        const startDate=new Date(start), endDate=new Date(end);
        let validLink=true;
        if (link) { try { const u=new URL(link); validLink=u.protocol==="https:"&&["www.google.com","calendar.google.com"].includes(u.hostname); } catch { validLink=false; } }
        if (!eventId || ids.has(eventId) || !title || !validTime.test(start) || !validTime.test(end) || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate>=endDate || !["confirmed","cancelled"].includes(status) || !validLink) return error("Revisa ID, fechas, estado o enlace del evento.");
        ids.add(eventId);
        parsed.push({eventId,title,startAt:startDate.toISOString(),endAt:endDate.toISOString(),htmlLink:link||null,status});
      }
      const importedAt=now();
      for (const e of parsed) await db.insert(calendarEvents).values({ownerId,calendarId,googleEventId:e.eventId,title:e.title,startAt:e.startAt,endAt:e.endAt,sourceTimeZone:"America/Santiago",htmlLink:e.htmlLink,status:e.status,allDay:false,importedAt}).onConflictDoUpdate({target:[calendarEvents.ownerId,calendarEvents.calendarId,calendarEvents.googleEventId],set:{title:e.title,startAt:e.startAt,endAt:e.endAt,htmlLink:e.htmlLink,status:e.status,importedAt}});
      const saved=await db.select({id:calendarEvents.googleEventId,title:calendarEvents.title,startAt:calendarEvents.startAt,endAt:calendarEvents.endAt,status:calendarEvents.status}).from(calendarEvents).where(and(eq(calendarEvents.ownerId,ownerId),eq(calendarEvents.calendarId,calendarId)));
      if (parsed.some(e=>!saved.some(s=>s.id===e.eventId&&s.title===e.title&&s.startAt===e.startAt&&s.endAt===e.endAt&&s.status===e.status))) return error("No se pudo verificar la importación.",503);
      return Response.json({imported:true,count:parsed.length});
    }    if (action === "createPatient") {
      const name = string(input.name, 180), birthDateInput = typeof input.birthDate === "string" ? input.birthDate.trim() : "", birthDate = string(birthDateInput, 10), rutRaw = string(input.rut, 30), documentType = asDocumentType(input.documentType), phone = string(input.phone, 24), email = string(input.email, 254);
      if (!validPhone(phone) || !validEmail(email) || !profilePhonesValid(normalizeProfile(input.profile))) return error("Revisa el teléfono y el correo electrónico.");
      if (!hasFourNameParts(name)) return error(fullNameRequiredMessage());
      if (birthDateInput.length > 10 || !birthDate || !validDate(birthDate) || birthDate > dateInChile() || Number(birthDate.slice(0, 4)) < Number(dateInChile().slice(0, 4)) - 125 || (rutRaw && !isValidDocument(rutRaw, documentType))) return error("Revisa el nombre, fecha de nacimiento y documento de identidad. La fecha de nacimiento es obligatoria.");
      const rut = rutRaw ? storedDocument(rutRaw, documentType) : null;
      if (rut && (await db.select({ id: patients.id }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut)))).length) return error("Ya existe un paciente con ese documento de identidad.", 409);
      const t = now();
      const [p] = await db.insert(patients).values({ ownerId, name, birthDate, rut, phone, email, reason: string(input.reason, 240) || "Evaluación", status: "Evaluación", allergies: "Sin registrar", history: "Sin registrar", createdAt: t, updatedAt: t }).returning();
      const address = await saveAddress(ownerId, p.id, input.address).catch(() => emptyAddress());
      const profile = await saveProfile(ownerId, p.id, input.profile).catch(() => emptyProfile());
      return Response.json({ patient: { ...p, rut: documentType === "extranjero" ? (rut ?? "") : rutRaw || "", address, profile } }, { status: 201 });
    }
    if (action === "previewDriveRecords" || action === "importDriveRecords") {
      const importer = await getChatGPTUser();
      if (!importer || !canManageTeam(spaceRoleOf(importer))) return error("Solo un administrador de la clínica puede importar fichas.", 403);
      try {
        const outcome = await runDriveRecordImport(ownerId, input.records, action === "importDriveRecords");
        if (action === "previewDriveRecords") return Response.json(outcome);
        if (!outcome.imported) return error(outcome.message || "No se pudo confirmar la importación.", 409);
        return Response.json({ result: outcome.result });
      } catch (e) {
        if (e instanceof ClinicalImportError) return error(e.message, e.status);
        throw e;
      }
    }
    if (!Number.isSafeInteger(patientId) || patientId <= 0) return error("Selecciona un paciente válido.");
    const [patient] = await db.select({ id: patients.id, name: patients.name, rut: patients.rut, birthDate: patients.birthDate, phone: patients.phone, email: patients.email, allergies: patients.allergies, history: patients.history }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!patient) return error("Paciente no encontrado.", 404);
    const chartHistoryMetadata = async (fallbackTitle: string): Promise<ChartHistoryMetadata | { error: string }> => {
      const rawId = input.sourceEvolutionId;
      if (rawId === undefined || rawId === null || rawId === "") {
        // Evolución manual de la pieza: el clínico puede fechar el cambio (hoy o una fecha pasada) y nombrarlo.
        const manualDate = string(input.clinicalDate, 10);
        if (manualDate && !attentionDateOk(manualDate)) return { error: "Revisa la fecha: no puede ser futura." };
        const manualTitle = string(input.historyTitle, 180), manualDetail = string(input.historyDetail, 300);
        return { source: "manual", title: manualTitle || fallbackTitle, clinicalDate: manualDate || dateInChile(), ...(manualDetail ? { detail: manualDetail } : {}) };
      }
      const sourceEvolutionId = Number(rawId);
      const sourceActionId = string(input.sourceActionId, 180);
      if (!Number.isSafeInteger(sourceEvolutionId) || sourceEvolutionId <= 0 || !sourceActionId) return { error: "La vinculación con la evolución clínica no es válida." };
      const [sourceNote] = await db.select({ id: evolutions.id, clinicalDate: evolutions.clinicalDate }).from(evolutions)
        .where(and(eq(evolutions.id, sourceEvolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!sourceNote) return { error: "La evolución vinculada no pertenece a esta ficha." };
      return { source: "evolution", sourceEvolutionId, sourceActionId, clinicalDate: sourceNote.clinicalDate, title: string(input.historyTitle, 180) || fallbackTitle, ...(string(input.historyDetail, 300) ? { detail: string(input.historyDetail, 300) } : {}) };
    };
    const historyAlreadyRecorded = (data: OdontogramData, metadata: ChartHistoryMetadata) =>
      metadata.source === "evolution" && Boolean(metadata.sourceActionId && data.history?.some(event =>
        event.sourceEvolutionId === metadata.sourceEvolutionId && event.sourceActionId === metadata.sourceActionId));

    if (action === "applyToothDictation") {
      const tooth = Number(input.tooth), rawChanges = input.changes;
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !Array.isArray(rawChanges) || rawChanges.length < 1 || rawChanges.length > 23) return error("La pieza o la propuesta de dictado no son válidas.");
      const budgetTitle = string(input.budgetTitle, 180);
      const hasBudget = input.budgetItems !== undefined || input.budgetTitle !== undefined;
      const normalizedBudget = hasBudget ? normalizeBudgetItems(input.budgetItems, true) : null;
      if (hasBudget && (!budgetTitle || !normalizedBudget)) return error("Revisa el título y las prestaciones del presupuesto preliminar.");
      if (normalizedBudget?.some(item => item.zone || item.teeth?.some(itemTooth => itemTooth !== tooth))) return error("El presupuesto de este dictado debe corresponder solo a la pieza seleccionada.");
      const rawEvolution = input.evolution && typeof input.evolution === "object" && !Array.isArray(input.evolution) ? input.evolution as Record<string, unknown> : null;
      const evolutionTitle = string(rawEvolution?.title, 180), evolutionBody = string(rawEvolution?.body, 30000), evolutionRequestId = string(rawEvolution?.requestId, 80);
      if (!evolutionTitle || !evolutionBody || !evolutionRequestId) return error("El diagnóstico y el plan deben guardarse juntos en la evolución general del paciente.");
      type DictationOperation =
        | { kind: "status"; status: string; missingReason?: "caries" | "other" | "unknown" }
        | { kind: "surface"; surface: OdontogramSurface; finding: SurfaceFinding }
        | { kind: "crown"; material: string; shade: string | null; foundation?: "tooth" | "implant" }
        | { kind: "diagnosis"; title: string; detail: string };
      const operations: DictationOperation[] = [];
      const uniqueKeys = new Set<string>();
      for (const raw of rawChanges) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return error("La propuesta de dictado contiene un cambio inválido.");
        const change = raw as Record<string, unknown>, kind = string(change.kind, 16);
        if (kind === "status") {
          const status = string(change.status, 48), reason = change.missingReason == null ? "" : string(change.missingReason, 16);
          if (!ALL_TOOTH_STATUSES.includes(status) || (reason && !["caries", "other", "unknown"].includes(reason))) return error("Estado dental o causa de ausencia inválidos.");
          const key = "status";
          if (uniqueKeys.has(key)) return error("La propuesta repite un estado para la misma pieza.");
          uniqueKeys.add(key);
          operations.push({ kind: "status", status, ...(reason ? { missingReason: reason as "caries" | "other" | "unknown" } : {}) });
          continue;
        }
        if (kind === "surface") {
          const surface = string(change.surface, 2), rawFinding = change.finding;
          if (!surfaceKeys.has(surface) || !rawFinding || typeof rawFinding !== "object" || Array.isArray(rawFinding)) return error("La propuesta contiene una cara dental inválida.");
          const finding = rawFinding as Record<string, unknown>, condition = string(finding.condition, 32);
          if (!["not_examined", "sound", "caries", "restored", "sealant", "other_restoration"].includes(condition)) return error("Estado de superficie inválido.");
          let normalized: SurfaceFinding;
          if (condition === "caries") {
            const depth = finding.depth, icdas = finding.icdas == null || finding.icdas === "" ? null : Number(finding.icdas), activity = finding.activity == null || finding.activity === "" ? null : string(finding.activity, 16);
            if ((depth != null && depth !== "" && !isCariesDepth(depth)) || (icdas !== null && (!Number.isInteger(icdas) || icdas < 1 || icdas > 6)) || (activity !== null && !["active", "inactive", "uncertain"].includes(activity))) return error("Profundidad, actividad o registro anterior de caries inválidos.");
            const restorationStage = activity === "inactive" ? string(finding.restorationStage, 20) : "";
            const restorationMaterial = activity === "inactive" ? string(finding.restorationMaterial, 40) : "";
            if ((restorationStage && !["provisional", "definitive"].includes(restorationStage)) || (restorationMaterial && !["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Eugenato", "Otro"].includes(restorationMaterial))) return error("El material de restauración de la lesión es inválido.");
            normalized = {
              condition: "caries", depth: isCariesDepth(depth) ? depth : null, icdas: icdas as SurfaceFinding["icdas"], activity: activity as SurfaceFinding["activity"],
              ...(restorationStage ? { restorationStage: restorationStage as SurfaceFinding["restorationStage"] } : {}),
              ...(restorationMaterial ? { restorationMaterial: restorationMaterial as SurfaceFinding["restorationMaterial"] } : {}),
            };
          } else {
            const restorationStage = condition === "restored" ? string(finding.restorationStage, 20) : "";
            const restorationMaterial = condition === "restored" ? string(finding.restorationMaterial, 40) : "";
            if ((restorationStage && !["provisional", "definitive"].includes(restorationStage)) || (restorationMaterial && !["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Eugenato", "Otro"].includes(restorationMaterial))) return error("Material de restauración inválido.");
            normalized = {
              condition: condition as SurfaceFinding["condition"], depth: null, icdas: null, activity: null,
              ...(condition === "restored" && restorationStage ? { restorationStage: restorationStage as SurfaceFinding["restorationStage"] } : {}),
              ...(condition === "restored" && restorationMaterial ? { restorationMaterial: restorationMaterial as SurfaceFinding["restorationMaterial"] } : {}),
            };
          }
          const key = `surface:${surface}`;
          if (uniqueKeys.has(key)) return error("La propuesta repite una cara de esta pieza.");
          uniqueKeys.add(key);
          operations.push({ kind: "surface", surface: surface as OdontogramSurface, finding: normalized });
          continue;
        }
        if (kind === "crown") {
          const material = string(change.material, 60), shade = change.shade == null || change.shade === "" ? null : string(change.shade, 10);
          const foundation = change.foundation === "implant" || change.foundation === "tooth" ? change.foundation : undefined;
          if (!material || !["Zirconio", "Disilicato", "Metal cerámica", "Resina", "Otro"].includes(material) || (shade && !/^[A-D][1-4](?:\.5)?$/i.test(shade))) return error("Revisa el material o el color de la corona.");
          if (uniqueKeys.has("crown")) return error("La propuesta repite los detalles de la corona.");
          uniqueKeys.add("crown");
          operations.push({ kind: "crown", material, shade, ...(foundation ? { foundation } : {}) });
          continue;
        }
        if (kind === "diagnosis") {
          const title = string(change.title, 100), detail = string(change.detail, 1000);
          if (!title || !detail) return error("El diagnóstico dictado necesita un nombre y un detalle.");
          if (uniqueKeys.has("diagnosis")) return error("La propuesta repite el diagnóstico de esta pieza.");
          uniqueKeys.add("diagnosis");
          operations.push({ kind: "diagnosis", title, detail });
          continue;
        }
        return error("La propuesta incluye un tipo de cambio que no pertenece al odontograma de una pieza.");
      }

      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      const statusOperation = operations.find((operation) => operation.kind === "status");
      const diagnosisOperation = operations.find((operation): operation is Extract<DictationOperation, { kind: "diagnosis" }> => operation.kind === "diagnosis");
      const statusCheck = { teeth: { ...data.teeth }, extras: Object.fromEntries(Object.entries(data.extras ?? {}).map(([key, items]) => [key, [...items]])) };
      if (statusOperation?.kind === "status") applyStatusToChart(statusCheck, tooth, statusOperation.status);
      const resultingStatus = statusCheck.teeth[tooth] ?? "Sin hallazgos";
      if (statusOperation?.kind === "status" && statusOperation.missingReason && !["Ausente", "Indicación de exodoncia", "Implante", "Implante con pilar"].includes(resultingStatus)) return error("La causa de pérdida requiere una pieza ausente, indicada para exodoncia o con implante.");
      if (operations.some((operation) => operation.kind === "surface") && ["Ausente", "Implante", "Implante con pilar"].includes(resultingStatus)) return error("No se registran superficies dentarias en dientes ausentes o implantes.");
      if (operations.some((operation) => operation.kind === "surface" && operation.finding.condition === "sealant") && resultingStatus === "Corona") return error("Una pieza con corona no tiene superficie para sellar.");
      const crownOperation = operations.find((operation) => operation.kind === "crown");
      if (crownOperation?.kind === "crown") {
        const foundation = crownOperation.foundation ?? (resultingStatus === "Implante" || resultingStatus === "Implante con pilar" ? "implant" : "tooth");
        const currentStatus = data.teeth[tooth] ?? "Sin hallazgos";
        if (foundation === "implant" && !["Implante", "Implante con pilar", "Corona"].includes(resultingStatus)) return error("Primero registra el implante en la pieza indicada.");
        if (foundation === "tooth" && resultingStatus !== "Corona" && !["Implante", "Implante con pilar"].includes(currentStatus)) return error("Primero registra una corona en la pieza indicada.");
      }

      const appendManualHistory = async (fallbackTitle: string, eventType: "status" | "surface" | "crown", surface?: OdontogramSurface) => {
        const historyMeta = { source: "manual" as const, title: fallbackTitle, clinicalDate: dateInChile() };
        const before = toothHistorySnapshot(data, tooth), updatedAt = now(), historyBefore = data.history?.length ?? 0;
        if (eventType === "status") {
          const operation = statusOperation;
          if (!operation || operation.kind !== "status") return { error: "Estado dental inválido." };
          applyStatusToChart(data, tooth, operation.status);
          const effective = isLesionStatus(operation.status) && data.teeth[tooth] ? data.teeth[tooth] : operation.status;
          if (["Ausente", "Implante", "Implante con pilar"].includes(effective)) delete data.surfaces[tooth];
          else if (effective !== "Indicación de exodoncia") delete data.missingReason[tooth];
          if (effective === "Corona" && data.crowns?.[tooth]) data.crowns[tooth] = { ...data.crowns[tooth], foundation: "tooth" };
          else if (!(effective === "Implante" && data.crowns?.[tooth]?.foundation === "implant") && !(effective === "Implante con pilar" && data.crowns?.[tooth])) delete data.crowns?.[tooth];
          if (operation.missingReason) data.missingReason[tooth] = operation.missingReason;
        } else if (eventType === "crown") {
          if (!crownOperation || crownOperation.kind !== "crown") return { error: "Detalle de corona inválido." };
          const foundation = crownOperation.foundation ?? (data.teeth[tooth] === "Implante" || data.teeth[tooth] === "Implante con pilar" ? "implant" : "tooth");
          if (foundation === "tooth" && ["Implante", "Implante con pilar"].includes(data.teeth[tooth] ?? "")) data.teeth[tooth] = "Corona";
          if (foundation === "implant" && ["Corona", "Implante con pilar"].includes(data.teeth[tooth] ?? "")) data.teeth[tooth] = "Implante";
          pruneChartExtras(data);
          if (foundation === "implant" && data.teeth[tooth] !== "Implante") return { error: "Primero registra el implante en la pieza indicada." };
          if (foundation === "tooth" && data.teeth[tooth] !== "Corona") return { error: "Primero registra una corona en la pieza indicada." };
          data.crowns![tooth] = { material: crownOperation.material || data.crowns?.[tooth]?.material || "", shade: crownShadeAfterDictation(crownOperation.shade, data.crowns?.[tooth]?.shade), source: historyMeta.source, clinicalDate: historyMeta.clinicalDate, foundation };
        } else {
          const operation = operations.find((item) => item.kind === "surface" && item.surface === surface);
          if (!operation || operation.kind !== "surface" || !surface) return { error: "Cara dental inválida." };
          const prior = data.surfaces[tooth]?.[surface];
          const finding = operation.finding.condition === "restored" && prior?.condition === "restored"
            ? { ...operation.finding, ...(!operation.finding.restorationStage && prior.restorationStage ? { restorationStage: prior.restorationStage } : {}), ...(!operation.finding.restorationMaterial && prior.restorationMaterial ? { restorationMaterial: prior.restorationMaterial } : {}) }
            : operation.finding;
          data.surfaces[tooth] = { ...(data.surfaces[tooth] ?? {}), [surface]: finding };
        }
        appendToothHistory(data, tooth, eventType, before, { recordedAt: updatedAt, ...historyMeta, ...(surface ? { surface } : {}), ...(eventType === "crown" ? { title: historyMeta.title || (crownOperation?.kind === "crown" && crownOperation.foundation === "implant" ? "Corona sobre implante" : "Corona sobre diente") } : {}) });
        if (eventType === "surface" && surface && (data.history?.length ?? 0) > historyBefore) mergeRecentSurfaceEvent(data, tooth, surface);
        return null;
      };

      for (const operation of operations.filter((item) => item.kind === "status")) {
        const failure = await appendManualHistory(operation.kind === "status" ? `Estado actualizado: ${operation.status}` : "Estado actualizado", "status");
        if (failure) return error(failure.error);
      }
      if (crownOperation) {
        const foundation = crownOperation.kind === "crown" ? crownOperation.foundation ?? (resultingStatus === "Implante" || resultingStatus === "Implante con pilar" ? "implant" : "tooth") : "tooth";
        const failure = await appendManualHistory(foundation === "implant" ? "Corona sobre implante" : "Corona sobre diente natural", "crown");
        if (failure) return error(failure.error);
      }
      for (const operation of operations.filter((item): item is Extract<DictationOperation, { kind: "surface" }> => item.kind === "surface")) {
        const failure = await appendManualHistory(`Hallazgo actualizado en cara ${operation.surface}`, "surface", operation.surface);
        if (failure) return error(failure.error);
      }
      const updatedAt = now();
      if (diagnosisOperation) {
        const before = toothHistorySnapshot(data, tooth);
        appendToothHistory(data, tooth, "diagnosis", before, {
          recordedAt: updatedAt, clinicalDate: dateInChile(), source: "manual",
          title: diagnosisOperation.title, detail: diagnosisOperation.detail,
        });
      }
      const chartWrite = db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt })
        .onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      let savedBudget: typeof budgets.$inferSelect | undefined;
      let savedNote: typeof evolutions.$inferSelect | undefined;
      const clinicalDate = dateInChile();
      const noteAuthor = await currentAuthor();
      const evolutionWrite = db.insert(evolutions).values({ ownerId, patientId, clinicalDate, recordedAt: updatedAt, title: evolutionTitle, body: evolutionBody, requestId: evolutionRequestId, backupStatus: "not_configured" }).returning();
      const evolutionAuthorWrite = db.insert(evolutionAuthors).values({ ownerId, evolutionId: sql`last_insert_rowid()`, ...noteAuthor });
      // «Ya realizado hoy»: la prestación pendiente de esta pieza que coincide se cierra en su presupuesto; lo que no tenía plan queda como prestación ya realizada.
      const performed = input.performed === true;
      let settled: Settled | null = null;
      const storedBudgetData = new Map<number, ReturnType<typeof decodeBudgetData>>();
      if (performed && normalizedBudget) {
        const stored = await db.select().from(budgets).where(and(eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId)));
        const views = stored.flatMap(row => { try { const decoded = decodeBudgetData(row.items); storedBudgetData.set(row.id, decoded); return [{ id: row.id, items: decoded.items, isAlternative: decoded.isAlternative }]; } catch { return []; } });
        settled = settlePerformed(views, tooth, normalizedBudget.map(item => ({ ...item, teeth: [tooth] })), clinicalDate);
      }
      const budgetToInsert = settled ? settled.remaining : normalizedBudget;
      if (budgetToInsert && budgetToInsert.length) {
        const itemsData = encodeBudgetData(budgetToInsert.map(item => ({ ...item, teeth: [tooth] })), { isAlternative: false, parentBudgetId: null });
        const budgetAuthor = await budgetAuthorStatement(db, ownerId);
        const [, inserted, , insertedNote] = await db.batch([
          chartWrite,
          db.insert(budgets).values({ ownerId, patientId, title: budgetTitle, items: itemsData, status: "Borrador", createdAt: updatedAt }).returning(),
          budgetAuthor.statement,
          evolutionWrite,
          evolutionAuthorWrite,
        ]);
        savedBudget = inserted[0];
        savedNote = insertedNote[0];
      } else {
        const [, insertedNote] = await db.batch([chartWrite, evolutionWrite, evolutionAuthorWrite]);
        savedNote = insertedNote[0];
      }
      const [verified] = await db.select({ data: toothStatuses.data }).from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      if (!verified) return error("No se pudo verificar el odontograma actualizado.", 503);
      if (budgetToInsert && budgetToInsert.length) {
        const [verifiedBudget] = await db.select().from(budgets).where(and(eq(budgets.id, savedBudget?.id ?? -1), eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId))).limit(1);
        if (!verifiedBudget) return error("El odontograma se guardó, pero no se pudo verificar el presupuesto preliminar.", 503);
        savedBudget = verifiedBudget;
      }
      const closedBudgets: Awaited<ReturnType<typeof budgetViewWithAuthor>>[] = [];
      for (const update of settled?.updates ?? []) {
        const base = storedBudgetData.get(update.budgetId);
        const [row] = await db.update(budgets).set({ items: encodeBudgetData(update.items, { isAlternative: base?.isAlternative ?? false, parentBudgetId: base?.parentBudgetId ?? null }) }).where(and(eq(budgets.id, update.budgetId), eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId))).returning();
        if (!row) return error("La evolución se guardó, pero no se pudo cerrar la prestación en el presupuesto.", 503);
        closedBudgets.push(await budgetViewWithAuthor(row, ownerId));
      }
      const [verifiedNote] = savedNote
        ? await db.select().from(evolutions).where(and(eq(evolutions.id, savedNote.id), eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId))).limit(1)
        : [];
      if (!verifiedNote) return error("El odontograma se guardó, pero no se pudo verificar la evolución clínica.", 503);
      return Response.json({
        odontogram: normalizeOdontogram(JSON.parse(verified.data)),
        ...(savedBudget ? { budget: await budgetViewWithAuthor(savedBudget, ownerId) } : {}),
        ...(closedBudgets.length ? { updatedBudgets: closedBudgets, closedItems: settled?.closed.map(item => item.label) ?? [] } : {}),
        note: { id: verifiedNote.id, patientId, date: displayDate(verifiedNote.clinicalDate), clinicalDate: verifiedNote.clinicalDate, recordedAt: verifiedNote.recordedAt, title: verifiedNote.title, body: verifiedNote.body, backupStatus: verifiedNote.backupStatus, status: verifiedNote.status, authorName: noteAuthor.authorName, authorEmail: noteAuthor.authorEmail, mine: true },
      });
    }

    if (action === "updatePatient") {
      const nameInput = typeof input.name === "string" ? input.name.trim() : patient.name;
      const normalizedName = normalizePatientName(nameInput), storedNormalizedName = normalizePatientName(patient.name);
      const nameParts = normalizedName.split(/\s+/).filter(Boolean);
      if (nameInput.length > 180 || !normalizedName || (normalizedName !== storedNormalizedName && nameParts.length < 2)) return error("Para cambiar el nombre de una ficha existente, ingresa al menos un nombre y un apellido.");
      if (normalizedName !== storedNormalizedName) {
        const otherPatients = await db.select({ id: patients.id, name: patients.name }).from(patients).where(eq(patients.ownerId, ownerId));
        if (otherPatients.some(other => other.id !== patientId && normalizePatientName(other.name) === normalizedName)) return error("Ya hay otra ficha con ese nombre. Verifica la identidad antes de actualizar.", 409);
      }
      const hasPhone = Object.prototype.hasOwnProperty.call(input, "phone");
      const hasEmail = Object.prototype.hasOwnProperty.call(input, "email");
      const phone = hasPhone && typeof input.phone === "string" ? string(input.phone, 24) : patient.phone;
      const email = hasEmail && typeof input.email === "string" ? string(input.email, 254) : patient.email;
      const hasBirthDate = Object.prototype.hasOwnProperty.call(input, "birthDate");
      const birthDateCandidate = typeof input.birthDate === "string" ? input.birthDate.trim() : "";
      const birthDate = birthDateCandidate ? string(birthDateCandidate, 10) : patient.birthDate;
      if ((hasPhone && !validPhone(phone)) || (hasEmail && !validEmail(email)) || (Object.prototype.hasOwnProperty.call(input, "profile") && !profilePhonesValid(normalizeProfile(input.profile)))) return error("Revisa el teléfono y el correo electrónico.");
      if (hasBirthDate && birthDateCandidate && (birthDateCandidate.length > 10 || !validDate(birthDate) || birthDate > dateInChile() || Number(birthDate.slice(0, 4)) < Number(dateInChile().slice(0, 4)) - 125)) return error("Revisa la fecha de nacimiento.");
      // Un RUT que no cambia (el mismo que ya tiene la ficha) no se revalida: guardar alergias o antecedentes no debe fallar por él.
      const rutSent = Object.prototype.hasOwnProperty.call(input, "rut") ? string(input.rut, 30).trim() : null;
      const hasRut = rutSent !== null && rutSent !== (patient.rut ?? "").trim();
      const rutRaw = hasRut ? rutSent ?? "" : "";
      const documentType = asDocumentType(input.documentType);
      if (hasRut && rutRaw && !isValidDocument(rutRaw, documentType)) return error(documentType === "extranjero" ? "Revisa el documento de identidad: de 4 a 20 letras o números, con al menos un número." : "Revisa el RUN / RUT y su dígito verificador.");
      const rut = rutRaw ? storedDocument(rutRaw, documentType) : null;
      if (rut) {
        const [duplicate] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut), ne(patients.id, patientId))).limit(1);
        if (duplicate) return error("Ya existe otro paciente con ese documento de identidad.", 409);
      }
      const hasAllergies = Object.prototype.hasOwnProperty.call(input, "allergies");
      const hasHistory = Object.prototype.hasOwnProperty.call(input, "history");
      const allergies = hasAllergies ? string(input.allergies, 2000) || "Sin registrar" : patient.allergies;
      const history = hasHistory ? string(input.history, 10000) || "Sin registrar" : patient.history;
      const changes = { name: nameInput, birthDate, phone, email, allergies, history, updatedAt: now(), ...(hasRut ? { rut } : {}) };
      const [updated] = await db.update(patients).set(changes).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).returning();
      const address = Object.prototype.hasOwnProperty.call(input, "address")
        ? await saveAddress(ownerId, patientId, input.address)
        : (await loadAddresses(ownerId)).get(patientId) ?? emptyAddress();
      const profile = Object.prototype.hasOwnProperty.call(input, "profile")
        ? await saveProfile(ownerId, patientId, input.profile)
        : (await loadProfiles(ownerId)).get(patientId) ?? emptyProfile();
      return Response.json({ patient: { ...updated, rut: updated.rut || "", address, profile } });
    }
    if (action === "addNote") {
      const title = string(input.title, 180) || "Evolución clínica", body = string(input.body, 30000);
      if (!body) return error("Escribe o dicta el registro clínico.");
      const t = now(), today = dateInChile();
      const dateInput = string(input.clinicalDate, 10);
      if (!attentionDateOk(dateInput)) return error("Revisa la fecha de atención: no puede ser futura.");
      const clinicalDate = dateInput || today;
      const requestId = string(input.requestId, 80) || null;
      if (requestId) {
        const [existing] = await db.select().from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.requestId, requestId)));
        if (existing && existing.patientId !== patientId) return error("Esta solicitud pertenece a otra ficha.", 409);
        if (existing) return Response.json({ note: { id: existing.id, patientId: existing.patientId, date: displayDate(existing.clinicalDate), clinicalDate: existing.clinicalDate, recordedAt: existing.recordedAt, title: existing.title, body: existing.body, backupStatus: existing.backupStatus } });
      }
      const [[n]] = await db.batch([db.insert(evolutions).values({ ownerId, patientId, clinicalDate, recordedAt: t, title, body, requestId, backupStatus: "not_configured" }).returning(), (await authorStatement(db, ownerId)).statement]);
      let chart;
      try { chart = await syncInstalledImplants(ownerId, patientId, body, t, n.id, clinicalDate); }
      catch { chart = { updatedTeeth: [], odontogram: null, warning: "Evolución guardada; revisa el odontograma, cuya actualización no pudo verificarse." }; }
      // Lo que esta evolución registra en otra especialidad (sesión/control de endodoncia): si se borra o anula, se deshace.
      const link = input.link && typeof input.link === "object" ? input.link as Record<string, unknown> : null;
      if (link && LINK_KINDS.includes(link.kind as LinkKind) && link.kind !== "perio" && typeof link.ref === "string" && /^[\w-]{1,60}:[\w-]{1,60}$/.test(link.ref)) {
        await addLink(ownerId, patientId, n.id, link.kind as LinkKind, link.ref).catch(() => undefined);
      }
      return Response.json({ note: { id: n.id, patientId, date: displayDate(clinicalDate), clinicalDate, recordedAt: t, title, body, backupStatus: n.backupStatus }, chart }, { status: 201 });
    }
    if (action === "updateEvolution") {
      // El dentista corrige a mano lo que el dictado o la IA entendió mal. Queda el texto anterior en un historial de ediciones.
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      const title = string(input.title, 180) || "Evolución clínica", body = string(input.body, 30000);
      if (!body) return error("La evolución no puede quedar vacía.");
      const [note] = await db.select().from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      if (note.status === "anulada") return error("Una evolución anulada no se puede editar.", 409);
      if (!await mayChangeEvolution(ownerId, evolutionId)) return error(NOT_AUTHOR, 403);
      if (note.title === title && note.body === body) return Response.json({ note: { id: note.id, patientId, title, body }, unchanged: true });
      const viewer = await getChatGPTUser();
      const t = now();
      const raw = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> }; run(): Promise<unknown> } } }).DB;
      if (!raw) return error("La base de datos no está disponible.", 500);
      await raw.prepare("CREATE TABLE IF NOT EXISTS evolution_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, evolution_id INTEGER NOT NULL, previous_title TEXT NOT NULL, previous_body TEXT NOT NULL, edited_by TEXT NOT NULL, edited_at TEXT NOT NULL)").run();
      await raw.prepare("INSERT INTO evolution_edits (owner_id, patient_id, evolution_id, previous_title, previous_body, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ownerId, patientId, evolutionId, note.title, note.body, viewer?.email || ownerId, t).run();
      await db.update(evolutions).set({ title, body }).where(and(eq(evolutions.id, evolutionId), eq(evolutions.ownerId, ownerId), eq(evolutions.status, "vigente")));
      return Response.json({ note: { id: evolutionId, patientId, title, body }, editedAt: t });
    }
    if (action === "annulEvolution") {
      // Ley 20.584: no se borra. Se marca anulada con motivo, fecha y autor; opcionalmente se guarda la que la reemplaza.
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      const reason = string(input.reason, 500);
      if (reason.length < 3) return error("Escribe el motivo de la anulación.");
      const replacementBody = string(input.replacementBody, 30000);
      const replacementTitle = string(input.replacementTitle, 180) || "Evolución clínica";
      const [note] = await db.select().from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      if (note.status === "anulada") return error("Esta evolución ya estaba anulada.", 409);
      if (!await mayChangeEvolution(ownerId, evolutionId)) return error(NOT_AUTHOR, 403);
      const viewer = await getChatGPTUser();
      const t = now(), annulledBy = viewer?.email || ownerId;
      const annul = db.update(evolutions).set({ status: "anulada", annulledAt: t, annulledBy, annulReason: reason }).where(and(eq(evolutions.id, evolutionId), eq(evolutions.ownerId, ownerId), eq(evolutions.status, "vigente")));
      let replacement: typeof evolutions.$inferSelect | undefined;
      if (replacementBody) {
        const clinicalDate = dateInChile();
        const [, inserted] = await db.batch([annul, db.insert(evolutions).values({ ownerId, patientId, clinicalDate, recordedAt: t, title: replacementTitle, body: replacementBody, replacesId: evolutionId, backupStatus: "not_configured" }).returning(), (await authorStatement(db, ownerId)).statement]);
        replacement = inserted[0];
      } else await annul;
      const revertedTeeth = await revertChartOf(db, ownerId, patientId, evolutionId).catch(() => null);
      const revertedLinks = await revertLinkedRecords(db, ownerId, patientId, evolutionId).catch(() => null);
      let chart;
      if (replacement) {
        try { chart = await syncInstalledImplants(ownerId, patientId, replacementBody, t, replacement.id, replacement.clinicalDate); }
        catch { chart = { updatedTeeth: [], odontogram: null, warning: "Evolución guardada; revisa el odontograma, cuya actualización no pudo verificarse." }; }
      }
      return Response.json({
        annulled: { id: evolutionId, status: "anulada", annulledAt: t, annulledBy, annulReason: reason },
        revertedTeeth,
        revertedLinks,
        ...(replacement ? { note: { id: replacement.id, patientId, date: displayDate(replacement.clinicalDate), clinicalDate: replacement.clinicalDate, recordedAt: t, title: replacement.title, body: replacement.body, backupStatus: replacement.backupStatus, status: "vigente", replacesId: evolutionId }, chart } : {}),
      });
    }
    if (action === "deleteEvolution") {
      // «Error del sistema»: la evolución sale de la ficha, pero NO se destruye (Ley 20.584: la ficha se conserva).
      // Antes de quitarla se archiva una copia íntegra (texto, fechas, autor de la acción, diagnósticos) en evolution_removals,
      // que sirve además de registro de auditoría. Los cambios de odontograma ligados se deshacen (revertChartOf). Pagos, citas y presupuestos no se tocan.
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      if (input.confirm !== "eliminar") return error("Falta confirmar la eliminación.");
      const replacementBody = string(input.replacementBody, 30000);
      const replacementTitle = string(input.replacementTitle, 180) || "Evolución clínica";
      const [note] = await db.select({ id: evolutions.id }).from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      if (!await mayChangeEvolution(ownerId, evolutionId)) return error(NOT_AUTHOR, 403);
      const t = now();
      const archived = await archiveEvolution(ownerId, patientId, evolutionId, (await getChatGPTUser())?.email || ownerId, t);
      if (!archived) return error("No se pudo guardar la copia de respaldo de la evolución; no se quitó de la ficha.", 500);
      const removeTags = db.delete(evolutionDiagnoses).where(and(eq(evolutionDiagnoses.evolutionId, evolutionId), eq(evolutionDiagnoses.ownerId, ownerId)));
      const removeNote = db.delete(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId)));
      let replacement: typeof evolutions.$inferSelect | undefined;
      if (replacementBody) {
        const [, , inserted] = await db.batch([removeTags, removeNote, db.insert(evolutions).values({ ownerId, patientId, clinicalDate: dateInChile(), recordedAt: t, title: replacementTitle, body: replacementBody, backupStatus: "not_configured" }).returning(), (await authorStatement(db, ownerId)).statement]);
        replacement = inserted[0];
      } else await db.batch([removeTags, removeNote]);
      const revertedTeeth = await revertChartOf(db, ownerId, patientId, evolutionId).catch(() => null);
      const revertedLinks = await revertLinkedRecords(db, ownerId, patientId, evolutionId).catch(() => null);
      let chart;
      if (replacement) {
        try { chart = await syncInstalledImplants(ownerId, patientId, replacementBody, t, replacement.id, replacement.clinicalDate); }
        catch { chart = { updatedTeeth: [], odontogram: null, warning: "Evolución guardada; revisa el odontograma, cuya actualización no pudo verificarse." }; }
      }
      return Response.json({
        deleted: { id: evolutionId },
        revertedTeeth,
        revertedLinks,
        ...(replacement ? { note: { id: replacement.id, patientId, date: displayDate(replacement.clinicalDate), clinicalDate: replacement.clinicalDate, recordedAt: t, title: replacement.title, body: replacement.body, backupStatus: replacement.backupStatus, status: "vigente" }, chart } : {}),
      });
    }
    if (action === "setEvolutionDiagnoses") {
      // Reemplaza las etiquetas confirmadas de una evolución (idempotente: reenviar deja lo mismo).
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      const parsed = sanitizeDiagnosisTags(input.tags);
      if ("error" in parsed) return error(parsed.error);
      const [note] = await db.select().from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      if (!await mayChangeEvolution(ownerId, evolutionId)) return error(NOT_AUTHOR, 403);
      const t = now();
      const remove = db.delete(evolutionDiagnoses).where(and(eq(evolutionDiagnoses.evolutionId, evolutionId), eq(evolutionDiagnoses.ownerId, ownerId)));
      const inserts = parsed.tags.map(tag => db.insert(evolutionDiagnoses).values({ ownerId, patientId, evolutionId, code: tag.code, title: tag.title, tooth: tag.tooth, findings: tag.findings, evidence: tag.evidence, origin: tag.origin, suggestedFrom: tag.suggestedFrom, createdAt: t }));
      await db.batch([remove, ...inserts]);
      const toothTags = parsed.tags.filter(tag => typeof tag.tooth === "number" && Number.isSafeInteger(tag.tooth) && allowedTeeth.has(tag.tooth));
      if (toothTags.length) {
        const [oldChart] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
        const data = normalizeOdontogram(oldChart ? JSON.parse(oldChart.data) : {});
        let addedDiagnosis = false;
        for (const tag of toothTags) {
          const tooth = tag.tooth;
          if (typeof tooth !== "number") continue;
          const sourceActionId = ("diagnosis:" + tooth + ":" + tag.code + ":" + (tag.findings || tag.title)).slice(0, 180);
          if (data.history?.some(event => event.sourceEvolutionId === evolutionId && event.sourceActionId === sourceActionId)) continue;
          const before = toothHistorySnapshot(data, tooth);
          const previousCount = data.history?.length ?? 0;
          appendToothHistory(data, tooth, "diagnosis", before, {
            recordedAt: t, clinicalDate: note.clinicalDate, source: "evolution", sourceEvolutionId: evolutionId,
            sourceActionId, title: tag.title, detail: tag.findings || tag.evidence,
          });
          if ((data.history?.length ?? 0) > previousCount) addedDiagnosis = true;
        }
        if (addedDiagnosis) {
          await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt: t })
            .onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt: t } });
        }
      }
      const saved = await db.select().from(evolutionDiagnoses).where(and(eq(evolutionDiagnoses.evolutionId, evolutionId), eq(evolutionDiagnoses.ownerId, ownerId))).orderBy(evolutionDiagnoses.id);
      return Response.json({ evolutionId, diagnoses: saved.map(diagnosisView) });
    }
    if (action === "syncEvolutionOdontogram") {
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      const [note] = await db.select().from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      const chart = await syncInstalledImplants(ownerId, patientId, note.body, note.recordedAt, note.id, note.clinicalDate);
      return Response.json({ chart });
    }
    if (action === "addBudget") {
      const title = string(input.title, 180);
      const rawItems = input.items === undefined ? [{ label: string(input.label, 180), amount: Number(input.amount), code: string(input.code, 7) }] : input.items;
      const items = normalizeBudgetItems(rawItems, input.allowUndefinedValues === true);
      if (!title || !items) return error("Revisa el nombre del plan y cada prestación, su fase, valor y descuento.");
      const parentBudgetId = input.parentBudgetId === undefined || input.parentBudgetId === null || input.parentBudgetId === "" ? null : Number(input.parentBudgetId);
      if (parentBudgetId !== null) {
        if (!Number.isSafeInteger(parentBudgetId) || parentBudgetId < 1) return error("Plan principal inválido.");
        const [parent] = await db.select().from(budgets).where(and(eq(budgets.id, parentBudgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).limit(1);
        if (!parent) return error("Plan principal no encontrado en esta ficha.", 404);
        const parentData = decodeBudgetData(parent.items);
        if (parentData.isAlternative) return error("Una alternativa debe vincularse a un plan principal.", 409);
        const [linkedPayment] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId), eq(payments.budgetId, parent.id))).limit(1);
        if (linkedPayment) return error("No se pueden crear alternativas después de registrar abonos en el plan principal.", 409);
        const patientBudgets = await db.select().from(budgets).where(and(eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId)));
        const alternativeCount = patientBudgets.filter(row => {
          const data = decodeBudgetData(row.items);
          return data.isAlternative && data.parentBudgetId === parent.id;
        }).length;
        if (alternativeCount >= 12) return error("Este plan ya tiene el máximo de 12 alternativas.", 409);
      }
      const t = now();
      const itemsData = encodeBudgetData(items, { isAlternative: parentBudgetId !== null, parentBudgetId });
      // La fecha de la atención dictada (hoy o pasada) es la del presupuesto.
      const budgetDate = string(input.clinicalDate, 10);
      const createdAt = /^\d{4}-\d{2}-\d{2}$/.test(budgetDate) && !Number.isNaN(Date.parse(budgetDate)) && budgetDate <= t.slice(0, 10) ? `${budgetDate}T12:00:00.000Z` : t;
      const [[b]] = await db.batch([db.insert(budgets).values({ ownerId, patientId, title, items: itemsData, status: "Borrador", createdAt }).returning(), (await budgetAuthorStatement(db, ownerId)).statement]);
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) }, { status: 201 });
    }
    if (action === "updateBudget") {
      const budgetId = Number(input.budgetId), title = string(input.title, 180);
      const rawItems = input.items === undefined ? [{ label: string(input.label, 180), amount: Number(input.amount) }] : input.items;
      const items = normalizeBudgetItems(rawItems, input.allowUndefinedValues === true);
      if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !title || !items) return error("Revisa el nombre del plan y cada prestación, su fase, valor y descuento.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      if (!(await budgetAccess(ownerId, budgetId)).editable) return error(NOT_BUDGET_OWNER, 403);
      const relationship = decodeBudgetData(existing.items);
      const updatedTotal = budgetTotals(items).total;
      if (updatedTotal < budgetTotals(relationship.items).total) {
        const linkedPayments = await db.select({ amount: payments.amount }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId), eq(payments.budgetId, budgetId)));
        const paid = linkedPayments.reduce((sum, payment) => sum + payment.amount, 0);
        if (updatedTotal < paid) return error("El total del plan no puede quedar por debajo de los pagos ya registrados. Revisa los abonos antes de reducirlo.", 409);
      }
      const [b] = await db.update(budgets).set({ title, items: encodeBudgetData(items, relationship) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "setBudgetStatus") {
      // «Alta» es la única marca manual del estado del plan; el resto (sin iniciar, en tratamiento, terminado, expirado) se calcula.
      const budgetId = Number(input.budgetId), alta = input.alta === true;
      if (!Number.isSafeInteger(budgetId) || budgetId < 1) return error("Presupuesto inválido.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      if (!(await budgetAccess(ownerId, budgetId)).editable) return error(NOT_BUDGET_OWNER, 403);
      const [b] = await db.update(budgets).set({ status: alta ? "Alta" : "Borrador" }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "removeBudgetItem") {
      // Quita una prestación del plan (ej. desde el odontograma). No deja el total bajo lo ya abonado.
      const budgetId = Number(input.budgetId), index = Number(input.index);
      if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !Number.isInteger(index) || index < 0) return error("Prestación inválida.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      if (!(await budgetAccess(ownerId, budgetId)).editable) return error(NOT_BUDGET_OWNER, 403);
      const data = decodeBudgetData(existing.items);
      if (index >= data.items.length) return error("La prestación ya no existe en este plan.", 404);
      const items = data.items.filter((_, itemIndex) => itemIndex !== index);
      const linkedPayments = await db.select({ amount: payments.amount }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId), eq(payments.budgetId, budgetId)));
      const paid = linkedPayments.reduce((sum, payment) => sum + payment.amount, 0);
      if (!items.length) {
        // Era la única prestación: el plan queda vacío y se elimina completo (los planes que nacen de un dictado suelen tener una sola).
        if (linkedPayments.length) return error("Este plan tiene abonos registrados; no se puede eliminar. Revisa los abonos antes.", 409);
        await db.delete(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
        const teamHandle = teamDb();
        if (teamHandle) await teamHandle.prepare("DELETE FROM budget_authors WHERE owner_id = ? AND budget_id = ?").bind(ownerId, budgetId).run().catch(() => undefined);
        return Response.json({ removedBudgetId: budgetId });
      }
      if (budgetTotals(items).total < paid) return error("Al quitar esta prestación el total quedaría bajo los pagos ya registrados. Revisa los abonos antes.", 409);
      const [b] = await db.update(budgets).set({ items: encodeBudgetData(items, data) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "setBudgetItemDone") {
      const budgetId = Number(input.budgetId), index = Number(input.index);
      const done = input.done === true;
      const doneOn = typeof input.doneOn === "string" ? input.doneOn : "";
      if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !Number.isInteger(index) || index < 0) return error("Prestación inválida.");
      if (done && !validIsoDate(doneOn)) return error("Indica la fecha en que se realizó la prestación.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      const data = decodeBudgetData(existing.items);
      if (data.isAlternative) return error("Las alternativas son solo cotizaciones; establece esta opción como plan principal para registrar avances.", 409);
      if (index >= data.items.length) return error("La prestación ya no existe en este plan.", 404);
      const items = data.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const { doneOn: _previous, ...rest } = item;
        return done ? { ...rest, doneOn } : rest;
      });
      const [b] = await db.update(budgets).set({ items: encodeBudgetData(items, data) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "saveEvolutionPieces") {
      const evolutionId = Number(input.evolutionId);
      const pieces = sanitizeChips(input.pieces);
      if (!Number.isSafeInteger(evolutionId) || evolutionId < 1) return error("Evolución inválida.");
      const [note] = await db.select({ id: evolutions.id }).from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId)));
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      const raw = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> }; run(): Promise<unknown> } } }).DB;
      if (!raw) return error("La base de datos no está disponible.", 500);
      await raw.prepare(EVOLUTION_PIECES_DDL).run();
      await raw.prepare("INSERT INTO evolution_pieces (owner_id, evolution_id, pieces, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, evolution_id) DO UPDATE SET pieces = excluded.pieces, updated_at = excluded.updated_at").bind(ownerId, evolutionId, JSON.stringify(pieces), now()).run();
      return Response.json({ evolutionId, pieces });
    }
    if (action === "setBudgetItemStatus") {
      // Estado del ítem como en Dentalsoft: Pendiente / Iniciada / Terminada (con fecha) / Desevolución.
      const budgetId = Number(input.budgetId), index = Number(input.index);
      const status = typeof input.status === "string" ? input.status : "";
      const date = typeof input.date === "string" ? input.date : "";
      if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !Number.isInteger(index) || index < 0) return error("Prestación inválida.");
      if (!(ITEM_STATUSES as readonly string[]).includes(status)) return error("Estado inválido.");
      if ((status === "iniciada" || status === "terminada") && !validIsoDate(date)) return error("Indica la fecha del avance.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      const data = decodeBudgetData(existing.items);
      if (data.isAlternative) return error("Las alternativas son solo cotizaciones; establece esta opción como plan principal para registrar avances.", 409);
      if (index >= data.items.length) return error("La prestación ya no existe en este plan.", 404);
      const professional = string(input.professional, 80);
      const items = data.items.map((item, itemIndex) => itemIndex !== index ? item : { ...withItemStatus(item, status as ItemStatus, date || now().slice(0, 10)), ...(professional ? { professional } : {}) });
      const [b] = await db.update(budgets).set({ items: encodeBudgetData(items, data) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "addBudgetItems") {
      // «Presupuestar» desde la evolución: agrega ítems a un presupuesto abierto (no alternativa) o crea uno nuevo.
      const items = normalizeBudgetItems(input.items, true);
      if (!items || !items.length) return error("Revisa las prestaciones a presupuestar.");
      const budgetId = input.budgetId === undefined || input.budgetId === null || input.budgetId === "" ? null : Number(input.budgetId);
      if (budgetId === null) {
        const title = string(input.title, 180) || "Presupuesto";
        const budgetDate = string(input.clinicalDate, 10);
        const t = now();
        const createdAt = /^\d{4}-\d{2}-\d{2}$/.test(budgetDate) && !Number.isNaN(Date.parse(budgetDate)) && budgetDate <= t.slice(0, 10) ? `${budgetDate}T12:00:00.000Z` : t;
        const [[b]] = await db.batch([db.insert(budgets).values({ ownerId, patientId, title, items: encodeBudgetData(items, { isAlternative: false, parentBudgetId: null }), status: "Borrador", createdAt }).returning(), (await budgetAuthorStatement(db, ownerId)).statement]);
        return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) }, { status: 201 });
      }
      if (!Number.isSafeInteger(budgetId) || budgetId < 1) return error("Presupuesto inválido.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      if (!(await budgetAccess(ownerId, budgetId)).editable) return error(NOT_BUDGET_OWNER, 403);
      const data = decodeBudgetData(existing.items);
      if (data.isAlternative) return error("Las alternativas son solo cotizaciones; agrega la prestación al plan principal.", 409);
      const merged = normalizeBudgetItems([...data.items, ...items], true);
      if (!merged) return error("El presupuesto quedaría con más prestaciones de las permitidas; crea uno nuevo.", 409);
      const [b] = await db.update(budgets).set({ items: encodeBudgetData(merged, data) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: await budgetViewWithAuthor(b, ownerId) });
    }
    if (action === "selectBudgetAlternative") {
      const budgetId = Number(input.budgetId);
      if (!Number.isSafeInteger(budgetId) || budgetId < 1) return error("Alternativa inválida.");
      const patientBudgets = await db.select().from(budgets).where(and(eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId)));
      const selected = patientBudgets.find(row => row.id === budgetId);
      if (!selected) return error("Alternativa no encontrada en esta ficha.", 404);
      const selectedData = decodeBudgetData(selected.items);
      if (!selectedData.isAlternative || !selectedData.parentBudgetId) return error("Este presupuesto no es una alternativa seleccionable.", 409);
      const currentPrimary = patientBudgets.find(row => row.id === selectedData.parentBudgetId);
      if (!currentPrimary) return error("El plan principal asociado ya no existe.", 409);
      const primaryData = decodeBudgetData(currentPrimary.items);
      if (primaryData.isAlternative) return error("El grupo de alternativas requiere revisión antes de cambiar el plan principal.", 409);
      if (!(await budgetAccess(ownerId, currentPrimary.id)).editable || !(await budgetAccess(ownerId, selected.id)).editable) return error(NOT_BUDGET_OWNER, 403);
      const [linkedPayment] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId), eq(payments.budgetId, currentPrimary.id))).limit(1);
      if (linkedPayment) return error("Este plan principal tiene abonos asociados. No se cambió el plan para conservar el historial de pagos.", 409);

      const siblings = patientBudgets.filter(row => row.id !== selected.id && row.id !== currentPrimary.id).filter(row => {
        const data = decodeBudgetData(row.items);
        return data.isAlternative && data.parentBudgetId === currentPrimary.id;
      });
      const updates = [
        db.update(budgets).set({ items: encodeBudgetData(primaryData.items, { isAlternative: true, parentBudgetId: selected.id }) }).where(and(eq(budgets.id, currentPrimary.id), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))),
        db.update(budgets).set({ items: encodeBudgetData(selectedData.items, { isAlternative: false, parentBudgetId: null }) }).where(and(eq(budgets.id, selected.id), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))),
        ...siblings.map(row => {
          const data = decodeBudgetData(row.items);
          return db.update(budgets).set({ items: encodeBudgetData(data.items, { isAlternative: true, parentBudgetId: selected.id }) }).where(and(eq(budgets.id, row.id), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
        }),
      ];
      await db.batch(updates as [typeof updates[number], ...Array<typeof updates[number]>]);
      const refreshed = await db.select().from(budgets).where(and(eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId))).orderBy(desc(budgets.id));
      const authorsDb = teamDb();
      const authorMap = authorsDb ? await budgetAuthorsOf(authorsDb, ownerId).catch(() => undefined) : new Map();
      return Response.json({ budgets: await Promise.all(refreshed.map(row => budgetViewWithAuthor(row, ownerId, authorMap))) });
    }
    if (action === "addAppointment") {
      const day = string(input.day, 10), time = string(input.time, 5), reason = string(input.reason, 500);
      if (!validDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !reason) return error("Revisa fecha, hora y motivo.");
      // Lugar de atención: solo un box habilitado de la clínica.
      const boxName = string(input.box, 60);
      const boxRow = boxName ? (await (await import("@/app/box-db")).listBoxes(ownerId)).find(b => b.enabled && b.name === boxName) : undefined;
      const box = boxRow?.name;
      if (boxName && !box) return error("Ese box no está disponible.");
      const [a] = await db.insert(appointments).values({ ownerId, patientId, day, time, reason, createdAt: now() }).returning();
      // Duración elegida al agendar (módulos de 15 min, hasta 4 h); sin ella la cita queda de 30 min.
      const rawMinutes = Number(input.minutes);
      const minutes = Number.isInteger(rawMinutes) && rawMinutes >= 15 && rawMinutes <= 240 && rawMinutes % 15 === 0 ? rawMinutes : null;
      if (minutes) {
        await (await import("@/app/calendar-two-way")).ensureTwoWay();
        await (await import("@/app/box-db")).db()?.prepare("UPDATE appointments SET minutes = ? WHERE owner_id = ? AND id = ?").bind(minutes, ownerId, a.id).run();
      }
      // Agenda por box: la cita queda en la columna de su box (box_id; listBoxes ya creó la columna).
      if (boxRow) await (await import("@/app/box-db")).db()?.prepare("UPDATE appointments SET box_id = ? WHERE owner_id = ? AND id = ?").bind(boxRow.id, ownerId, a.id).run();
      const [who] = await db.select({ name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
      const { pushAppointmentToGoogle } = await import("@/app/drive-oauth");
      const calendar = await pushAppointmentToGoogle(ownerId, { id: a.id, day, time, reason, ...(minutes ? { minutes } : {}), ...(box ? { box } : {}) }, who?.name || "", patientId).catch(() => "error" as const);
      return Response.json({ appointment: { id: a.id, patientId, day: day.split("-").reverse().join("-"), time, reason, ...(minutes ? { minutes } : {}) }, calendar }, { status: 201 });
    }
    if (action === "addPayment") {
      const amount = Number(input.amount), method = string(input.method, 20), concept = string(input.concept, 240);
      const paidOn = string(input.paidOn, 10) || dateInChile();
      const budgetId = input.budgetId === undefined || input.budgetId === null || input.budgetId === "" ? null : Number(input.budgetId);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000 || !PAYMENT_METHODS.has(method) || !validDate(paidOn) || paidOn > dateInChile()) return error("Revisa el monto, el medio de pago y la fecha.");
      let budgetTotal: number | null = null;
      let allocations: Allocation[] = [];
      if (budgetId !== null) {
        if (!Number.isSafeInteger(budgetId) || budgetId < 1) return error("Presupuesto inválido.");
        const [budget] = await db.select({ id: budgets.id, items: budgets.items }).from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
        if (!budget) return error("Presupuesto no encontrado en esta ficha.", 404);
        const budgetData = decodeBudgetData(budget.items);
        if (budgetData.isAlternative) return error("No se pueden asociar pagos a una alternativa. Establécela primero como plan principal.", 409);
        budgetTotal = budgetTotals(budgetData.items).total;
        const parsed = sanitizeAllocations(input.allocations, budgetData.items, amount);
        if (!parsed) return error("Revisa los ítems a los que se aplica el abono.");
        allocations = parsed;
      } else if (input.allocations !== undefined && input.allocations !== null && !(Array.isArray(input.allocations) && !input.allocations.length)) return error("Un abono por ítem necesita su presupuesto.");
      const requestId = string(input.requestId, 80) || null;
      if (requestId) {
        const [existing] = await db.select().from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.requestId, requestId)));
        if (existing && existing.patientId !== patientId) return error("Esta solicitud pertenece a otra ficha.", 409);
        if (existing) return Response.json({ payment: paymentView(existing) });
      }
      if (budgetId !== null && budgetTotal !== null) {
        const existingPayments = await db.select({ amount: payments.amount }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId), eq(payments.budgetId, budgetId)));
        const paid = existingPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const balance = Math.max(0, budgetTotal - paid);
        if (amount > balance) return error("El monto supera el saldo pendiente del tratamiento. Revisa el total y los abonos ya registrados.", 409);
      }
      const [p] = await db.insert(payments).values({ ownerId, patientId, budgetId, amount, method, concept, paidOn, requestId, createdAt: now() }).returning();
      if (allocations.length && budgetId !== null) {
        const raw = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> }; run(): Promise<unknown> } } }).DB;
        if (raw) {
          await raw.prepare(PAYMENT_ALLOCATIONS_DDL).run();
          await raw.prepare(PAYMENT_ALLOCATIONS_INDEX).run();
          const t = now();
          for (const allocation of allocations) await raw.prepare("INSERT INTO payment_allocations (owner_id, payment_id, budget_id, item_index, item_label, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ownerId, p.id, budgetId, allocation.index, allocation.label, allocation.amount, t).run();
        }
      }
      return Response.json({ payment: { ...paymentView(p), ...(allocations.length ? { allocations } : {}) } }, { status: 201 });
    }
    if (action === "updateAppointment") {
      const appointmentId = Number(input.appointmentId), day = string(input.day, 10), time = string(input.time, 5), reason = string(input.reason, 500);
      if (!Number.isSafeInteger(appointmentId) || appointmentId < 1 || !validDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !reason) return error("Revisa fecha, hora y motivo.");
      const [a] = await db.update(appointments).set({ day, time, reason }).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId), eq(appointments.ownerId, ownerId))).returning();
      if (!a) return error("Cita no encontrada en esta ficha.", 404);
      // Si la cita es la de un próximo control, el control sigue la nueva fecha.
      await import("@/app/followup-db").then(m => m.controlFollowsAppointment(ownerId, a.id, { day: a.day })).catch(() => undefined);
      const [who] = await db.select({ name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
      const { rescheduleAppointmentInGoogle } = await import("@/app/drive-oauth");
      const calendar = await rescheduleAppointmentInGoogle(ownerId, a.id, { day, time, title: [who?.name || "", reason].filter(Boolean).join(" · ") }).catch(() => "error" as const);
      return Response.json({ appointment: { id: a.id, patientId, day: a.day.split("-").reverse().join("-"), time: a.time, reason: a.reason }, calendar });
    }
    if (action === "deleteAppointment") {
      const appointmentId = Number(input.appointmentId);
      if (!Number.isSafeInteger(appointmentId) || appointmentId < 1) return error("Cita inválida.");
      const [a] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId), eq(appointments.ownerId, ownerId)));
      if (!a) return error("Cita no encontrada en esta ficha.", 404);
      const { deleteAppointmentEverywhere } = await import("@/app/drive-oauth");
      const calendar = await deleteAppointmentEverywhere(ownerId, a.id);
      return Response.json({ deleted: true, calendar });
    }
    if (action === "updateAppointmentReason") {
      const appointmentId = Number(input.appointmentId), reason = string(input.reason, 500);
      if (!Number.isSafeInteger(appointmentId) || appointmentId < 1 || !reason) return error("Revisa la cita y el motivo.");
      const [a] = await db.update(appointments).set({ reason }).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId), eq(appointments.ownerId, ownerId))).returning();
      if (!a) return error("Cita no encontrada en esta ficha.", 404);
      const [who] = await db.select({ name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
      const { updateAppointmentInGoogle } = await import("@/app/drive-oauth");
      const calendar = await updateAppointmentInGoogle(ownerId, a.id, who?.name || "", a.reason).catch(() => "error" as const);
      return Response.json({ appointment: { id: a.id, patientId, day: a.day.split("-").reverse().join("-"), time: a.time, reason: a.reason }, calendar });
    }
    if (action === "savePerio") {
      if (!validPerioTeeth(input.teeth) || JSON.stringify(input.teeth).length > 150000) return error("Examen periodontal inválido.");
      const validEpbCodes = new Set(["0","1","2","3","4","*"]), validSextants = new Set(["1","2","3","4","5","6"]);
      if (input.epb !== undefined && (!input.epb || typeof input.epb !== "object" || Array.isArray(input.epb) || Object.entries(input.epb).some(([key,value])=>!validSextants.has(key)||!validEpbCodes.has(String(value))))) return error("Códigos EPB inválidos.");
      if (input.classification !== undefined) {
        if (!input.classification || typeof input.classification !== "object" || Array.isArray(input.classification)) return error("Clasificación periodontal inválida.");
        const c=input.classification as Record<string,unknown>;
        if (c.system!=="AAP-EFP 2017" || (c.stage!==undefined&&!['I','II','III','IV'].includes(String(c.stage))) || (c.grade!==undefined&&!['A','B','C'].includes(String(c.grade))) || (c.extent!==undefined&&!['localized','generalized','molar-incisor'].includes(String(c.extent)))) return error("Clasificación periodontal inválida.");
      }
      const savedData={teeth:input.teeth,epb:input.epb,classification:input.classification};
      const examDate = string(input.clinicalDate, 10);
      if (!attentionDateOk(examDate)) return error("Revisa la fecha de atención: no puede ser futura.");
      const [e] = await db.insert(periodontalExams).values({ ownerId, patientId, recordedAt: examDate ? `${examDate}T15:00:00.000Z` : now(), teeth: JSON.stringify(savedData) }).returning();
      // Examen dictado junto a una evolución: queda ligado, y si la evolución se borra o anula el examen se elimina.
      const linkedEvolution = Number(input.evolutionId);
      if (Number.isSafeInteger(linkedEvolution) && linkedEvolution > 0) {
        const [owned] = await db.select({ id: evolutions.id }).from(evolutions).where(and(eq(evolutions.id, linkedEvolution), eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId))).limit(1);
        if (owned) await addLink(ownerId, patientId, linkedEvolution, "perio", String(e.id)).catch(() => undefined);
      }
      return Response.json({ exam: { id: e.id, recordedAt: e.recordedAt, ...savedData } }, { status: 201 });
    }
    if (action === "deleteToothHistoryEvent") {
      // Quita un hito de la línea de tiempo de la pieza. No cambia el estado actual: ese se corrige con los controles de la pieza.
      const eventId = string(input.eventId, 200);
      if (!eventId) return error("Hito inválido.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      if (!old) return error("Hito no encontrado.", 404);
      const data = normalizeOdontogram(JSON.parse(old.data));
      const before = data.history?.length ?? 0;
      data.history = (data.history ?? []).filter(event => event.id !== eventId);
      if (data.history.length === before) return error("Hito no encontrado en esta ficha.", 404);
      const updatedAt = now();
      await db.update(toothStatuses).set({ data: JSON.stringify(data), updatedAt }).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      return Response.json({ odontogram: data });
    }
    if (action === "updateToothHistoryEvent") {
      // Corrige fecha, título o detalle de un hito de la pieza (registro mal anotado). No cambia el estado actual.
      const eventId = string(input.eventId, 200), title = string(input.title, 180), detail = string(input.detail, 400), clinicalDate = string(input.clinicalDate, 10);
      if (!eventId || !title) return error("El hito necesita un título.");
      if (clinicalDate && !attentionDateOk(clinicalDate)) return error("Revisa la fecha: no puede ser futura.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      if (!old) return error("Hito no encontrado.", 404);
      const data = normalizeOdontogram(JSON.parse(old.data));
      const event = (data.history ?? []).find(item => item.id === eventId);
      if (!event) return error("Hito no encontrado en esta ficha.", 404);
      event.title = title;
      if (detail) event.detail = detail; else delete event.detail;
      if (clinicalDate) event.clinicalDate = clinicalDate;
      await db.update(toothStatuses).set({ data: JSON.stringify(data), updatedAt: now() }).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      return Response.json({ odontogram: data });
    }
    if (action === "updatePerioToothReading") {
      // Corrige la medición de una pieza en un examen (y, si se pide, la fecha del examen).
      const examId = Number(input.examId), tooth = Number(input.tooth), clinicalDate = string(input.clinicalDate, 10);
      if (!Number.isSafeInteger(examId) || examId <= 0 || !Number.isSafeInteger(tooth)) return error("Examen o pieza inválidos.");
      if (!validPerioTeeth({ [tooth]: input.reading })) return error("Medición periodontal inválida.");
      if (clinicalDate && !attentionDateOk(clinicalDate)) return error("Revisa la fecha: no puede ser futura.");
      const [exam] = await db.select().from(periodontalExams).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.patientId, patientId), eq(periodontalExams.ownerId, ownerId))).limit(1);
      if (!exam) return error("Examen no encontrado en esta ficha.", 404);
      const saved = JSON.parse(exam.teeth) as { teeth?: Record<string, unknown> };
      const teeth = { ...(saved.teeth ?? {}), [String(tooth)]: input.reading };
      const recordedAt = clinicalDate ? `${clinicalDate}T15:00:00.000Z` : exam.recordedAt;
      await db.update(periodontalExams).set({ teeth: JSON.stringify({ ...saved, teeth }), recordedAt }).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.ownerId, ownerId)));
      return Response.json({ exam: { id: exam.id, recordedAt, ...saved, teeth } });
    }
    if (action === "deletePerioToothReading") {
      // Quita la medición de una pieza en un examen; si el examen queda sin piezas, se elimina completo.
      const examId = Number(input.examId), tooth = Number(input.tooth);
      if (!Number.isSafeInteger(examId) || examId <= 0 || !Number.isSafeInteger(tooth)) return error("Examen o pieza inválidos.");
      const [exam] = await db.select().from(periodontalExams).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.patientId, patientId), eq(periodontalExams.ownerId, ownerId))).limit(1);
      if (!exam) return error("Examen no encontrado en esta ficha.", 404);
      const saved = JSON.parse(exam.teeth) as { teeth?: Record<string, unknown>; epb?: unknown; classification?: unknown };
      const teeth = { ...(saved.teeth ?? {}) };
      if (!(String(tooth) in teeth)) return error("La pieza no tiene medición en ese examen.", 404);
      delete teeth[String(tooth)];
      if (Object.keys(teeth).length === 0) {
        await db.delete(periodontalExams).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.ownerId, ownerId)));
        return Response.json({ examId, deleted: true });
      }
      await db.update(periodontalExams).set({ teeth: JSON.stringify({ ...saved, teeth }) }).where(and(eq(periodontalExams.id, examId), eq(periodontalExams.ownerId, ownerId)));
      return Response.json({ examId, deleted: false, exam: { id: exam.id, recordedAt: exam.recordedAt, ...saved, teeth } });
    }
    if (action === "addToothNote") {
      // Evolución escrita a mano de una pieza: un hito fechado sin cambiar su estado.
      const tooth = Number(input.tooth), text = string(input.text, 400), clinicalDate = string(input.clinicalDate, 10) || dateInChile();
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !text) return error("Escribe la evolución de la pieza.");
      if (!attentionDateOk(clinicalDate)) return error("Revisa la fecha: no puede ser futura.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      const updatedAt = now();
      appendToothHistory(data, tooth, "diagnosis", toothHistorySnapshot(data, tooth), { recordedAt: updatedAt, source: "manual", title: "Evolución de la pieza", detail: text, clinicalDate });
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      return Response.json({ odontogram: data });
    }
    if (action === "setToothStatus") {
      const tooth = Number(input.tooth), status = string(input.status, 48);
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !ALL_TOOTH_STATUSES.includes(status)) return error("Estado dental inválido.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      const historyMeta = await chartHistoryMetadata(status === "Sin hallazgos" ? "Estado registrado: sin hallazgos" : "Estado actualizado: " + status);
      if ("error" in historyMeta) return error(historyMeta.error);
      if (historyAlreadyRecorded(data, historyMeta)) return Response.json({ odontogram: data });
      const before = toothHistorySnapshot(data, tooth);
      applyStatusToChart(data, tooth, status);
      // Coherencia: una pieza ausente o con implante no tiene caras de diente natural (quedan en el historial);
      // una pieza natural no conserva la causa de pérdida (salvo la indicación de exodoncia, que la usa para el COP-D).
      // Una lesión que se suma a otro estado principal no debe borrar la corona, las caras ni la causa de pérdida de ese estado.
      const effective = isLesionStatus(status) && data.teeth[tooth] ? data.teeth[tooth] : status;
      if (["Ausente", "Implante", "Implante con pilar"].includes(effective)) delete data.surfaces[tooth];
      else if (effective !== "Indicación de exodoncia") delete data.missingReason[tooth];
      if (effective === "Corona" && data.crowns?.[tooth]) data.crowns[tooth] = { ...data.crowns[tooth], foundation: "tooth" };
      else if (!(effective === "Implante" && data.crowns?.[tooth]?.foundation === "implant") && !(effective === "Implante con pilar" && data.crowns?.[tooth])) delete data.crowns?.[tooth];
      const updatedAt = now();
      appendToothHistory(data, tooth, "status", before, { recordedAt: updatedAt, ...historyMeta });
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      return Response.json({ odontogram: data });
    }
    if (action === "removeToothLesion") {
      const tooth = Number(input.tooth), status = string(input.status, 48);
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !isLesionStatus(status)) return error("Estado dental inválido.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (data.teeth[tooth] !== status && !(data.extras?.[tooth] ?? []).includes(status)) return Response.json({ odontogram: data });
      const historyMeta = await chartHistoryMetadata("Estado retirado: " + status);
      if ("error" in historyMeta) return error(historyMeta.error);
      if (historyAlreadyRecorded(data, historyMeta)) return Response.json({ odontogram: data });
      const before = toothHistorySnapshot(data, tooth);
      removeLesionFromChart(data, tooth, status);
      const updatedAt = now();
      appendToothHistory(data, tooth, "status", before, { recordedAt: updatedAt, ...historyMeta });
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      return Response.json({ odontogram: data });
    }
    if (action === "setCrownDetails") {
      const tooth = Number(input.tooth), material = string(input.material, 60), shade = string(input.shade, 10);
      const requested = input.foundation === "implant" || input.foundation === "tooth" ? input.foundation : null;
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || (material && !["Zirconio","Disilicato","Metal cerámica","Resina","Otro"].includes(material)) || (shade && !/^[A-D][1-4](?:\.5)?$/i.test(shade))) return error("Revisa la pieza y el material de la corona.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      const foundation = requested ?? (data.teeth[tooth] === "Implante" || data.teeth[tooth] === "Implante con pilar" ? "implant" : "tooth");
      const fallbackTitle = foundation === "implant" ? "Corona sobre implante" : "Corona sobre diente natural";
      const historyMeta = await chartHistoryMetadata(fallbackTitle);
      if ("error" in historyMeta) return error(historyMeta.error);
      if (historyAlreadyRecorded(data, historyMeta)) return Response.json({ odontogram: data });
      const before = toothHistorySnapshot(data, tooth);
      // El soporte elegido por el clínico corrige también el estado general que proyectó la evolución.
      if (foundation === "tooth" && ["Implante", "Implante con pilar"].includes(data.teeth[tooth] ?? "")) data.teeth[tooth] = "Corona";
      if (foundation === "implant" && data.teeth[tooth] === "Corona") data.teeth[tooth] = "Implante";
      if (foundation === "implant" && data.teeth[tooth] === "Implante con pilar") data.teeth[tooth] = "Implante";
      pruneChartExtras(data);
      if (foundation === "implant" && data.teeth[tooth] !== "Implante") return error("Primero registra el implante en la pieza indicada.");
      if (foundation === "tooth" && data.teeth[tooth] !== "Corona") return error("Primero registra una corona en la pieza indicada.");
      if (!material && foundation !== "implant") return error("Revisa la pieza y el material de la corona.");
      data.crowns![tooth] = { material: material || data.crowns?.[tooth]?.material || "", shade: shade || null, source: historyMeta.source, clinicalDate: historyMeta.clinicalDate, foundation };
      const updatedAt = now();
      appendToothHistory(data, tooth, "crown", before, { recordedAt: updatedAt, ...historyMeta, title: historyMeta.title || (foundation === "implant" ? "Corona sobre implante" : "Corona sobre diente") });
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      const [verified] = await db.select({ data: toothStatuses.data }).from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      const confirmed = verified ? normalizeOdontogram(JSON.parse(verified.data)).crowns?.[tooth] : null;
      const confirmedStatus = verified ? normalizeOdontogram(JSON.parse(verified.data)).teeth[tooth] : null;
      if (!confirmed || confirmed.foundation !== foundation || confirmedStatus !== (foundation === "implant" ? "Implante" : "Corona") || (material && confirmed.material !== material) || (shade && (confirmed.shade || "") !== shade)) return error("No se pudo verificar la corrección de la corona.", 503);
      return Response.json({ odontogram: data });
    }
    if (action === "setToothMissingReason") {
      const tooth = Number(input.tooth), reason = string(input.reason, 16);
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !["caries","other","unknown"].includes(reason)) return error("Causa de pérdida inválida.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (!data.teeth[tooth] || !["Ausente","Indicación de exodoncia","Implante","Implante con pilar"].includes(data.teeth[tooth])) return error("Primero registra la pieza como ausente, indicada para exodoncia o con implante.");
      const historyMeta = await chartHistoryMetadata("Causa de ausencia: " + (reason === "caries" ? "caries" : reason === "other" ? "otra causa" : "sin registrar"));
      if ("error" in historyMeta) return error(historyMeta.error);
      if (historyAlreadyRecorded(data, historyMeta)) return Response.json({ odontogram: data });
      const before = toothHistorySnapshot(data, tooth);
      data.missingReason[tooth] = reason as "caries"|"other"|"unknown";
      const updatedAt = now();
      appendToothHistory(data, tooth, "missing_reason", before, { recordedAt: updatedAt, ...historyMeta });
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      return Response.json({ odontogram: data });
    }
    if (action === "setToothSurface") {
      const tooth = Number(input.tooth), surface = string(input.surface, 2), raw = input.finding;
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !surfaceKeys.has(surface) || !raw || typeof raw !== "object" || Array.isArray(raw)) return error("Superficie dental inválida.");
      const finding = raw as Record<string,unknown>, condition = string(finding.condition,32);
      if (!["not_examined","sound","caries","restored","sealant","other_restoration"].includes(condition)) return error("Estado de superficie inválido.");
      let normalized:SurfaceFinding;
      if (condition === "caries") {
        // Profundidad opcional (esmalte, dentina superficial/profunda, pulpar). ICDAS y actividad solo se conservan si ya venían.
        const depthRaw = finding.depth, icdas = finding.icdas == null || finding.icdas === "" ? null : Number(finding.icdas), activity = finding.activity == null || finding.activity === "" ? null : string(finding.activity,16);
        if (depthRaw != null && depthRaw !== "" && !isCariesDepth(depthRaw)) return error("Profundidad de caries inválida.");
        if (icdas !== null && (!Number.isInteger(icdas) || icdas < 1 || icdas > 6)) return error("ICDAS inválido.");
        if (activity !== null && !["active","inactive","uncertain"].includes(activity)) return error("Actividad de la lesión inválida.");
        // Una caries inactivada con un material provisorio (vidrio ionómero, eugenato…) conserva qué se colocó.
        const coverStage = activity === "inactive" ? string(finding.restorationStage, 20) : "", coverMaterial = activity === "inactive" ? string(finding.restorationMaterial, 40) : "";
        if (coverStage && !["provisional", "definitive"].includes(coverStage)) return error("Tipo de restauración inválido.");
        if (coverMaterial && !["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Eugenato", "Otro"].includes(coverMaterial)) return error("Material de restauración inválido.");
        normalized = {
          condition:"caries", depth: isCariesDepth(depthRaw) ? depthRaw : null, icdas:icdas as SurfaceFinding["icdas"], activity:activity as SurfaceFinding["activity"],
          ...(coverStage ? { restorationStage: coverStage as SurfaceFinding["restorationStage"] } : {}),
          ...(coverMaterial ? { restorationMaterial: coverMaterial as SurfaceFinding["restorationMaterial"] } : {}),
        };
      } else {
        const restorationStage = condition === "restored" ? string(finding.restorationStage, 20) : "";
        const restorationMaterial = condition === "restored" ? string(finding.restorationMaterial, 40) : "";
        if (restorationStage && !["provisional", "definitive"].includes(restorationStage)) return error("Tipo de restauración inválido.");
        if (restorationMaterial && !["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Eugenato", "Otro"].includes(restorationMaterial)) return error("Material de restauración inválido.");
        normalized = {
          condition:condition as SurfaceFinding["condition"], depth:null, icdas:null, activity:null,
          ...(condition === "restored" && restorationStage ? { restorationStage: restorationStage as SurfaceFinding["restorationStage"] } : {}),
          ...(condition === "restored" && restorationMaterial ? { restorationMaterial: restorationMaterial as SurfaceFinding["restorationMaterial"] } : {}),
        };
      }
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (["Ausente","Implante","Implante con pilar"].includes(data.teeth[tooth]??"")) return error("No se registran superficies dentarias en dientes ausentes o implantes.");
      if (condition === "sealant" && data.teeth[tooth] === "Corona") return error("Una pieza con corona no tiene superficie para sellar.");
      const priorFinding = data.surfaces[tooth]?.[surface as OdontogramSurface];
      if (condition === "restored" && priorFinding?.condition === "restored") {
        normalized = {
          ...normalized,
          ...(!normalized.restorationStage && priorFinding.restorationStage ? { restorationStage: priorFinding.restorationStage } : {}),
          ...(!normalized.restorationMaterial && priorFinding.restorationMaterial ? { restorationMaterial: priorFinding.restorationMaterial } : {}),
        };
      }
      const historyMeta = await chartHistoryMetadata("Hallazgo actualizado en cara " + surface);
      if ("error" in historyMeta) return error(historyMeta.error);
      if (historyAlreadyRecorded(data, historyMeta)) return Response.json({ odontogram: data });
      const before = toothHistorySnapshot(data, tooth);
      data.surfaces[tooth] = { ...(data.surfaces[tooth]??{}), [surface as OdontogramSurface]: normalized };
      const updatedAt = now();
      const historyBefore = data.history?.length ?? 0;
      appendToothHistory(data, tooth, "surface", before, { recordedAt: updatedAt, ...historyMeta, surface: surface as OdontogramSurface });
      if ((data.history?.length ?? 0) > historyBefore) mergeRecentSurfaceEvent(data, tooth, surface as OdontogramSurface);
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      return Response.json({ odontogram: data });
    }
    return error("Acción no reconocida.");
  } catch {
    return error("No se pudo guardar. Comprueba la conexión y vuelve a intentarlo.", 503);
  }
}
