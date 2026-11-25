import { and, asc, desc, eq } from "drizzle-orm";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages, implants, patients } from "@/db/schema";
import { PRODUCT_IMAGE_KIND, santiagoToday } from "@/lib/biomedical-products";
import { MAX_IMPLANTS_PER_PATIENT, MAX_IMPLANT_IMAGES, cleanImplantFields, cleanImplantImage, parseImplantImages, type ImplantImage } from "@/lib/implants";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers });
const positive = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

type Row = typeof implants.$inferSelect;
const view = (row: Row, available?: Set<number>) => ({
  id: row.id, patientId: row.patientId, tooth: row.tooth, phase: row.phase, brand: row.brand, system: row.system,
  diameter: row.diameter, length: row.length, placedOn: row.placedOn, torque: row.torque, isq: row.isq, productId: row.productId, note: row.note,
  // Una imagen borrada desde la pestaña Imágenes deja de aparecer aquí.
  images: parseImplantImages(row.images).filter(image => !available || available.has(image.imageId)),
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
    const [rows, labels, images] = await Promise.all([
      db.select().from(implants).where(and(eq(implants.ownerId, ownerId), eq(implants.patientId, patientId))).orderBy(asc(implants.tooth), asc(implants.id)),
      db.select().from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, patientId), eq(biomedicalProducts.category, "implante"))).orderBy(desc(biomedicalProducts.placedOn), desc(biomedicalProducts.id)),
      db.select({ id: clinicalImages.id }).from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, patientId))),
    ]);
    const available = new Set(images.map(image => image.id));
    return ok({
      implants: rows.map(row => view(row, available)),
      labels: labels.map(p => ({ id: p.id, tooth: p.tooth, brand: p.brand, reference: p.reference, lot: p.lot, serial: p.serial, placedOn: p.placedOn, model: p.model, diameter: p.diameter, length: p.length })),
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
    const [row] = await db.insert(implants).values({
      ownerId, patientId, ...cleaned.fields, productId: await ownLabel(ownerId, patientId, cleaned.fields.productId),
      createdBy: personalIdOf(user), createdByName: (profile ? displayName(profile) : user.displayName).trim().slice(0, 120), createdAt: now, updatedAt: now,
    }).returning();
    return ok({ implant: view(row!) }, 201);
  } catch { return fail("No se pudo guardar el implante. Intenta otra vez.", 503); }
}

/** Tres usos: corregir los datos, añadir una imagen (`addImage`) o desvincularla (`removeImageId`). */
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
    // Los vínculos de imágenes se escriben solo si nadie los cambió entre la lectura y la escritura; si cambiaron, se relee.
    for (let attempt = 0; attempt < 8; attempt++) {
      const [current] = await db.select().from(implants).where(mine).limit(1);
      if (!current) return fail("Implante no encontrado.", 404);
      const alive = await db.select({ id: clinicalImages.id, kind: clinicalImages.kind }).from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, current.patientId)));
      const kinds = new Map(alive.map(image => [image.id, image.kind]));
      const available = new Set(kinds.keys());
      let change: Partial<Row>;
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
      } else {
        const cleaned = cleanImplantFields(body, santiagoToday());
        if ("error" in cleaned) return fail(cleaned.error);
        change = { ...cleaned.fields, productId: await ownLabel(ownerId, current.patientId, cleaned.fields.productId) };
      }
      const [row] = await db.update(implants).set({ ...change, updatedAt: new Date().toISOString() })
        .where(and(mine, eq(implants.images, current.images))).returning();
      if (row) return ok({ implant: view(row, available) });
    }
    return fail("El implante cambió mientras se guardaba. Intenta otra vez.", 409);
  } catch { return fail("No se pudo guardar el cambio.", 503); }
}

/** Quita la ficha del implante. Sus imágenes y su etiqueta quedan en la ficha del paciente. La confirmación la pide la pantalla. */
export async function DELETE(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const id = positive(new URL(request.url).searchParams.get("id"));
  if (!id) return fail("Implante no válido.");
  try {
    const [row] = await getDb().delete(implants).where(and(eq(implants.id, id), eq(implants.ownerId, ownerId))).returning();
    if (!row) return fail("Implante no encontrado.", 404);
    return ok({ ok: true });
  } catch { return fail("No se pudo quitar el implante.", 503); }
}
