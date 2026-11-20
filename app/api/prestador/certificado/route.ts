// Ver o descargar el Certificado de inscripción guardado. Solo el propio profesional (su carpeta en R2).
import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadRegistration } from "@/app/prestador-db";
import { ownsKey } from "@/lib/prestador-qr";

export const runtime = "edge";
export const dynamic = "force-dynamic";
type Bucket = { get(key: string): Promise<{ body: ReadableStream; size: number } | null> };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "Inicia sesión." }, { status: 401 });
  const personalId = personalIdOf(user);
  const row = await loadRegistration(personalId).catch(() => null);
  const key = row?.cert_key ?? "";
  if (!row || !ownsKey(personalId, key)) return Response.json({ error: "Aún no hay un certificado guardado." }, { status: 404 });
  const object = await (env as unknown as { BUCKET?: Bucket }).BUCKET?.get(key);
  if (!object) return Response.json({ error: "No se encontró el archivo del certificado. Súbelo de nuevo." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("descargar") === "1";
  const name = `Certificado-inscripcion-RNPI-${row.reg_sis || "profesional"}.pdf`;
  return new Response(object.body, { headers: {
    "Content-Type": "application/pdf", "Content-Length": String(object.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
  } });
}
