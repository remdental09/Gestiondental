import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadHidden, loadNames, loadPrices, savePrice, setHidden, setName } from "@/app/aranceles-db";
import { normalizePrice } from "@/lib/aranceles";
import { normalizeName } from "@/lib/custom-prestaciones";
import { prestacionByCode } from "@/lib/prestaciones-catalog";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

export async function GET() {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  try { const [prices, hidden, names] = await Promise.all([loadPrices(ownerId), loadHidden(ownerId), loadNames(ownerId)]); return Response.json({ prices, hidden, names }, { headers }); } catch { return fail("No se pudo leer el arancel.", 500); }
}

/** Fija (price = número) o quita (price = null) el precio de una prestación del catálogo. */
export async function PUT(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  try {
    const body = await request.json() as { code?: unknown; price?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!prestacionByCode(code)) return fail("Prestación no encontrada en el catálogo.");
    if (body.price === null) { await savePrice(ownerId, code, null); return Response.json({ code, price: null }, { headers }); }
    const price = normalizePrice(body.price);
    if (price === null) return fail("El precio debe ser un número entero en pesos, mayor que 0.");
    await savePrice(ownerId, code, price);
    return Response.json({ code, price }, { headers });
  } catch { return fail("No se pudo guardar el precio.", 500); }
}

/** Borra (hidden = true) o recupera (hidden = false) una prestación del catálogo en la lista de este profesional. */
export async function POST(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  try {
    const body = await request.json() as { code?: unknown; hidden?: unknown; name?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!prestacionByCode(code)) return fail("Prestación no encontrada en el catálogo.");
    if ("name" in body) {
      if (body.name === null) { await setName(ownerId, code, null); return Response.json({ code, name: null }, { headers }); }
      const name = normalizeName(body.name);
      if (!name) return fail("El nombre debe tener entre 3 y 120 letras.");
      await setName(ownerId, code, name);
      return Response.json({ code, name }, { headers });
    }
    if (typeof body.hidden !== "boolean") return fail("Solicitud no válida.");
    await setHidden(ownerId, code, body.hidden);
    return Response.json({ code, hidden: body.hidden }, { headers });
  } catch { return fail("No se pudo actualizar la prestación.", 500); }
}
