import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Diagnóstico de acceso a modelos de OpenAI con la clave del Worker.
 * Prueba la lista de modelos, Chat Completions y Responses para cada modelo, y devuelve solo
 * estado HTTP, código, mensaje (sin fragmentos de clave), la organización/proyecto que informa OpenAI
 * y los últimos 4 caracteres de la clave (lo mismo que muestra el panel de OpenAI).
 */
const MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-luna", "gpt-4o-mini"];
const clean = (text: unknown) => String(text ?? "").replace(/sk-[A-Za-z0-9_\-]{4,}/g, "sk-***").slice(0, 220);
const reasoning = (model: string) => /^(?:gpt-[5-9]|o\d)/i.test(model);

type Probe = { status: number; ms: number; organization?: string | null; project?: string | null; code?: string; message?: string; parsed: Record<string, unknown> };

async function probe(url: string, key: string, body?: Record<string, unknown>): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* sin JSON */ }
    const error = parsed.error as { code?: unknown; type?: unknown; message?: unknown } | undefined;
    return {
      status: response.status,
      ms: Date.now() - started,
      organization: response.headers.get("openai-organization"),
      project: response.headers.get("openai-project"),
      ...(error ? { code: clean(error.code ?? error.type), message: clean(error.message) } : {}),
      parsed,
    };
  } catch (cause) {
    return { status: 0, ms: Date.now() - started, message: clean(cause instanceof Error ? cause.message : cause), parsed: {} as Record<string, unknown> };
  }
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Inicia sesión." }, { status: 401 });
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return Response.json({ error: "El Worker no tiene OPENAI_API_KEY." }, { status: 503 });
  const list = await probe("https://api.openai.com/v1/models", key);
  const ids = Array.isArray(list.parsed.data) ? (list.parsed.data as Array<{ id?: string }>).map((item) => String(item.id ?? "")) : [];
  const results = [];
  for (const model of MODELS) {
    const chat = await probe("https://api.openai.com/v1/chat/completions", key, {
      model,
      messages: [{ role: "user", content: "Responde solo: ok" }],
      ...(reasoning(model) ? { max_completion_tokens: 200 } : { max_tokens: 20 }),
    });
    const responses = await probe("https://api.openai.com/v1/responses", key, { model, input: "Responde solo: ok", max_output_tokens: 200 });
    const strip = (result: Probe) => { const { parsed, ...rest } = result; void parsed; return rest; };
    results.push({ model, inModelList: ids.includes(model), chat: strip(chat), responses: strip(responses) });
  }
  return Response.json({
    keyEnding: key.slice(-4),
    configuredStructureModel: env.OPENAI_STRUCTURE_MODEL ?? null,
    modelList: { status: list.status, organization: list.organization, project: list.project, ...(list.code ? { code: list.code, message: list.message } : {}), count: ids.length, gpt5or6: ids.filter((id) => /^gpt-(?:5\.6|6)/.test(id)).sort() },
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}
