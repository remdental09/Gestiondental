import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patientIntakePublicLinks } from "@/db/schema";
import { newVerifyToken } from "@/lib/document-verification";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const PUBLIC_INTAKE_URL = "https://speakdent.cl/api/ingreso-paciente";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: noStore });

/** Devuelve el mismo enlace público de preingreso en cada visita, para compartirlo e imprimir su QR. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para obtener el QR de preingreso.", 401);
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 1_000) return fail("Solicitud inválida.", 413);

  const db = getDb();
  try {
    let [link] = await db.select().from(patientIntakePublicLinks).where(eq(patientIntakePublicLinks.ownerId, user.userId)).limit(1);
    for (let attempt = 0; !link && attempt < 3; attempt += 1) {
      const stamp = new Date().toISOString();
      await db.insert(patientIntakePublicLinks).values({
        ownerId: user.userId,
        publicToken: newVerifyToken(),
        createdAt: stamp,
        updatedAt: stamp,
      }).onConflictDoNothing();
      [link] = await db.select().from(patientIntakePublicLinks).where(eq(patientIntakePublicLinks.ownerId, user.userId)).limit(1);
    }
    if (!link) return fail("No se pudo preparar el enlace. Intenta de nuevo.", 503);
    return Response.json({ url: `${PUBLIC_INTAKE_URL}?c=${link.publicToken}`, createdAt: link.createdAt }, { headers: noStore });
  } catch {
    return fail("No se pudo preparar el enlace. Intenta de nuevo.", 503);
  }
}
