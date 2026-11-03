import { getChatGPTUser } from "@/app/chatgpt-auth";
import { beginGoogleDriveConnect } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("Se requiere iniciar sesión.", { status: 401 });
  return beginGoogleDriveConnect(request, user);
}
