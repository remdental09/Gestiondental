import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getSender, removeSender, updateSettings } from "@/app/appointment-mail-db";
import { previewReminder, runReminderCycle, sendReminderNow, sendTestMail } from "@/app/appointment-mail";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;

const view = (sender: Awaited<ReturnType<typeof getSender>>) => sender ? { connected: true, email: sender.google_email, enabled: sender.enabled === 1, sendHour: sender.send_hour, message: sender.custom_message ?? "", lastRunAt: sender.last_run_at, lastResult: sender.last_result } : { connected: false };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const eventParam = new URL(request.url).searchParams.get("eventId");
  if (eventParam !== null) {
    const eventId = Number(eventParam);
    if (!Number.isSafeInteger(eventId) || eventId < 1) return json({ error: "Cita inválida." }, 400);
    try { return json({ preview: await previewReminder(user.userId, eventId) }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo preparar el correo." }, 409); }
  }
  try { return json({ sender: view(await getSender(user.userId)) }); }
  catch { return json({ error: "No se pudo leer la configuración." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { enabled?: unknown; sendHour?: unknown; message?: unknown } | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const sender = await getSender(user.userId);
  if (!sender) return json({ error: "Primero conecta el correo de envío." }, 400);
  const settings: { enabled?: boolean; sendHour?: number; message?: string } = {};
  if (body.message !== undefined) {
    if (typeof body.message !== "string" || body.message.length > 600) return json({ error: "El mensaje puede tener hasta 600 caracteres." }, 400);
    settings.message = body.message;
  }
  if (typeof body.enabled === "boolean") settings.enabled = body.enabled;
  if (body.sendHour !== undefined) {
    const hour = Number(body.sendHour);
    if (!Number.isInteger(hour) || hour < 7 || hour > 18) return json({ error: "La hora debe estar entre las 7 y las 18." }, 400);
    settings.sendHour = hour;
  }
  try {
    await updateSettings(user.userId, settings);
    // Al activar, si ya es hora, se envía lo pendiente sin esperar a la próxima revisión horaria.
    if (settings.enabled) await runReminderCycle({ ownerId: user.userId }).catch(() => undefined);
    return json({ sender: view(await getSender(user.userId)) });
  } catch { return json({ error: "No se pudo guardar." }, 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => ({})) as { eventId?: unknown };
  // {eventId}: envía ya el correo de esa cita al paciente. Sin eventId: correo de prueba al propio clínico.
  if (body?.eventId !== undefined) {
    const eventId = Number(body.eventId);
    if (!Number.isSafeInteger(eventId) || eventId < 1) return json({ error: "Cita inválida." }, 400);
    try { return json({ ok: true, detail: await sendReminderNow(user.userId, eventId) }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar el correo." }, 502); }
  }
  try { return json({ ok: true, detail: await sendTestMail(user.userId) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar la prueba." }, 502); }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  try { await removeSender(user.userId); return json({ sender: { connected: false } }); }
  catch { return json({ error: "No se pudo desconectar." }, 500); }
}
