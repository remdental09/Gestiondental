import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile, saveProfile, saveProfileTitle } from "@/app/clinician-profile-db";
import { PROFESSIONAL_TITLES, checkProfile, type ProfessionalTitle } from "@/lib/clinician-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  try {
    return Response.json({ profile: await loadProfile(personalIdOf(user)), email: user.email }, { headers });
  } catch {
    return error("No se pudo leer el registro.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return error("Solicitud no válida."); }
  const checked = checkProfile(body);
  if (!checked.ok) return error(checked.error);
  try {
    await saveProfile(personalIdOf(user), user.email, checked.profile);
    return Response.json({ profile: checked.profile }, { headers });
  } catch {
    return error("No se pudo guardar el registro.", 500);
  }
}

/** Solo el tratamiento («Dr.», «Dra.», «Dr(a).») del propio perfil. */
export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { title?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!(PROFESSIONAL_TITLES as readonly string[]).includes(title)) return error("Elige Dr., Dra. o Dr(a).");
  try {
    if (!(await saveProfileTitle(personalIdOf(user), title as ProfessionalTitle))) return error("Primero completa tu registro profesional.", 409);
    return Response.json({ profile: await loadProfile(personalIdOf(user)) }, { headers });
  } catch {
    return error("No se pudo guardar el título.", 500);
  }
}
