import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadDocumentMark, saveDocumentMark } from "@/app/document-mark-db";
import { LOGO_MAX_CHARS, validLogo } from "@/lib/clinic-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para ver tu imagen de documentos.", 401);
  try { return Response.json({ documentMark: await loadDocumentMark(personalIdOf(user)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return fail("No se pudo leer tu imagen de documentos.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para guardar tu imagen de documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { documentMark?: unknown } | null;
  const mark = typeof body?.documentMark === "string" ? body.documentMark.trim() : "";
  if (mark && (mark.length > LOGO_MAX_CHARS || !validLogo(mark))) return fail("La imagen debe ser PNG, JPG o WebP y no superar 200x200 px.");
  try {
    await saveDocumentMark(personalIdOf(user), mark);
    return Response.json({ documentMark: mark }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo guardar tu imagen de documentos.", 500); }
}
