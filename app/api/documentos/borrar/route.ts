import { and, eq } from "drizzle-orm";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patientDocuments } from "@/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** Borra únicamente borradores. Un documento emitido nunca se borra: solo se anula. */
export async function POST(request: Request) {
  await ensureDocumentIssuanceColumns();
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para borrar documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("Documento no válido.");
  try {
    const db = getDb();
    const [doc] = await db.select({ id: patientDocuments.id, status: patientDocuments.status }).from(patientDocuments)
      .where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).limit(1);
    if (!doc) return fail("Documento no encontrado.", 404);
    if (doc.status !== "borrador") return fail("Solo se pueden borrar borradores. Un documento emitido se anula, no se borra.", 409);
    await db.delete(patientDocuments).where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId), eq(patientDocuments.status, "borrador")));
    return Response.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo borrar el borrador.", 500); }
}
