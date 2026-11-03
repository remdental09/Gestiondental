import { getChatGPTUser } from "@/app/chatgpt-auth";
import { googleDriveStatus } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Se requiere iniciar sesión." }, { status: 401 });
  try {
    return Response.json(await googleDriveStatus(user), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudo consultar la conexión con Google Drive." }, { status: 503 });
  }
}
