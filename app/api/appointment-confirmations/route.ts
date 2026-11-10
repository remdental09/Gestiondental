import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadConfirmations, setConfirmation } from "@/app/appointment-confirmations-db";
import { loadHints } from "@/app/calendar-hints-db";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ confirmed: await loadConfirmations(user.userId), hints: await loadHints(user.userId).catch(() => ({})) }); }
  catch { return json({ error: "No se pudieron leer las confirmaciones." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { eventId?: unknown; confirmed?: unknown } | null;
  const eventId = Number(body?.eventId);
  if (!Number.isSafeInteger(eventId) || eventId < 1 || typeof body?.confirmed !== "boolean") return json({ error: "Solicitud inválida." }, 400);
  try {
    if (!(await setConfirmation(user.userId, eventId, body.confirmed))) return json({ error: "Cita no encontrada." }, 404);
    return json({ ok: true });
  } catch { return json({ error: "No se pudo guardar la confirmación." }, 500); }
}
