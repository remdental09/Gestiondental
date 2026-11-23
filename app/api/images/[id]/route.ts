import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages } from "@/db/schema";
import { IMAGE_CACHE_CONTROL, thumbKey } from "@/lib/image-keys";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status });
type Context = { params: Promise<{ id: string }> };
async function owned(id: string, ownerId: string) {
  const key = Number(id);
  if (!Number.isSafeInteger(key) || key < 1) return null;
  const [image] = await getDb().select().from(clinicalImages).where(and(eq(clinicalImages.id, key), eq(clinicalImages.ownerId, ownerId)));
  return image || null;
}
export async function GET(request: Request, context: Context) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  if (!env.BUCKET) return fail("Imágenes no disponibles.", 503);
  const image = await owned((await context.params).id, ownerId);
  if (!image) return fail("Imagen no encontrada.", 404);
  // ?thumb=1: miniatura de la grilla; las imágenes antiguas sin miniatura entregan el original.
  const wantsThumb = new URL(request.url).searchParams.get("thumb") === "1" && image.contentType !== "application/pdf";
  const thumb = wantsThumb ? await env.BUCKET.get(thumbKey(image.objectKey)) : null;
  const object = thumb ?? await env.BUCKET.get(image.objectKey);
  if (!object) return fail("Imagen no disponible.", 404);
  // Cada id es inmutable (reemplazar = subir otra): caché privada del navegador, nunca compartida.
  return new Response(object.body, { headers: { "Content-Type": thumb ? "image/jpeg" : image.contentType, "Cache-Control": IMAGE_CACHE_CONTROL, "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Vary": "Cookie" } });
}
export async function DELETE(request: Request, context: Context) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (!env.BUCKET) return fail("Imágenes no disponibles.", 503);
  const image = await owned((await context.params).id, ownerId);
  if (!image) return fail("Imagen no encontrada.", 404);
  // La foto de la etiqueta de un producto registrado es parte de su trazabilidad: se quita junto con el producto, desde la pestaña Productos.
  const [linked] = await getDb().select({ id: biomedicalProducts.id }).from(biomedicalProducts).where(and(eq(biomedicalProducts.imageId, image.id), eq(biomedicalProducts.ownerId, ownerId))).limit(1);
  if (linked) return fail("Esta foto pertenece a un producto del registro de trazabilidad. Quítala desde la pestaña Productos.", 409);
  try {
    await env.BUCKET.delete([image.objectKey, thumbKey(image.objectKey)]);
    await getDb().delete(clinicalImages).where(and(eq(clinicalImages.id, image.id), eq(clinicalImages.ownerId, ownerId)));
    return Response.json({ ok: true });
  } catch { return fail("No se pudo quitar la imagen.", 503); }
}
