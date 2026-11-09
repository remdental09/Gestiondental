import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createCustom, deleteCustom, listCustom, updateCustom } from "@/app/custom-prestaciones-db";
import { normalizePrice } from "@/lib/aranceles";
import { checkNewItems, MAX_CUSTOM_PER_OWNER, normalizeName } from "@/lib/custom-prestaciones";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

async function owner(request?: Request): Promise<{ ownerId: string } | Response> {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request?.headers.get("origin");
  if (request && origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  return { ownerId };
}

export async function GET() {
  const who = await owner();
  if (who instanceof Response) return who;
  try { return Response.json({ items: await listCustom(who.ownerId) }, { headers }); } catch { return fail("No se pudieron leer tus prestaciones.", 500); }
}

/** Crea una o varias prestaciones propias (las variantes de una misma prestación llegan juntas). */
export async function POST(request: Request) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  try {
    const checked = checkNewItems(await request.json());
    if (!checked.ok) return fail(checked.error);
    const result = await createCustom(who.ownerId, checked.specialty, checked.items, MAX_CUSTOM_PER_OWNER);
    if (result.created === 0) return fail(result.skipped ? "Esas prestaciones ya existen en tu lista (o llegaste al máximo)." : "No se creó nada.");
    return Response.json({ ...result, items: await listCustom(who.ownerId) }, { headers });
  } catch { return fail("No se pudo crear la prestación.", 500); }
}

/** Cambia el precio (null = sin precio) y/o el nombre de una prestación propia. */
export async function PUT(request: Request) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  try {
    const body = await request.json() as { id?: unknown; name?: unknown; price?: unknown };
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id < 1) return fail("Prestación inválida.");
    const patch: { name?: string; price?: number | null } = {};
    if (body.name !== undefined) { const name = normalizeName(body.name); if (!name) return fail("El nombre debe tener entre 3 y 120 letras."); patch.name = name; }
    if (body.price !== undefined) {
      if (body.price === null) patch.price = null;
      else { const price = normalizePrice(body.price); if (price === null) return fail("El precio debe ser un número entero en pesos, mayor que 0."); patch.price = price; }
    }
    if (patch.name === undefined && patch.price === undefined) return fail("No hay cambios.");
    if (!await updateCustom(who.ownerId, id, patch)) return fail("Prestación no encontrada.", 404);
    return Response.json({ ok: true }, { headers });
  } catch (error) { return error instanceof Error && error.message.startsWith("Ya tienes") ? fail(error.message, 409) : fail("No se pudo guardar el cambio.", 500); }
}

export async function DELETE(request: Request) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  try {
    const id = Number((await request.json() as { id?: unknown }).id);
    if (!Number.isSafeInteger(id) || id < 1) return fail("Prestación inválida.");
    if (!await deleteCustom(who.ownerId, id)) return fail("Prestación no encontrada.", 404);
    return Response.json({ ok: true }, { headers });
  } catch { return fail("No se pudo eliminar la prestación.", 500); }
}
