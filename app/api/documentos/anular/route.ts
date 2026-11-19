import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patientDocuments } from "@/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** Anula un documento emitido: nunca se borra; la verificación pública pasa a mostrarlo como anulado. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para anular documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("Documento no válido.");
  try {
    const db = getDb();
    const [doc] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).limit(1);
    if (!doc) return fail("Documento no encontrado.", 404);
    if (doc.status === "borrador") return fail("Un borrador no se anula: aún no fue emitido.");
    if (doc.revokedAt) return Response.json({ document: doc }, { headers: { "Cache-Control": "no-store" } });
    const [updated] = await db.update(patientDocuments).set({ revokedAt: new Date().toISOString(), revokedReason: "anulado", status: "anulado" })
      .where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).returning();
    return Response.json({ document: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo anular el documento.", 500); }
}
