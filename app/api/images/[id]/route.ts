import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { clinicalImages } from "@/db/schema";

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
export async function GET(_request: Request, context: Context) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  if (!env.BUCKET) return fail("Imágenes no disponibles.", 503);
  const image = await owned((await context.params).id, ownerId);
  if (!image) return fail("Imagen no encontrada.", 404);
  const object = await env.BUCKET.get(image.objectKey);
  if (!object) return fail("Imagen no disponible.", 404);
  return new Response(object.body, { headers: { "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
export async function DELETE(request: Request, context: Context) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (!env.BUCKET) return fail("Imágenes no disponibles.", 503);
  const image = await owned((await context.params).id, ownerId);
  if (!image) return fail("Imagen no encontrada.", 404);
  try {
    await env.BUCKET.delete(image.objectKey);
    await getDb().delete(clinicalImages).where(and(eq(clinicalImages.id, image.id), eq(clinicalImages.ownerId, ownerId)));
    return Response.json({ ok: true });
  } catch { return fail("No se pudo quitar la imagen.", 503); }
}
