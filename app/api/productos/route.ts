import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages, patients } from "@/db/schema";
import { PRODUCT_IMAGE_KIND, cleanProductFields, santiagoToday } from "@/lib/biomedical-products";
import { thumbKey } from "@/lib/image-keys";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Row = typeof biomedicalProducts.$inferSelect;
const view = (row: Row) => ({
  id: row.id, patientId: row.patientId, imageId: row.imageId, category: row.category, brand: row.brand, reference: row.reference, lot: row.lot, serial: row.serial,
  expiry: row.expiry, manufacturer: row.manufacturer, tooth: row.tooth, note: row.note, placedOn: row.placedOn, aiRead: row.aiRead === 1,
  createdByName: row.createdByName, createdAt: row.createdAt,
  imageUrl: row.imageId ? `/api/images/${row.imageId}` : "", thumbUrl: row.imageId ? `/api/images/${row.imageId}?thumb=1` : "",
});

async function guard(request: Request, write: boolean) {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: fail("Inicia sesión para ver los productos.", 401) };
  if (write && request.headers.get("origin") !== new URL(request.url).origin) return { error: fail("Origen no permitido.", 403) };
  return { user };
}

export async function GET(request: Request) {
  const checked = await guard(request, false);
  if (checked.error) return checked.error;
  const patientId = Number(new URL(request.url).searchParams.get("patientId"));
  if (!Number.isSafeInteger(patientId) || patientId < 1) return fail("Selecciona un paciente válido.");
  try {
    const db = getDb(), ownerId = checked.user.userId;
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    const rows = await db.select().from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, patientId))).orderBy(desc(biomedicalProducts.placedOn), desc(biomedicalProducts.id)).limit(300);
    return ok({ products: rows.map(view) });
  } catch { return fail("No se pudieron cargar los productos.", 500); }
}

export async function POST(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const user = checked.user, ownerId = user.userId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = Number(body?.patientId);
  if (!body || !Number.isSafeInteger(patientId) || patientId < 1) return fail("Selecciona un paciente válido.");
  const fields = cleanProductFields(body, santiagoToday());
  if (!fields) return fail("Elige el tipo de producto y una fecha que no sea futura.");
  const imageId = Number(body.imageId);
  const hasImage = Number.isSafeInteger(imageId) && imageId > 0;
  if (!hasImage && !fields.brand && !fields.reference && !fields.lot && !fields.serial) return fail("Toma la foto de la etiqueta o escribe al menos la marca, la referencia, el lote o la serie.");
  try {
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    if (hasImage) {
      const [image] = await db.select({ id: clinicalImages.id, kind: clinicalImages.kind }).from(clinicalImages).where(and(eq(clinicalImages.id, imageId), eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, patientId))).limit(1);
      if (!image || image.kind !== PRODUCT_IMAGE_KIND) return fail("La foto de la etiqueta no está disponible. Tómala otra vez.", 404);
      const [used] = await db.select({ id: biomedicalProducts.id }).from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.imageId, imageId))).limit(1);
      if (used) return fail("Esa foto ya está registrada en otro producto.", 409);
    }
    const profile = await loadProfile(personalIdOf(user)).catch(() => null);
    const [row] = await db.insert(biomedicalProducts).values({
      ownerId, patientId, imageId: hasImage ? imageId : null, ...fields, aiRead: body.aiRead === true ? 1 : 0,
      createdBy: personalIdOf(user), createdByName: (profile ? displayName(profile) : user.displayName).trim().slice(0, 120), createdAt: new Date().toISOString(),
    }).returning();
    return ok({ product: view(row!) }, 201);
  } catch { return fail("No se pudo guardar el producto. Intenta otra vez.", 503); }
}

/** Corregir los datos de un producto ya registrado (el resto de la ficha también se puede modificar). */
export async function PATCH(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!body || !Number.isSafeInteger(id) || id < 1) return fail("Producto no válido.");
  const fields = cleanProductFields(body, santiagoToday());
  if (!fields) return fail("Elige el tipo de producto y una fecha que no sea futura.");
  try {
    const [row] = await getDb().update(biomedicalProducts).set(fields).where(and(eq(biomedicalProducts.id, id), eq(biomedicalProducts.ownerId, ownerId))).returning();
    if (!row) return fail("Producto no encontrado.", 404);
    return ok({ product: view(row) });
  } catch { return fail("No se pudo guardar el cambio.", 503); }
}

/** Quita el registro y su foto. La confirmación previa («¿desea eliminar…?») la pide la pantalla. */
export async function DELETE(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return fail("Producto no válido.");
  try {
    const db = getDb();
    const [row] = await db.select().from(biomedicalProducts).where(and(eq(biomedicalProducts.id, id), eq(biomedicalProducts.ownerId, ownerId))).limit(1);
    if (!row) return fail("Producto no encontrado.", 404);
    await db.delete(biomedicalProducts).where(and(eq(biomedicalProducts.id, id), eq(biomedicalProducts.ownerId, ownerId)));
    if (row.imageId && env.BUCKET) {
      const [image] = await db.select().from(clinicalImages).where(and(eq(clinicalImages.id, row.imageId), eq(clinicalImages.ownerId, ownerId))).limit(1);
      if (image) {
        await env.BUCKET.delete([image.objectKey, thumbKey(image.objectKey)]).catch(() => undefined);
        await db.delete(clinicalImages).where(and(eq(clinicalImages.id, image.id), eq(clinicalImages.ownerId, ownerId)));
      }
    }
    return ok({ ok: true, imageId: row.imageId });
  } catch { return fail("No se pudo quitar el producto.", 503); }
}
