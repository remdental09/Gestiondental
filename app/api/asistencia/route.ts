import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadAttendance, setAttendance } from "@/app/attendance-db";
import { json, positiveId, sameOrigin } from "@/app/followup-http";
import { isAttendanceStatus } from "@/lib/dashboard";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Estado de las citas marcado en la agenda (solo del espacio de quien pide). */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ statuses: await loadAttendance(user.userId) }); }
  catch { return json({ error: "No se pudo leer el estado de las citas." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { source?: unknown; refId?: unknown; status?: unknown } | null;
  const source = body?.source === "cal" || body?.source === "app" ? body.source : null;
  const refId = positiveId(body?.refId);
  if (!source || !refId || !isAttendanceStatus(body?.status)) return json({ error: "Solicitud inválida." }, 400);
  try {
    if (!(await setAttendance(user.userId, source, refId, body.status))) return json({ error: "Cita no encontrada." }, 404);
    return json({ ok: true });
  } catch { return json({ error: "No se pudo guardar el estado de la cita." }, 500); }
}
