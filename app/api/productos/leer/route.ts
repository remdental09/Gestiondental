import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { aiWithinLimit, trackAi } from "@/app/ai-guard";
import { getDb } from "@/db";
import { clinicalImages } from "@/db/schema";
import { LABEL_PROMPT, LABEL_SCHEMA, PRODUCT_IMAGE_KIND, parseLabelReading } from "@/lib/biomedical-products";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const MODEL = "gpt-5.6-luna";
const isReasoning = (model: string) => /^(?:gpt-[5-9]|o\d)/i.test(model);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Lee la foto de la etiqueta y PROPONE los datos (marca, referencia, lote, serie, vencimiento). No guarda nada:
 * el profesional los confirma en el formulario. Si la IA no está disponible o no puede leer, responde 200 con
 * `fields: null` y un aviso, y el formulario se abre vacío para escribir a mano.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión para leer la etiqueta." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { imageId?: unknown; code?: unknown } | null;
  const imageId = Number(body?.imageId);
  // Texto del QR de la etiqueta (ya leído en el teléfono): ayuda a identificar el producto, pero no sustituye lo impreso.
  const code = typeof body?.code === "string" ? body.code.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 600) : "";
  if (!Number.isSafeInteger(imageId) || imageId < 1) return json({ error: "Foto no válida." }, 400);
  if (!env.BUCKET) return json({ error: "Almacenamiento de imágenes no disponible." }, 503);
  const [image] = await getDb().select().from(clinicalImages).where(and(eq(clinicalImages.id, imageId), eq(clinicalImages.ownerId, user.userId))).limit(1);
  if (!image || image.kind !== PRODUCT_IMAGE_KIND || !image.contentType.startsWith("image/")) return json({ error: "Foto no encontrada." }, 404);
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return json({ fields: null, aiError: "La lectura automática no está disponible: escribe los datos." });
  if (!(await aiWithinLimit(user.userId))) return json({ fields: null, aiError: "Llegaste al límite diario de IA: escribe los datos a mano." });
  const object = await env.BUCKET.get(image.objectKey);
  if (!object) return json({ error: "Foto no disponible." }, 404);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return json({ fields: null, aiError: "La foto es muy pesada para leerla: escribe los datos." });
  try {
    void trackAi(user.userId, { calls: 1 });
    const model = (env as unknown as Record<string, string | undefined>).OPENAI_VISION_MODEL?.trim() || MODEL;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: LABEL_PROMPT },
          { role: "user", content: [{ type: "text", text: code ? `Transcribe la etiqueta de esta foto. El código de la etiqueta contiene este texto (puedes usar lo que esté escrito literalmente en él, como marca, medidas o descripción; lote, serie y fechas los toma la app del código): ${code}` : "Transcribe la etiqueta de esta foto." }, { type: "image_url", image_url: { url: `data:${image.contentType};base64,${toBase64(bytes)}`, detail: "high" } }] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "etiqueta_producto", strict: true, schema: LABEL_SCHEMA } },
        ...(isReasoning(model) ? { max_completion_tokens: 4000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 1800 }),
      }),
    });
    if (!response.ok) return json({ fields: null, aiError: "No se pudo leer la etiqueta ahora: escribe los datos." });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    let parsed: unknown = null;
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "null"); } catch { /* respuesta ilegible */ }
    const fields = parseLabelReading(parsed);
    if (!fields.legible) return json({ fields: null, aiError: "No se alcanzó a leer la etiqueta. Toma la foto de nuevo más cerca y con luz, o escribe los datos." });
    return json({ fields });
  } catch { return json({ fields: null, aiError: "No se pudo leer la etiqueta ahora: escribe los datos." }); }
}
