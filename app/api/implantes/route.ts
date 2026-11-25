import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { authorStatement } from "@/app/evolution-author";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages, evolutions, implants, patients } from "@/db/schema";
import { PRODUCT_IMAGE_KIND, santiagoToday } from "@/lib/biomedical-products";
import { stagePieces } from "@/lib/implant-pieces";
import {
  MAX_IMPLANTS_PER_PATIENT, MAX_IMPLANT_IMAGES, addedStageNote, cleanImplantFields, cleanImplantImage, cleanStageNote,
  mergeImplantEdit, parseHistory, parseImplantImages, parseStageNotes, recordPhase, setStage, setStageNote, stageEvolutionEntry, stageMarks,
  type ImplantConnection, type ImplantImage, type RecordedPhase,
} from "@/lib/implants";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers });
const positive = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

type Row = typeof implants.$inferSelect;
const view = (row: Row, available?: Set<number>) => ({
  id: row.id, patientId: row.patientId, tooth: row.tooth, phase: row.phase, history: parseHistory(row.history), brand: row.brand, system: row.system, connection: row.connection,
  diameter: row.diameter, length: row.length, placedOn: row.placedOn, torque: row.torque, isq: row.isq, productId: row.productId, note: row.note,
  // Una imagen borrada desde la pestaña Imágenes deja de aparecer aquí.
  images: parseImplantImages(row.images).filter(image => !available || available.has(image.imageId)),
  stageNotes: parseStageNotes(row.stageNotes),
  createdByName: row.createdByName, createdAt: row.createdAt, updatedAt: row.updatedAt,
});

async function guard(request: Request, write: boolean) {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: fail("Inicia sesión para ver los implantes.", 401) };
  if (write && request.headers.get("origin") !== new URL(request.url).origin) return { error: fail("Origen no permitido.", 403) };
  return { user };
}

const ownsPatient = async (ownerId: string, patientId: number) =>
  (await getDb().select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1)).length === 1;

/** La etiqueta solo se vincula si es un implante registrado en la ficha de ese mismo paciente. */
async function ownLabel(ownerId: string, patientId: number, productId: number | null) {
  if (!productId) return null;
  const [found] = await getDb().select({ id: biomedicalProducts.id }).from(biomedicalProducts).where(and(eq(biomedicalProducts.id, productId), eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, patientId), eq(biomedicalProducts.category, "implante"))).limit(1);
  return found?.id ?? null;
}

export async function GET(request: Request) {
  const checked = await guard(request, false);
  if (checked.error) return checked.error;
  const patientId = positive(new URL(request.url).searchParams.get("patientId"));
  if (!patientId) return fail("Selecciona un paciente válido.");
  try {
    const db = getDb(), ownerId = checked.user.userId;
    if (!await ownsPatient(ownerId, patientId)) return fail("Paciente no encontrado.", 404);
    const [rows, products, images, connections, kinds] = await Promise.all([
      db.select().from(implants).where(and(eq(implants.ownerId, ownerId), eq(implants.patientId, patientId))).orderBy(asc(implants.tooth), asc(implants.id)),
      db.select().from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, patientId))).orderBy(desc(biomedicalProducts.placedOn), desc(biomedicalProducts.id)),
      db.select({ id: clinicalImages.id }).from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, patientId))),
      // Conexiones ya confirmadas por marca y sistema en esta cuenta, para proponerlas. No incluye datos de pacientes.
      db.select({ brand: implants.brand, system: implants.system, connection: implants.connection }).from(implants).where(and(eq(implants.ownerId, ownerId), ne(implants.connection, ""), ne(implants.brand, ""))).orderBy(desc(implants.updatedAt), desc(implants.id)).limit(500),
      // Nombres de piezas que esta cuenta ya usó, para ofrecerlos. Solo el nombre del tipo, sin datos de pacientes.
      db.select({ kind: biomedicalProducts.kind }).from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), ne(biomedicalProducts.kind, ""))).orderBy(desc(biomedicalProducts.id)).limit(500),
    ]);
    const available = new Set(images.map(image => image.id));
    return ok({
      implants: rows.map(row => view(row, available)),
      connections,
      kinds: [...new Set(kinds.map(item => item.kind))].slice(0, 40),
      // Lo mínimo de cada producto para el resumen de las fases.
      pieces: products.map(p => ({ id: p.id, implantId: p.implantId, stage: p.stage, kind: p.kind, category: p.category, tooth: p.tooth, brand: p.brand, model: p.model, reference: p.reference, lot: p.lot, serial: p.serial, diameter: p.diameter, length: p.length })),
      labels: products.filter(p => p.category === "implante").map(p => ({ id: p.id, tooth: p.tooth, brand: p.brand, reference: p.reference, lot: p.lot, serial: p.serial, placedOn: p.placedOn, model: p.model, diameter: p.diameter, length: p.length })),
    });
  } catch { return fail("No se pudieron cargar los implantes.", 500); }
}

export async function POST(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const user = checked.user, ownerId = user.userId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = positive(body?.patientId);
  if (!body || !patientId) return fail("Selecciona un paciente válido.");
  const cleaned = cleanImplantFields(body, santiagoToday());
  if ("error" in cleaned) return fail(cleaned.error);
  try {
    const db = getDb();
    if (!await ownsPatient(ownerId, patientId)) return fail("Paciente no encontrado.", 404);
    const existing = await db.select({ id: implants.id }).from(implants).where(and(eq(implants.ownerId, ownerId), eq(implants.patientId, patientId)));
    if (existing.length >= MAX_IMPLANTS_PER_PATIENT) return fail("Esta ficha alcanzó el máximo de implantes registrados.");
    const profile = await loadProfile(personalIdOf(user)).catch(() => null);
    const now = new Date().toISOString();
    const history = recordPhase([], { phase: "", placedOn: "" }, cleaned.fields);
    const [row] = await db.insert(implants).values({
      ownerId, patientId, ...cleaned.fields, history: JSON.stringify(history), productId: await ownLabel(ownerId, patientId, cleaned.fields.productId),
      createdBy: personalIdOf(user), createdByName: (profile ? displayName(profile) : user.displayName).trim().slice(0, 120), createdAt: now, updatedAt: now,
    }).returning();
    return ok({ implant: view(row!) }, 201);
  } catch { return fail("No se pudo guardar el implante. Intenta otra vez.", 503); }
}

/**
 * Cinco usos: corregir los datos, marcar una etapa con su fecha o quitar la marca (`markStage`),
 * escribir la nota de una fase (`stageNote`), añadir una imagen (`addImage`) o desvincularla (`removeImageId`).
 * Lo nuevo de `stageNote` (marca/medidas, conexión, piezas y lo agregado a la nota) se compila y se suma,
 * además, a la evolución general del paciente: así otro profesional ve en evolución que se trabajó en implantología.
 */
export async function PATCH(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = positive(body?.id);
  if (!body || !id) return fail("Implante no válido.");
  try {
    const db = getDb();
    const mine = and(eq(implants.id, id), eq(implants.ownerId, ownerId));
    // Se escribe solo si nadie cambió el implante entre la lectura y la escritura; si cambió, se relee.
    for (let attempt = 0; attempt < 8; attempt++) {
      const [current] = await db.select().from(implants).where(mine).limit(1);
      if (!current) return fail("Implante no encontrado.", 404);
      const alive = await db.select({ id: clinicalImages.id, kind: clinicalImages.kind }).from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, current.patientId)));
      const kinds = new Map(alive.map(image => [image.id, image.kind]));
      const available = new Set(kinds.keys());
      let change: Partial<Row>;
      // Si se dicta o escribe en la nota de una fase, lo nuevo se compila y se agrega a la evolución general (más abajo).
      let pendingEvolution: { title: string; body: string } | null = null;
      let pendingEvolutionPhase: RecordedPhase | null = null;
      if (body.addImage !== undefined || body.removeImageId !== undefined) {
        let list: ImplantImage[] = parseImplantImages(current.images).filter(i => available.has(i.imageId));
        if (body.addImage !== undefined) {
          const added = cleanImplantImage(body.addImage);
          if (!added) return fail("Imagen no válida.");
          // Solo imágenes de este mismo paciente; la foto de una etiqueta no es un corte.
          if (!kinds.has(added.imageId) || kinds.get(added.imageId) === PRODUCT_IMAGE_KIND) return fail("La imagen no pertenece a este paciente.", 404);
          list = [...list.filter(i => i.imageId !== added.imageId), added];
          if (list.length > MAX_IMPLANT_IMAGES) return fail(`Máximo ${MAX_IMPLANT_IMAGES} imágenes por implante.`);
        } else list = list.filter(i => i.imageId !== positive(body.removeImageId));
        change = { images: JSON.stringify(list) };
      } else if (body.stageNote !== undefined) {
        const edited = setStageNote(current.stageNotes, body.stageNote);
        if ("error" in edited) return fail(edited.error, edited.stale ? 409 : 400);
        change = { stageNotes: JSON.stringify(edited.notes) };
        const { phase, was } = body.stageNote as { phase: RecordedPhase; was?: unknown };
        const addedNote = addedStageNote(cleanStageNote(was), edited.notes[phase] ?? "");
        if (addedNote) {
          const products = await db.select({ id: biomedicalProducts.id, implantId: biomedicalProducts.implantId, stage: biomedicalProducts.stage, kind: biomedicalProducts.kind, category: biomedicalProducts.category, tooth: biomedicalProducts.tooth })
            .from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, current.patientId)));
          pendingEvolution = stageEvolutionEntry({
            tooth: current.tooth, phaseId: phase, implant: current, connection: current.connection as ImplantConnection,
            pieces: stagePieces(products, current, phase), addedNote,
          });
          if (pendingEvolution) pendingEvolutionPhase = phase;
        }
      } else if (body.markStage !== undefined) {
        const edited = setStage(parseHistory(current.history), current, body.markStage, santiagoToday());
        if ("error" in edited) return fail(edited.error, edited.stale ? 409 : 400);
        change = { phase: edited.phase, history: JSON.stringify(edited.history), placedOn: edited.placedOn };
      } else {
        // Una ficha abierta desde antes no puede devolver la etapa ni borrar lo confirmado en otro lado.
        const merged = mergeImplantEdit(current, body);
        if ("error" in merged) return fail(merged.error, 409);
        const cleaned = cleanImplantFields(merged.input, santiagoToday());
        if ("error" in cleaned) return fail(cleaned.error);
        change = { ...cleaned.fields, productId: await ownLabel(ownerId, current.patientId, cleaned.fields.productId),
          history: JSON.stringify(recordPhase(parseHistory(current.history), current, cleaned.fields)) };
      }
      const [row] = await db.update(implants).set({ ...change, updatedAt: new Date().toISOString() })
        .where(and(mine, eq(implants.images, current.images), eq(implants.history, current.history), eq(implants.phase, current.phase), eq(implants.stageNotes, current.stageNotes), eq(implants.updatedAt, current.updatedAt))).returning();
      // Al corregir la pieza del implante, lo anotado en sus fases pasa a la pieza correcta (si falló antes, se completa ahora).
      if (row) await db.update(biomedicalProducts).set({ tooth: row.tooth }).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.implantId, row.id), ne(biomedicalProducts.tooth, row.tooth))).catch(() => undefined);
      // Se agrega a evolución general solo si la nota se guardó; el autor va en el mismo batch (si no se puede
      // registrar, tampoco se guarda la evolución). La nota de la fase ya quedó guardada igual: esto no la bloquea.
      if (row && pendingEvolution && pendingEvolutionPhase) {
        const clinicalDate = stageMarks(parseHistory(row.history), row.phase, row.placedOn)[pendingEvolutionPhase] || santiagoToday();
        await db.batch([
          db.insert(evolutions).values({ ownerId, patientId: row.patientId, clinicalDate, recordedAt: row.updatedAt, title: pendingEvolution.title, body: pendingEvolution.body, backupStatus: "not_configured" }).returning(),
          (await authorStatement(db, ownerId)).statement,
        ]).catch(() => undefined);
      }
      if (row) return ok({ implant: view(row, available) });
    }
    return fail("El implante cambió mientras se guardaba. Intenta otra vez.", 409);
  } catch { return fail("No se pudo guardar el cambio.", 503); }
}

/** Quita la ficha del implante. Sus imágenes y sus productos quedan en la ficha del paciente. La confirmación la pide la pantalla. */
export async function DELETE(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const id = positive(new URL(request.url).searchParams.get("id"));
  if (!id) return fail("Implante no válido.");
  try {
    const [row] = await getDb().delete(implants).where(and(eq(implants.id, id), eq(implants.ownerId, ownerId))).returning();
    if (!row) return fail("Implante no encontrado.", 404);
    await getDb().update(biomedicalProducts).set({ implantId: null, stage: "" }).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.implantId, id)));
    return ok({ ok: true });
  } catch { return fail("No se pudo quitar el implante.", 503); }
}
