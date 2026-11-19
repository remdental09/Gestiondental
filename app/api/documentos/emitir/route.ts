import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patientDocuments } from "@/db/schema";
import { documentHash, newVerifyToken } from "@/lib/document-verification";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** Emite un borrador: queda bloqueado, con código de verificación (QR) y huella de su contenido. Si reemplaza a otro emitido, ese pasa a «reemplazado». */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para emitir documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("Documento no válido.");
  try {
    const db = getDb();
    const [doc] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).limit(1);
    if (!doc) return fail("Documento no encontrado.", 404);
    if (doc.verifyToken && doc.issuedAt) return Response.json({ document: doc }, { headers: { "Cache-Control": "no-store" } });
    const issuedAt = new Date().toISOString();
    const verifyToken = newVerifyToken();
    const contentHash = await documentHash({ ownerId: doc.ownerId, patientId: doc.patientId, kind: doc.kind, title: doc.title, content: doc.content, createdBy: doc.createdBy, createdByName: doc.createdByName, issuedAt });
    // Solo emite si sigue siendo borrador (evita doble emisión simultánea).
    const [issued] = await db.update(patientDocuments).set({ status: "emitido", issuedAt, verifyToken, contentHash })
      .where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId), eq(patientDocuments.status, "borrador"))).returning();
    if (!issued) {
      const [again] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).limit(1);
      return again ? Response.json({ document: again }, { headers: { "Cache-Control": "no-store" } }) : fail("Documento no encontrado.", 404);
    }
    if (doc.replacesId) {
      await db.update(patientDocuments).set({ revokedAt: issuedAt, revokedReason: "reemplazado", status: "reemplazado" })
        .where(and(eq(patientDocuments.id, doc.replacesId), eq(patientDocuments.ownerId, user.userId), eq(patientDocuments.patientId, doc.patientId), eq(patientDocuments.status, "emitido")));
    }
    return Response.json({ document: issued, replacedId: doc.replacesId ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo emitir el documento.", 500); }
}
