import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDigest, saveDigest, sendDigest, sendDigestTest } from "@/app/agenda-digest";
import { getSender } from "@/app/appointment-mail-db";
import { isValidEmail } from "@/lib/appointment-mail";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;

async function view(ownerId: string) {
  const [sender, digest] = await Promise.all([getSender(ownerId), getDigest(ownerId)]);
  return { mailConnected: Boolean(sender), from: sender?.google_email ?? "", enabled: digest?.enabled === 1, toEmail: digest?.to_email ?? "", sendHour: digest?.send_hour ?? 18, abbreviate: digest?.abbreviate === 1, lastSentAt: digest?.last_sent_at ?? null, lastResult: digest?.last_result ?? null };
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ digest: await view(user.userId) }); } catch { return json({ error: "No se pudo leer la configuración." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { enabled?: unknown; toEmail?: unknown; sendHour?: unknown; abbreviate?: unknown } | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const settings: { enabled?: boolean; toEmail?: string; sendHour?: number; abbreviate?: boolean } = {};
  if (body.toEmail !== undefined) {
    const email = typeof body.toEmail === "string" ? body.toEmail.trim() : "";
    if (email && !isValidEmail(email)) return json({ error: "Escribe un correo válido." }, 400);
    settings.toEmail = email;
  }
  if (typeof body.abbreviate === "boolean") settings.abbreviate = body.abbreviate;
  if (body.sendHour !== undefined) {
    const hour = Number(body.sendHour);
    if (!Number.isInteger(hour) || hour < 7 || hour > 18) return json({ error: "La hora debe estar entre las 7 y las 18." }, 400);
    settings.sendHour = hour;
  }
  if (typeof body.enabled === "boolean") {
    if (body.enabled) {
      if (!(await getSender(user.userId))) return json({ error: "Primero conecta el correo de envío." }, 400);
      const current = await getDigest(user.userId);
      const email = settings.toEmail ?? current?.to_email ?? "";
      if (!isValidEmail(email)) return json({ error: "Escribe el correo de quien recibirá la agenda." }, 400);
    }
    settings.enabled = body.enabled;
  }
  try { await saveDigest(user.userId, settings); return json({ digest: await view(user.userId) }); } catch { return json({ error: "No se pudo guardar." }, 500); }
}

/** {accion:"prueba"}: llega al correo de envío del clínico. {accion:"enviar"}: la envía ya a quien la recibe. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => ({})) as { accion?: unknown };
  try {
    const detail = body.accion === "enviar" ? await sendDigest(user.userId) : await sendDigestTest(user.userId);
    return json({ ok: true, detail, digest: await view(user.userId) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar." }, 502); }
}
