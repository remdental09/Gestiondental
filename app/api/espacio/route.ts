import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getQuotaStatus } from "@/lib/space-quota";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** GET /api/espacio → estado de cuota del espacio autenticado. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "No autenticado." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Base de datos no disponible." }, { status: 503 });
  try {
    const status = await getQuotaStatus(env.DB, user.userId);
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudo consultar el espacio." }, { status: 503 });
  }
}
