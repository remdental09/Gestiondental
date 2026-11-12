import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadDeveloperData } from "@/app/app-users-db";
import { buildDentistRows, dashboardSummary, isDeveloperEmail } from "@/lib/developer-dashboard";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** Lista de profesionales que entraron a SpeakDent. Solo para el desarrollador (DEVELOPER_EMAILS). */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Inicia sesión." }, 401);
  if (!isDeveloperEmail(user.email, (env as unknown as { DEVELOPER_EMAILS?: string }).DEVELOPER_EMAILS)) return json({ error: "Este panel es solo para el desarrollador." }, 403);
  try {
    const { users, profiles, patients, notes } = await loadDeveloperData();
    const dentists = buildDentistRows(users, profiles, patients, notes);
    return json({ dentists, summary: dashboardSummary(dentists), generatedAt: new Date().toISOString() });
  } catch {
    return json({ error: "No se pudo leer la base de datos." }, 503);
  }
}
