import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getSender, removeSender, updateSettings } from "@/app/appointment-mail-db";
import { runReminderCycle, sendTestMail } from "@/app/appointment-mail";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;

const view = (sender: Awaited<ReturnType<typeof getSender>>) => sender ? { connected: true, email: sender.google_email, enabled: sender.enabled === 1, sendHour: sender.send_hour, lastRunAt: sender.last_run_at, lastResult: sender.last_result } : { connected: false };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ sender: view(await getSender(user.userId)) }); }
  catch { return json({ error: "No se pudo leer la configuración." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { enabled?: unknown; sendHour?: unknown } | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const sender = await getSender(user.userId);
  if (!sender) return json({ error: "Primero conecta el correo de envío." }, 400);
  const settings: { enabled?: boolean; sendHour?: number } = {};
  if (typeof body.enabled === "boolean") settings.enabled = body.enabled;
  if (body.sendHour !== undefined) {
    const hour = Number(body.sendHour);
    if (!Number.isInteger(hour) || hour < 7 || hour > 18) return json({ error: "La hora debe estar entre las 7 y las 18." }, 400);
    settings.sendHour = hour;
  }
  try {
    await updateSettings(user.userId, settings);
    // Al activar, si ya es hora, se envía lo pendiente sin esperar a la próxima revisión horaria.
    if (settings.enabled) void runReminderCycle({ ownerId: user.userId }).catch(() => undefined);
    return json({ sender: view(await getSender(user.userId)) });
  } catch { return json({ error: "No se pudo guardar." }, 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  try { await sendTestMail(user.userId); return json({ ok: true }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar la prueba." }, 502); }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  try { await removeSender(user.userId); return json({ sender: { connected: false } }); }
  catch { return json({ error: "No se pudo desconectar." }, 500); }
}
