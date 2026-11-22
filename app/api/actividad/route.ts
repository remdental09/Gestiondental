import { getChatGPTUser, spaceRoleOf } from "@/app/chatgpt-auth";
import { recentEvents } from "@/app/account-events";
import { canManageTeam } from "@/lib/clinic-team";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** Actividad del equipo (quién hizo qué cambio): solo el titular y los administradores, y solo de su cuenta. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!canManageTeam(spaceRoleOf(user))) return json({ error: "Solo el titular o un administrador ve la actividad del equipo." }, 403);
  try { return json({ events: await recentEvents(user.userId, 100) }); }
  catch { return json({ events: [] }); }
}
