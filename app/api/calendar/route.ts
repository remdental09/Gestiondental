import { getChatGPTUser } from "@/app/chatgpt-auth";
import { listCalendarConnections, removeCalendarConnection, syncGoogleCalendars } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  return json({ accounts: await listCalendarConnections(user.userId) });
}

/** {action:"sync"} actualiza ahora; {action:"remove", id} desconecta una cuenta. Conectar se hace con /api/drive/connect?calendar=1. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { action?: unknown; id?: unknown } | null;
  try {
    if (body?.action === "sync") return json({ results: await syncGoogleCalendars(user.userId), accounts: await listCalendarConnections(user.userId) });
    if (body?.action === "remove" && typeof body.id === "string") { await removeCalendarConnection(user.userId, body.id); return json({ accounts: await listCalendarConnections(user.userId) }); }
    return json({ error: "Acción no reconocida." }, 400);
  } catch {
    return json({ error: "No se pudo completar la acción con el calendario." }, 500);
  }
}
