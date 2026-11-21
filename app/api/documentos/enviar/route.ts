import { getChatGPTUser } from "@/app/chatgpt-auth";
import { previewDocumentMail, sendDocumentPdf } from "@/app/document-pdf";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** GET ?id=: a quién se enviaría (para confirmar antes). */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Documento inválido." }, 400);
  try { return json({ preview: await previewDocumentMail(user.userId, id) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo preparar el correo." }, 409); }
}

/** POST {id}: genera el PDF y lo envía ya al correo registrado del paciente. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Documento inválido." }, 400);
  try { return json({ ok: true, ...(await sendDocumentPdf(user.userId, id, new URL(request.url).origin)) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar el correo." }, 502); }
}
