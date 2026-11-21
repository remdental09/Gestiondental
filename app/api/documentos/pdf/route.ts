import { getChatGPTUser } from "@/app/chatgpt-auth";
import { renderDocumentPdf } from "@/app/document-pdf";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** GET ?id=: PDF del documento emitido (el mismo que se envía por correo; también sirve para compartirlo por WhatsApp). */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "Inicia sesión." }, { status: 401 });
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Documento inválido." }, { status: 400 });
  try {
    const { bytes, fileName } = await renderDocumentPdf(user.userId, id, url.origin);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo generar el PDF." }, { status: 409 }); }
}
