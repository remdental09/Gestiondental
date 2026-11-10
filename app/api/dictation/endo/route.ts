import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { sanitizeEndoProposals } from "@/lib/dictation/endo-dictation";
import { requestEndoProposal } from "@/lib/dictation/openai-endo";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Propone cambios al endograma desde el dictado. No guarda nada: el clínico revisa y confirma. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { transcript?: unknown } | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length < 10) return json({ error: "No hay dictado que ordenar." }, 400);
  if (transcript.length > 12_000) return json({ error: "El texto supera 12.000 caracteres." }, 400);
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return json({ error: "Falta configurar OPENAI_API_KEY para proponer el endograma." }, 503);
  try {
    const raw = await requestEndoProposal(transcript, key, { model: env.OPENAI_TEXT_MODEL });
    return json(sanitizeEndoProposals(raw, transcript));
  } catch { return json({ error: "La IA no respondió. Puedes completar el endograma a mano." }, 502); }
}
