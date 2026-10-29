import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { clinicalImages, patients } from "@/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión para cargar imágenes.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (!env.BUCKET) return fail("Almacenamiento de imágenes no disponible.", 503);
  try {
    const data = await request.formData();
    const file = data.get("file"), patientId = Number(data.get("patientId"));
    const kind = data.get("kind"), note = String(data.get("note") || "").trim().slice(0, 2000);
    if (!(file instanceof Blob) || !Number.isSafeInteger(patientId) || patientId < 1 || !["Radiografía", "Captura CBCT"].includes(String(kind))) return fail("Archivo o paciente inválido.");
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size < 1 || file.size > 12 * 1024 * 1024) return fail("Usa un archivo JPG, PNG, WebP o PDF de hasta 12 MB.");
    if (file.type === "application/pdf") {
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (new TextDecoder().decode(signature) !== "%PDF-") return fail("El archivo no parece ser un PDF válido.");
    }
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!patient) return fail("Paciente no encontrado.", 404);
    const key = ownerId + "/" + patientId + "/" + crypto.randomUUID();
    await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    const t = new Date().toISOString();
    let image;
    try {
      [image] = await db.insert(clinicalImages).values({ ownerId, patientId, objectKey: key, name: String(data.get("name") || "Imagen").slice(0, 220), kind: String(kind), note, size: file.size, contentType: file.type, addedAt: t }).returning();
    } catch (e) { await env.BUCKET.delete(key); throw e; }
    return Response.json({ image: { id: image.id, patientId, url: "/api/images/" + image.id, name: image.name, kind: image.kind, note, size: image.size, addedAt: new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Santiago" }).format(new Date(t)) } }, { status: 201 });
  } catch { return fail("No se pudo guardar la imagen. Intenta otra vez.", 503); }
}
