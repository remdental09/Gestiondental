import { env } from "cloudflare:workers";
import { AI_LIMIT_MESSAGE, aiAllowed, limitsFrom, recordAiUsage, type UsageDb } from "@/lib/ai-usage";

const config = env as unknown as Record<string, unknown> & { DB?: UsageDb };

/** null si la cuenta puede usar IA; si llegó al tope diario, la respuesta 429 con el mensaje amable. */
export async function aiLimitResponse(ownerId: string, kind: "text" | "audio" = "text"): Promise<Response | null> {
  if (await aiAllowed(config.DB, ownerId, limitsFrom(config), kind)) return null;
  return Response.json({ error: AI_LIMIT_MESSAGE, limiteIa: true }, { status: 429, headers: { "Cache-Control": "no-store" } });
}

export const aiWithinLimit = async (ownerId: string, kind: "text" | "audio" = "text") => aiAllowed(config.DB, ownerId, limitsFrom(config), kind);

export const trackAi = (ownerId: string, usage: Parameters<typeof recordAiUsage>[2]) => recordAiUsage(config.DB, ownerId, usage);
