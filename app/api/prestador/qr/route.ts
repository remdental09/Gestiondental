// QR de habilitación: GET muestra la imagen guardada; POST guarda una imagen del QR subida a mano (cuando no se pudo leer del PDF).
// El contenido del QR se lee en el teléfono (jsQR) y llega como «payload». Solo la fila y la carpeta del propio profesional.
import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadRegistration, saveQr } from "@/app/prestador-db";
import { registrationView } from "@/app/prestador-view";
import { QR_IMAGE_MAX_BYTES, certificateKey, cleanQrPayload, ownsKey } from "@/lib/prestador-qr";

export const runtime = "edge";
export const dynamic = "force-dynamic";
type Bucket = { get(key: string): Promise<{ body: ReadableStream; size: number } | null>; put(key: string, value: Uint8Array, options?: unknown): Promise<unknown>; delete(key: string): Promise<void> };
const bucket = () => (env as unknown as { BUCKET?: Bucket }).BUCKET;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const personalId = personalIdOf(user);
  const row = await loadRegistration(personalId).catch(() => null);
  const key = row?.qr_key ?? "";
  if (!row || !ownsKey(personalId, key)) return json({ error: "No hay imagen del QR guardada." }, 404);
  const object = await bucket()?.get(key);
  if (!object) return json({ error: "No se encontró la imagen del QR." }, 404);
  return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const personalId = personalIdOf(user);
  const previous = await loadRegistration(personalId).catch(() => null);
  if (!previous) return json({ error: "Primero sube tu Certificado de inscripción." }, 409);
  const form = await request.formData().catch(() => null);
  const payload = cleanQrPayload(form?.get("payload"));
  const image = form?.get("qr");
  if (!payload) return json({ error: "No se pudo leer el código QR de la imagen. Toma una foto más nítida y de frente." }, 400);
  if (!(image instanceof File) || image.size < 50 || image.size > QR_IMAGE_MAX_BYTES) return json({ error: "La imagen del QR no es válida." }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return json({ error: "La imagen del QR debe llegar como PNG." }, 400);
  const store = bucket();
  if (!store) return json({ error: "El almacenamiento de archivos no está disponible. Intenta más tarde." }, 503);
  const key = certificateKey(personalId, crypto.randomUUID(), "qr");
  try {
    await store.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
    const row = await saveQr(personalId, { key, payload, source: "imagen" });
    if (previous.qr_key && ownsKey(personalId, previous.qr_key)) await store.delete(previous.qr_key).catch(() => undefined);
    return json({ registration: registrationView(row) }, 201);
  } catch {
    await store.delete(key).catch(() => undefined);
    return json({ error: "No se pudo guardar el QR." }, 500);
  }
}
