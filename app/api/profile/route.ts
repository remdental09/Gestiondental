import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadProfile, saveProfile } from "@/app/clinician-profile-db";
import { checkProfile } from "@/lib/clinician-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  try {
    return Response.json({ profile: await loadProfile(user.userId), email: user.email }, { headers });
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
    await saveProfile(user.userId, user.email, checked.profile);
    return Response.json({ profile: checked.profile }, { headers });
  } catch {
    return error("No se pudo guardar el registro.", 500);
  }
}
