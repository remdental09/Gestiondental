import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createWorkersAiModel } from "@/lib/dictation/workers-ai";
import { proposeFromTranscript } from "@/lib/dictation/proposal";
import { correctWithOpenAi } from "@/lib/dictation/openai-correction";
import { normalizeIdentityNumbers } from "@/lib/dictation/identity-numbers";
import { applyLexicon, applySelfCorrections } from "@/lib/dictation/spoken";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión para corregir texto.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);

  let body: unknown;
  try { body = await request.json(); }
  catch { return error("Solicitud inválida."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Solicitud inválida.");
  const transcript = typeof (body as Record<string, unknown>).transcript === "string"
    ? (body as Record<string, string>).transcript.trim()
    : "";
  if (transcript.length < 3) return error("Escribe al menos 3 caracteres.");
  if (transcript.length > 8_000) return error("El texto supera el máximo de 8.000 caracteres.");

  const dictionary = applyLexicon(transcript);
  const selfCorrected = applySelfCorrections(dictionary.text);
  const identity = normalizeIdentityNumbers(selfCorrected.text);
  const local = { text: identity.text, corrections: [...dictionary.corrections, ...selfCorrected.corrections, ...identity.corrections] };
  const localCorrections = local.corrections;

  if (env.OPENAI_API_KEY?.trim()) {
    try {
      const corrected = await correctWithOpenAi(local.text, env.OPENAI_API_KEY.trim(), { model: env.OPENAI_TEXT_MODEL });
      return Response.json({ source: transcript, ...corrected, corrections: [...localCorrections, ...corrected.corrections], provider: "openai" }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ source: transcript, text: local.text, corrections: localCorrections, provider: "dictionary", aiError: "OpenAI no respondió; se dejó la corrección del diccionario." }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  try {
    const model = env.AI ? createWorkersAiModel(env.AI) : null;
    const outcome = await proposeFromTranscript({ transcript, chart: [] }, model);
    return Response.json({
      source: transcript,
      text: outcome.proposal.corrected?.text ?? local.text,
      corrections: outcome.proposal.corrected?.corrections ?? localCorrections,
      provider: outcome.model ? "workers-ai" : "dictionary",
      ...(outcome.aiError ? { aiError: outcome.aiError } : {}),
      ...(!env.OPENAI_API_KEY ? { openAiNotConfigured: true } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ source: transcript, text: local.text, corrections: localCorrections, provider: "dictionary", aiError: "La IA no respondió; se dejó la corrección del diccionario." }, { headers: { "Cache-Control": "no-store" } });
  }
}
