import { getChatGPTUser, spaceRoleOf } from "@/app/chatgpt-auth";
import { recordEvent } from "@/app/account-events";
import { addToWaitlist, listWaitlist, removeFromWaitlist } from "@/app/cycle-db";
import { ROLE_DENIED } from "@/lib/role-policy";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

/** GET → personas en la lista de espera del espacio (más antiguas primero). */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  return Response.json({ entries: await listWaitlist(user.userId) }, { headers });
}

/** POST {action:"agregar", patientId? | name, phone?, preference, note} · {action:"quitar", id}. Asistente: solo ver. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (spaceRoleOf(user) === "asistente") return fail(ROLE_DENIED, 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud no válida."); }
  if (body.action === "agregar") {
    const result = await addToWaitlist(user.userId, body, user.email ?? "");
    if (!result.ok) return fail(result.error);
    await recordEvent(user, "espera.agregar", result.entry.id, { patientId: result.entry.patientId });
    return Response.json({ entry: result.entry }, { status: 201, headers });
  }
  if (body.action === "quitar") {
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !(await removeFromWaitlist(user.userId, id))) return fail("No está en la lista.", 404);
    await recordEvent(user, "espera.quitar", id, {});
    return Response.json({ ok: true }, { headers });
  }
  return fail("Acción no válida.");
}
