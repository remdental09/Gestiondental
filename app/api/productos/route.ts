import { env } from "cloudflare:workers";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages, implants, patients } from "@/db/schema";
import { PRODUCT_EXTRA_FIELDS, PRODUCT_IMAGE_KIND, cleanProductFields, parseDetails, santiagoToday } from "@/lib/biomedical-products";
import { thumbKey } from "@/lib/image-keys";
import { isPhase } from "@/lib/implants";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Row = typeof biomedicalProducts.$inferSelect;
const view = (row: Row) => ({
  id: row.id, patientId: row.patientId, imageId: row.imageId, category: row.category, brand: row.brand, reference: row.reference, lot: row.lot, serial: row.serial,
  expiry: row.expiry, manufacturer: row.manufacturer, tooth: row.tooth, note: row.note, placedOn: row.placedOn, aiRead: row.aiRead === 1,
  createdByName: row.createdByName, createdAt: row.createdAt,
  model: row.model, diameter: row.diameter, length: row.length, registration: row.registration, manufactured: row.manufactured, gtin: row.gtin, details: parseDetails(row.details), code: row.code, kind: row.kind, implantId: row.implantId, stage: row.stage,
  imageUrl: row.imageId ? `/api/images/${row.imageId}` : "", thumbUrl: row.imageId ? `/api/images/${row.imageId}?thumb=1` : "",
});

async function guard(request: Request, write: boolean) {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: fail("Inicia sesión para ver los productos.", 401) };
  if (write && request.headers.get("origin") !== new URL(request.url).origin) return { error: fail("Origen no permitido.", 403) };
  return { user };
}

/**
 * Dónde queda una pieza: en una fase de un implante de ese mismo paciente (toma su pieza dental) o en ninguna.
 * null si el implante o la fase no son válidos.
 */
async function placement(ownerId: string, patientId: number, input: Record<string, unknown>): Promise<{ implantId: number | null; stage: string; tooth?: string } | null> {
  if (input.implantId === null || input.implantId === undefined || input.implantId === "") return { implantId: null, stage: "" };
  const implantId = Number(input.implantId);
  if (!Number.isSafeInteger(implantId) || implantId < 1 || !isPhase(input.stage)) return null;
  const [found] = await getDb().select({ tooth: implants.tooth }).from(implants).where(and(eq(implants.id, implantId), eq(implants.ownerId, ownerId), eq(implants.patientId, patientId))).limit(1);
  return found ? { implantId, stage: input.stage, tooth: found.tooth } : null;
}
const BAD_PLACE = "Ese implante ya no está disponible. Cierra la ventana y ábrela otra vez.";

/** La ficha de un implante deja de apuntar a una etiqueta que se movió a otro implante o se quitó de él. */
const releaseLabel = (ownerId: string, productId: number, keep: number | null) =>
  getDb().update(implants).set({ productId: null, updatedAt: new Date().toISOString() })
    .where(and(eq(implants.ownerId, ownerId), eq(implants.productId, productId), ...(keep ? [ne(implants.id, keep)] : [])));

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
  const placing = Number(body.implantId) > 0;
  // Dentro de una fase también vale lo escrito a mano: qué es o su descripción (un material, por ejemplo).
  if (!hasImage && !fields.brand && !fields.reference && !fields.lot && !fields.serial && !fields.gtin && !fields.code && !(placing && (fields.kind || fields.model)))
    return fail(placing ? "Indica qué usaste, escribe una descripción o toma una foto." : "Toma la foto de la etiqueta o escribe al menos la marca, la referencia, el lote o la serie.");
  try {
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    const place = await placement(ownerId, patientId, body);
    if (!place) return fail(BAD_PLACE, 409);
    if (hasImage) {
      const [image] = await db.select({ id: clinicalImages.id, kind: clinicalImages.kind }).from(clinicalImages).where(and(eq(clinicalImages.id, imageId), eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, patientId))).limit(1);
      if (!image || image.kind !== PRODUCT_IMAGE_KIND) return fail("La foto de la etiqueta no está disponible. Tómala otra vez.", 404);
      const [used] = await db.select({ id: biomedicalProducts.id }).from(biomedicalProducts).where(and(eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.imageId, imageId))).limit(1);
      if (used) return fail("Esa foto ya está registrada en otro producto.", 409);
    }
    // En una fase, una fecha dejada en blanco queda sin fecha: no se inventa la de hoy.
    if (place.implantId && body.placedOn === "") fields.placedOn = "";
    const profile = await loadProfile(personalIdOf(user)).catch(() => null);
    const [row] = await db.insert(biomedicalProducts).values({
      ownerId, patientId, imageId: hasImage ? imageId : null, ...fields, ...place, aiRead: body.aiRead === true ? 1 : 0,
      createdBy: personalIdOf(user), createdByName: (profile ? displayName(profile) : user.displayName).trim().slice(0, 120), createdAt: new Date().toISOString(),
    }).returning();
    return ok({ product: view(row!) }, 201);
  } catch { return fail("No se pudo guardar el producto. Intenta otra vez.", 503); }
}

/**
 * Corregir los datos de un producto ya registrado (el resto de la ficha también se puede modificar).
 * Con `place` solo cambia dónde está: se pone en una fase de un implante o se saca de ella.
 */
export async function PATCH(request: Request) {
  const checked = await guard(request, true);
  if (checked.error) return checked.error;
  const ownerId = checked.user.userId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!body || !Number.isSafeInteger(id) || id < 1) return fail("Producto no válido.");
  const only = body.place && typeof body.place === "object" ? body.place as Record<string, unknown> : null;
  const fields = only ? null : cleanProductFields(body, santiagoToday());
  if (!only && !fields) return fail("Elige el tipo de producto y una fecha que no sea futura.");
  try {
    const db = getDb(), mine = and(eq(biomedicalProducts.id, id), eq(biomedicalProducts.ownerId, ownerId));
    const [current] = await db.select().from(biomedicalProducts).where(mine).limit(1);
    if (!current) return fail("Producto no encontrado.", 404);
    const from = body.from && typeof body.from === "object" ? body.from as Record<string, unknown> : null;
    if (from && ((from.implantId ?? null) !== current.implantId || (from.stage ?? "") !== current.stage)) return fail("Esta pieza cambió en otro lado. Cancela, revisa dónde quedó e intenta otra vez.", 409);
    const change: Partial<Row> = fields ? { ...fields } : {};
    // Una pieza dental que no se tocó en la pantalla no devuelve la que se corrigió en otro lado.
    if (fields && body.toothWas === fields.tooth) change.tooth = current.tooth;
    // Una pantalla abierta antes de esta versión no envía los datos nuevos: no se borran.
    if (fields) for (const key of PRODUCT_EXTRA_FIELDS) if (!(key in body)) delete change[key];
    const wanted = only ?? ("implantId" in body ? body : null);
    if (wanted) {
      const place = await placement(ownerId, current.patientId, wanted);
      if (!place) return fail(BAD_PLACE, 409);
      // «Poner en» solo toma lo que está suelto: no saca una pieza de otro implante que exista.
      if (only && current.implantId && place.implantId !== current.implantId) {
        const [other] = await db.select({ id: implants.id }).from(implants).where(and(eq(implants.id, current.implantId), eq(implants.ownerId, ownerId))).limit(1);
        if (other) return fail("Esta pieza ya está en otro implante. Cierra la ventana y ábrela otra vez.", 409);
      }
      Object.assign(change, place);
    } else if (fields && current.implantId && change.tooth !== current.tooth) {
      // Si se corrige la pieza dental, deja de estar en el implante de la pieza anterior; la pantalla lo pregunta antes.
      if (body.unplace !== true) return fail("Este producto está en una fase de un implante. Cancela, ábrelo otra vez y confirma el cambio de pieza dental.", 409);
      Object.assign(change, { implantId: null, stage: "" });
    }
    // Lo sin fecha sigue sin fecha al corregirlo o moverlo.
    if (fields && body.placedOn === "" && (current.placedOn === "" || current.implantId || change.implantId)) change.placedOn = "";
    // Se escribe solo si sigue donde estaba al leerlo: dos equipos a la vez no se pisan.
    const [row] = await db.update(biomedicalProducts).set(change).where(and(mine, current.implantId ? eq(biomedicalProducts.implantId, current.implantId) : isNull(biomedicalProducts.implantId), eq(biomedicalProducts.stage, current.stage))).returning();
    if (!row) return fail("Esta pieza cambió en otro lado. Cancela, revisa dónde quedó e intenta otra vez.", 409);
    // También una etiqueta unida antes de que hubiera fases: si se saca de la fase, deja de estar en la ficha del implante.
    if ((current.implantId && row.implantId !== current.implantId) || (wanted && !row.implantId)) await releaseLabel(ownerId, id, row.implantId);
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
    await releaseLabel(ownerId, id, null);
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
