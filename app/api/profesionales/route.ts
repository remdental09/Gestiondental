import { getChatGPTUser } from "@/app/chatgpt-auth";
import { deleteProfessional, listProfessionals, saveProfessional } from "@/app/professionals-db";
import { ownerSeedOf } from "@/app/professional-owner";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

/** Profesionales (dentistas) del espacio. La primera vez queda solo el dueño. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  return Response.json({ professionals: await listProfessionals(user.userId, await ownerSeedOf(user)) }, { headers });
}

/** POST {action:"crear", name, specialty?, rut?, color?} · {action:"guardar", id, name?, specialty?, rut?, color?, active?} · {action:"borrar", id} (solo si nunca se usó). */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud no válida."); }
  const seed = await ownerSeedOf(user);
  const id = Number(body.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const result = body.action === "crear"
    ? await saveProfessional(user.userId, seed, { name: body.name, specialty: body.specialty, rut: body.rut, color: body.color })
    : body.action === "guardar" && validId
      ? await saveProfessional(user.userId, seed, { id, name: body.name, specialty: body.specialty, rut: body.rut, color: body.color, active: body.active })
      : body.action === "borrar" && validId
        ? await deleteProfessional(user.userId, seed, id)
        : null;
  if (!result) return fail("Acción no válida.");
  return result.ok ? Response.json({ professionals: result.professionals }, { headers }) : fail(result.error);
}
