import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { proposeFromTranscript, sanitizeChart } from "@/lib/dictation/proposal";
import { createWorkersAiModel } from "@/lib/dictation/workers-ai";

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
    const model = env.AI ? createWorkersAiModel(env.AI) : null;
    const outcome = await proposeFromTranscript({ transcript, chart: sanitizeChart(record.chart) }, model);
    return Response.json(outcome, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.message ? cause.message : "No se pudo preparar la propuesta.";
    return error(message);
  }
}
