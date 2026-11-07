import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { proposeFromTranscript, sanitizeChart } from "@/lib/dictation/proposal";
import { createWorkersAiModel } from "@/lib/dictation/workers-ai";
import { agentEnabledFor } from "@/lib/dictation/openai-agent";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión para preparar el dictado.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let body: unknown;
  try { body = await request.json(); }
  catch { return error("Solicitud inválida."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Solicitud inválida.");
  const record = body as Record<string, unknown>;
  const transcript = typeof record.transcript === "string" ? record.transcript : "";
  try {
    const openAiKey = env.OPENAI_API_KEY?.trim();
    // La nota clínica se redacta primero con OpenAI cuando hay clave; Workers AI queda como respaldo.
    const agent = Boolean(openAiKey) && agentEnabledFor(user.email, env.DICTATION_AGENT_EMAILS);
    // El agente puede dar varias vueltas: se le da más tiempo total y, si falla, queda la pasada única.
    const model = env.AI || openAiKey ? createWorkersAiModel(env.AI, { openAi: { apiKey: openAiKey, model: env.OPENAI_STRUCTURE_MODEL }, preferOpenAi: Boolean(openAiKey), agent, ...(agent ? { totalMs: 75_000 } : {}) }) : null;
    const outcome = await proposeFromTranscript({ transcript, chart: sanitizeChart(record.chart) }, model, undefined, agent ? { timeoutMs: 80_000 } : {});
    return Response.json(outcome, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.message ? cause.message : "No se pudo preparar la propuesta.";
    return error(message);
  }
}
