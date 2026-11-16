import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadClinic, saveClinic } from "@/app/clinic-profile-db";
import { checkClinic } from "@/lib/clinic-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  try { return Response.json({ clinic: await loadClinic(user.userId), email: user.email }, { headers }); }
  catch { return error("No se pudo leer el perfil de la clínica.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return error("Solicitud no válida."); }
  const checked = checkClinic(body);
  if (!checked.ok) return error(checked.error);
  try {
    await saveClinic(user.userId, checked.clinic);
    return Response.json({ clinic: checked.clinic }, { headers });
  } catch { return error("No se pudo guardar el perfil de la clínica.", 500); }
}
