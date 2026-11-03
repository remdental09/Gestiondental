import { getChatGPTUser } from "@/app/chatgpt-auth";
import { finishGoogleDriveConnect } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("La sesión de Gestión Dental venció. Vuelve a abrir la aplicación.", { status: 401 });
  return finishGoogleDriveConnect(request, user);
}
