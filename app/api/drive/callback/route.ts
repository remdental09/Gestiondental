import { SPACE_ADMIN_ONLY, getChatGPTUser, managesSpace } from "@/app/chatgpt-auth";
import { finishGoogleDriveConnect } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("La sesión de Gestión Dental venció. Vuelve a abrir la aplicación.", { status: 401 });
  if (!managesSpace(user)) return new Response(SPACE_ADMIN_ONLY, { status: 403 });
  return finishGoogleDriveConnect(request, user);
}
