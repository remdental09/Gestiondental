import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { redraftToothAnswer, ToothAnswerNumericMismatchError } from "@/lib/dictation/tooth-answer-redraft";
import { isFdiTooth } from "@/lib/tooth-numbering";
import { focusedToothReview } from "@/lib/dictation/proposal";
import { OPENAI_CORRECTION_MODEL } from "@/lib/dictation/openai-structure";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) return error("Inicia sesión para redactar el dictado.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  if (!env.OPENAI_API_KEY?.trim()) return error("El modelo de redacción no está disponible. Reintenta más tarde.", 503);
  let body: unknown;
  try { body = await request.json(); }
  catch { return error("Solicitud inválida."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Solicitud inválida.");
  const value = body as Record<string, unknown>;
  const step = value.step;
  const tooth = value.tooth;
  const transcript = value.transcript;
  if ((step !== "diagnosis" && step !== "plan") || typeof tooth !== "number" || !isFdiTooth(tooth) || typeof transcript !== "string" || transcript.trim().length < 3 || transcript.length > (step === "diagnosis" ? 1_000 : 4_000)) return error("Respuesta o pieza inválida.");
  try {
    const model = env.OPENAI_TEXT_MODEL?.trim() || OPENAI_CORRECTION_MODEL;
    const text = await redraftToothAnswer(transcript, step, tooth, env.OPENAI_API_KEY.trim(), { model, signal: request.signal });
    const otherTeeth = focusedToothReview(transcript, tooth).otherTeeth;
    return Response.json({ text, otherTeeth, provider: "openai", model }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof ToothAnswerNumericMismatchError) {
      return Response.json({ error: cause.message, code: cause.code, draft: cause.draft, provider: "openai" }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    return error(cause instanceof Error ? cause.message : "No se pudo redactar la respuesta.", 502);
  }
}
