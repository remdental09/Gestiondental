import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AUDIO_TRANSCRIPTION_MODEL, AUDIO_COMPATIBILITY_MODEL, MAX_AUDIO_BYTES, MAX_RECORDING_MS, transcribeDentalAudio } from "@/lib/dictation/openai-transcription";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const active = new Set<string>();

export async function GET(request: Request) {
  if (!(await getChatGPTUser())) return json({ error: "Inicia sesión para usar el dictado." }, 401);
  let model = env.OPENAI_TRANSCRIPTION_MODEL?.trim() || AUDIO_TRANSCRIPTION_MODEL;
  const available = !!env.OPENAI_API_KEY?.trim();
  let modelAccess: string | undefined;
  // Diagnóstico autenticado sin enviar audio ni consumir una transcripción.
  // Una clave restringida puede permitir audio sin permitir leer /models.
  if (available && new URL(request.url).searchParams.get("probe") === "1") {
    try {
      let response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` }, signal: AbortSignal.timeout(8_000) });
      if (response.status === 404 && !env.OPENAI_TRANSCRIPTION_MODEL?.trim()) {
        model = AUDIO_COMPATIBILITY_MODEL;
        response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` }, signal: AbortSignal.timeout(8_000) });
      }
      modelAccess = response.ok ? "available" : `unverified_http_${response.status}`;
    } catch { modelAccess = "unverified_network"; }
  }
  return json({ available, provider: "openai", model, maxRecordingMs: MAX_RECORDING_MS, ...(modelAccess ? { modelAccess } : {}) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Inicia sesión para transcribir audio." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  if (!env.OPENAI_API_KEY?.trim()) return json({ error: "Falta configurar OPENAI_API_KEY en el Worker de Cloudflare para transcribir audio." }, 503);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return json({ error: "Envía una grabación de audio." }, 415);
  const owner = user.userId;
  if (active.has(owner)) return json({ error: "Ya hay una transcripción en curso. Espera que termine." }, 429);
  active.add(owner);
  try {
    // Límite real del cuerpo, incluso si no hay Content-Length.
    const limit = MAX_AUDIO_BYTES + 64 * 1024;
    if (Number(request.headers.get("content-length")) > limit) return json({ error: "La grabación supera 10 MB." }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "No se recibió audio." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return json({ error: "La grabación supera 10 MB." }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return json({ error: "No se recibió una grabación de audio." }, 400);
    const result = await transcribeDentalAudio(audio, env.OPENAI_API_KEY.trim(), { model: env.OPENAI_TRANSCRIPTION_MODEL, signal: request.signal });
    return json({ ...result, provider: "openai" });
  } catch (cause) {
    return json({ error: cause instanceof Error && cause.name !== "AbortError" && cause.name !== "TimeoutError" ? cause.message : "La transcripción tardó demasiado. Reintenta la grabación." }, 502);
  } finally { active.delete(owner); }
}
