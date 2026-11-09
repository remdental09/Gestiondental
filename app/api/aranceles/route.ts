import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadPrices, savePrice } from "@/app/aranceles-db";
import { normalizePrice } from "@/lib/aranceles";
import { prestacionByCode } from "@/lib/prestaciones-catalog";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

export async function GET() {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  try { return Response.json({ prices: await loadPrices(ownerId) }, { headers }); } catch { return fail("No se pudo leer el arancel.", 500); }
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
