import { getChatGPTUser } from "@/app/chatgpt-auth";
import { listBoxes, saveBox } from "@/app/box-db";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

/** Box de la clínica del espacio en que se entra (los comparte todo el equipo). */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  return Response.json({ boxes: await listBoxes(user.userId) }, { headers });
}

/** POST {action:"crear", name, kind?, color?} · {action:"guardar", id, name?, enabled?, kind?, color?}. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud no válida."); }
  const id = Number(body.id);
  const result = body.action === "crear"
    ? await saveBox(user.userId, { name: body.name, kind: body.kind, color: body.color })
    : body.action === "guardar" && Number.isSafeInteger(id) && id > 0
      ? await saveBox(user.userId, { id, ...(body.name !== undefined ? { name: body.name } : {}), ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}), kind: body.kind, color: body.color })
      : null;
  if (!result) return fail("Acción no válida.");
  return result.ok ? Response.json({ boxes: result.boxes }, { headers }) : fail(result.error);
}
