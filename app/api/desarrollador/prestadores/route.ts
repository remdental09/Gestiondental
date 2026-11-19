// Revisión de habilitaciones para recetas. Solo el desarrollador (DEVELOPER_EMAILS): compara los datos con el registro oficial y aprueba o rechaza.
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { listRegistrations, publicRegistration, reviewRegistration } from "@/app/prestador-db";
import { isDeveloperEmail } from "@/lib/developer-dashboard";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const developer = async () => {
  const user = await getChatGPTUser();
  if (!user) return { error: json({ error: "Inicia sesión." }, 401) };
  if (!isDeveloperEmail(user.email, (env as unknown as { DEVELOPER_EMAILS?: string }).DEVELOPER_EMAILS)) return { error: json({ error: "Solo para el desarrollador." }, 403) };
  return { user };
};

export async function GET() {
  const who = await developer(); if (who.error) return who.error;
  try { return json({ registrations: (await listRegistrations()).map(row => ({ professionalId: row.professional_id, email: row.email, status: row.status, reviewNote: row.review_note, updatedAt: row.updated_at, ...publicRegistration(row) })) }); }
  catch { return json({ error: "No se pudo leer las habilitaciones." }, 503); }
}

export async function POST(request: Request) {
  const who = await developer(); if (who.error) return who.error;
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { professionalId?: unknown; action?: unknown; note?: unknown } | null;
  const professionalId = typeof body?.professionalId === "string" ? body.professionalId.slice(0, 200) : "";
  if (!professionalId || (body?.action !== "aprobar" && body?.action !== "rechazar")) return json({ error: "Solicitud no válida." }, 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (body.action === "rechazar" && !note) return json({ error: "Indica el motivo del rechazo." }, 400);
  try {
    const row = await reviewRegistration(professionalId, body.action === "aprobar" ? "aprobado" : "rechazado", who.user!.email ?? "", note);
    return row ? json({ status: row.status }) : json({ error: "Registro no encontrado." }, 404);
  } catch { return json({ error: "No se pudo guardar la revisión." }, 500); }
}
