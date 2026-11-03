import { getChatGPTUser } from "@/app/chatgpt-auth";
import { syncGoogleDrive } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Se requiere iniciar sesión." }, { status: 401 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Un cuerpo vacío inicia la sincronización de las fichas pendientes.
  }
  try {
    return Response.json(await syncGoogleDrive(user, body), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "No se pudo guardar el respaldo en Google Drive. La ficha clínica sigue guardada en Gestión Dental." },
      { status: 502 },
    );
  }
}
