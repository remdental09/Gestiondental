import { and, count, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { budgets, evolutions, patients, payments } from "@/db/schema";
import { saveAddress } from "@/app/patient-address-db";
import { createCustomMany } from "@/app/custom-prestaciones-db";
import { encodeBudgetData, normalizeBudgetItems, validIsoDate } from "@/lib/budget-plans";
import { MAX_CUSTOM_PER_OWNER, SPECIALTY_KEYS, normalizeName } from "@/lib/custom-prestaciones";
import { cleanRutValue, isValidChileanRut } from "@/lib/patient-document";
import { importedNoteBody, patientKey, type ImportBundle, type ImportTariff } from "@/lib/platform-import";

export const IMPORT_REASON = "Importado desde otra plataforma";
/** Límites por solicitud: mantienen cada llamada dentro de los límites de D1 y del Worker. */
export const MAX_BUNDLES_PER_CALL = 6;
export const MAX_ROWS_PER_CALL = 400;

export type ImportCounts = { patientsCreated: number; patientsExisting: number; plansCreated: number; plansSkipped: number; notesCreated: number; notesSkipped: number; paymentsCreated: number; paymentsSkipped: number; failed: number; discarded: number };
export const emptyCounts = (): ImportCounts => ({ patientsCreated: 0, patientsExisting: 0, plansCreated: 0, plansSkipped: 0, notesCreated: 0, notesSkipped: 0, paymentsCreated: 0, paymentsSkipped: 0, failed: 0, discarded: 0 });

const BATCH = 40;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const isoDay = (value: unknown) => (typeof value === "string" && validIsoDate(value) ? value : "");
const atNoon = (day: string, fallback: string) => (day ? `${day}T12:00:00.000Z` : fallback);
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const validPhone = (value: string) => /^[+\d][\d\s()-]{5,23}$/.test(value);
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function inBatches<T>(db: ReturnType<typeof getDb>, statements: T[]) {
  for (let index = 0; index < statements.length; index += BATCH) {
    await db.batch(statements.slice(index, index + BATCH) as unknown as [never, ...never[]]);
  }
}

/** Importa un grupo de fichas. Es idempotente: repetirlo no duplica pacientes, planes, evoluciones ni pagos. */
export async function importBundles(ownerId: string, input: unknown): Promise<ImportCounts> {
  const counts = emptyCounts();
  if (!Array.isArray(input)) return counts;
  const db = getDb();
  const bundles = input as ImportBundle[];
  for (const bundle of bundles) {
    try { await importBundle(db, ownerId, bundle, counts); } catch { counts.failed += 1; }
  }
  return counts;
}

async function importBundle(db: ReturnType<typeof getDb>, ownerId: string, bundle: ImportBundle, counts: ImportCounts) {
  const source = bundle?.patient;
  const name = text(source?.name, 180).replace(/\s+/g, " ");
  if (!name) { counts.failed += 1; return; }
  const now = new Date().toISOString();
  const document = text(source.document, 30) || null;
  const key = patientKey(document ?? "", name);

  // 1. Paciente: por documento; sin documento, solo una ficha importada antes con el mismo nombre.
  let patientId: number | null = null;
  if (document) {
    const found = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, document))).limit(1);
    patientId = found[0]?.id ?? null;
  } else {
    const candidates = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.reason, IMPORT_REASON)));
    patientId = candidates.find(row => patientKey("", row.name) === key)?.id ?? null;
  }
  if (document && !isValidChileanRut(document) && !/^[A-Z0-9]{4,20}$/.test(document)) { counts.failed += 1; return; }
  if (patientId) counts.patientsExisting += 1;
  else {
    const birthDate = isoDay(source.birthDate), today = now.slice(0, 10);
    const phone = text(source.phone, 24), email = text(source.email, 254);
    const [created] = await db.insert(patients).values({
      ownerId, name, birthDate: birthDate && birthDate <= today ? birthDate : "", rut: document ? (isValidChileanRut(document) ? cleanRutValue(document) : document) : null,
      phone: validPhone(phone) ? phone : "", email: validEmail(email) ? email : "", reason: IMPORT_REASON, status: "Evaluación",
      allergies: "Sin registrar", history: "Sin registrar", createdAt: now, updatedAt: now,
    }).returning({ id: patients.id });
    patientId = created.id;
    counts.patientsCreated += 1;
    const street = text(source.street, 160), commune = text(source.commune, 80);
    if (street || commune) await saveAddress(ownerId, patientId, { street, commune, country: "Chile" }).catch(() => null);
  }

  // 2. Planes: no se repite uno con el mismo título para el mismo paciente.
  const existingPlans = await db.select({ id: budgets.id, title: budgets.title }).from(budgets).where(and(eq(budgets.ownerId, ownerId), eq(budgets.patientId, patientId)));
  const titles = new Map(existingPlans.map(plan => [fold(plan.title), plan.id]));
  const budgetByNumber = new Map<string, number>();
  for (const plan of Array.isArray(bundle.plans) ? bundle.plans : []) {
    const title = text(plan?.title, 120);
    const items = normalizeBudgetItems(plan?.items);
    if (!title || !items) { counts.discarded += 1; continue; }
    const known = titles.get(fold(title));
    if (known) { budgetByNumber.set(String(plan.number), known); counts.plansSkipped += 1; continue; }
    const [row] = await db.insert(budgets).values({
      ownerId, patientId, title, items: encodeBudgetData(items, { isAlternative: false, parentBudgetId: null }),
      status: text(plan.status, 60) || "Importado", createdAt: atNoon(isoDay(plan.createdOn), now),
    }).returning({ id: budgets.id });
    titles.set(fold(title), row.id);
    budgetByNumber.set(String(plan.number), row.id);
    counts.plansCreated += 1;
  }

  // 3. Evoluciones: el requestId estable evita duplicados al repetir la importación.
  const notes = (Array.isArray(bundle.notes) ? bundle.notes : []).filter(note => text(note?.text, 20000) && isoDay(note.date) && /^imp:ev:[0-9a-z]+$/.test(String(note.requestId)));
  counts.discarded += (Array.isArray(bundle.notes) ? bundle.notes.length : 0) - notes.length;
  if (notes.length) {
    const have = new Set((await db.select({ requestId: evolutions.requestId }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId)))).map(row => row.requestId));
    const fresh = notes.filter(note => !have.has(note.requestId));
    counts.notesSkipped += notes.length - fresh.length;
    await inBatches(db, fresh.map(note => db.insert(evolutions).values({
      ownerId, patientId: patientId!, clinicalDate: note.date, recordedAt: atNoon(isoDay(note.recordedOn), now), title: "Evolución importada",
      body: importedNoteBody({ ...note, text: text(note.text, 20000), professional: text(note.professional, 120), zoneText: text(note.zoneText, 200) }), requestId: note.requestId,
    }).onConflictDoNothing()));
    counts.notesCreated += fresh.length;
  }

  // 4. Pagos: se vinculan al plan importado con el mismo número (o a su primera parte).
  const pays = (Array.isArray(bundle.payments) ? bundle.payments : []).filter(pay => Number.isSafeInteger(pay?.amount) && pay.amount >= 1 && isoDay(pay.paidOn) && /^imp:pay:[0-9a-z]+$/.test(String(pay.requestId)));
  counts.discarded += (Array.isArray(bundle.payments) ? bundle.payments.length : 0) - pays.length;
  if (pays.length) {
    const have = new Set((await db.select({ requestId: payments.requestId }).from(payments).where(and(eq(payments.ownerId, ownerId), eq(payments.patientId, patientId)))).map(row => row.requestId));
    const fresh = pays.filter(pay => !have.has(pay.requestId));
    counts.paymentsSkipped += pays.length - fresh.length;
    await inBatches(db, fresh.map(pay => db.insert(payments).values({
      ownerId, patientId: patientId!, budgetId: budgetByNumber.get(String(pay.plan)) ?? budgetByNumber.get(`${pay.plan}.1`) ?? null,
      amount: pay.amount, method: text(pay.method, 40) || "otro", concept: text(pay.concept, 200), paidOn: pay.paidOn, requestId: pay.requestId, createdAt: now,
    }).onConflictDoNothing()));
    counts.paymentsCreated += fresh.length;
  }
}

/** Aranceles propios del profesional: se agregan los que no existan (misma especialidad y nombre). */
export async function importTariffs(ownerId: string, input: unknown): Promise<{ created: number; skipped: number }> {
  if (!Array.isArray(input)) return { created: 0, skipped: 0 };
  const items = (input as ImportTariff[]).flatMap(row => {
    const name = normalizeName(row?.name);
    const price = Number.isSafeInteger(row?.price) && row.price >= 1 ? row.price : null;
    return name && SPECIALTY_KEYS.includes(row?.specialty) ? [{ specialty: row.specialty, name, price }] : [];
  });
  return createCustomMany(ownerId, items, MAX_CUSTOM_PER_OWNER, input.length - items.length);
}

/** Lo que hay guardado de lo importado (para comprobar después de importar). */
export async function importedTotals(ownerId: string): Promise<{ pacientes: number; planes: number; evoluciones: number; pagos: number }> {
  const db = getDb();
  const one = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
  const [pacientes, planes, evoluciones, pagos] = await Promise.all([
    one(db.select({ n: count() }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.reason, IMPORT_REASON)))),
    one(db.select({ n: count() }).from(budgets).where(and(eq(budgets.ownerId, ownerId), like(budgets.title, "%(importado)%")))),
    one(db.select({ n: count() }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), like(evolutions.requestId, "imp:ev:%")))),
    one(db.select({ n: count() }).from(payments).where(and(eq(payments.ownerId, ownerId), like(payments.requestId, "imp:pay:%")))),
  ]);
  return { pacientes, planes, evoluciones, pagos };
}
