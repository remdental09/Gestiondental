import { getChatGPTUser } from "@/app/chatgpt-auth";
import { addSource, listSources, removeSource, syncSources } from "@/app/calendar-sources-db";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  return json({ sources: await listSources(user.userId) });
}

/** {url, label} agrega y sincroniza; {action:"sync"} sincroniza ahora; {action:"remove", id} quita. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { url?: unknown; label?: unknown; action?: unknown; id?: unknown } | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  try {
    if (body.action === "sync") return json({ results: await syncSources(user.userId), sources: await listSources(user.userId) });
    if (body.action === "remove" && typeof body.id === "string") { await removeSource(user.userId, body.id); return json({ sources: await listSources(user.userId) }); }
    if (typeof body.url !== "string") return json({ error: "Falta la dirección del calendario." }, 400);
    const result = await addSource(user.userId, body.url, typeof body.label === "string" ? body.label : "");
    if ("error" in result) return json({ error: result.error }, 400);
    return json({ ...result, sources: await listSources(user.userId) }, 201);
  } catch {
    return json({ error: "No se pudo completar la acción con el calendario." }, 500);
  }
}
