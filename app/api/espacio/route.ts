import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { getQuotaStatus } from "@/lib/space-quota";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** GET /api/espacio → estado de cuota del espacio autenticado. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "No autenticado." }, { status: 401 });
  try {
    const db = getDb();
    const status = await getQuotaStatus(db as unknown as Parameters<typeof getQuotaStatus>[0], user.userId);
    return Response.json(status);
  } catch {
    return Response.json({ error: "No se pudo consultar el espacio." }, { status: 503 });
  }
}
