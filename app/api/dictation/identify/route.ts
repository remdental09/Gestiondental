import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patients } from "@/db/schema";
import { decidePatient } from "@/lib/dictation/patient-identify";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Decide a qué ficha va un dictado hecho desde Inicio. El cruce de RUT y nombre se hace aquí, en código,
 * contra D1: la lista de pacientes no se envía a la IA. No crea ni modifica nada.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión para dictar.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let body: unknown;
  try { body = await request.json(); }
  catch { return error("Solicitud inválida."); }
  const transcript = body && typeof body === "object" && typeof (body as Record<string, unknown>).transcript === "string" ? ((body as Record<string, unknown>).transcript as string).slice(0, 12000) : "";
  if (transcript.trim().length < 3) return error("El dictado está vacío.");
  const rows = await getDb().select({ id: patients.id, name: patients.name, rut: patients.rut }).from(patients).where(eq(patients.ownerId, user.userId));
  return Response.json(decidePatient(transcript, rows), { headers: { "Cache-Control": "no-store" } });
}
