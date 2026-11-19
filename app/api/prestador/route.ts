// Habilitación del profesional para emitir recetas: sube su Certificado de inscripción del Registro Nacional de Prestadores Individuales (PDF de la Superintendencia de Salud).
// La app lee solo los datos necesarios y descarta el archivo; el desarrollador aprueba tras compararlos con el registro oficial.
import { extractText, getDocumentProxy } from "unpdf";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { loadRegistration, publicRegistration, saveRegistration } from "@/app/prestador-db";
import { parsePrestadorCertificate, sameRun } from "@/lib/prestador-certificate";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const MAX_BYTES = 1_500_000;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const view = (row: Awaited<ReturnType<typeof loadRegistration>>) => row ? { status: row.status, reviewNote: row.review_note, ...publicRegistration(row) } : null;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ registration: view(await loadRegistration(personalIdOf(user))) }); } catch { return json({ error: "No se pudo leer tu habilitación." }, 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const form = await request.formData().catch(() => null);
  const file = form?.get("certificado");
  if (!(file instanceof File)) return json({ error: "Elige el PDF del certificado." }, 400);
  if (file.size < 1000 || file.size > MAX_BYTES) return json({ error: "El PDF debe pesar menos de 1,5 MB. Usa el original descargado de la Superintendencia." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return json({ error: "El archivo no es un PDF." }, 400);
  const personalId = personalIdOf(user);
  const profile = await loadProfile(personalId).catch(() => null);
  if (!profile) return json({ error: "Primero completa tu registro profesional (nombre, RUT y especialidad)." }, 409);
  let text = "";
  try { text = (await extractText(await getDocumentProxy(bytes), { mergePages: true })).text; } catch { return json({ error: "No se pudo leer el PDF. Descarga de nuevo el original, sin escanearlo." }, 400); }
  const parsed = parsePrestadorCertificate(text);
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  if (!sameRun(parsed.data.run, profile.rut)) return json({ error: "El RUN del certificado no coincide con el RUT de tu registro en la aplicación." }, 422);
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return json({ registration: view(await saveRegistration(personalId, user.email ?? "", parsed.data, fileHash)) }, 201);
  } catch { return json({ error: "No se pudo guardar tu habilitación." }, 500); }
}
