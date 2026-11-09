import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { patients } from "@/db/schema";
import { loadAnamnesis, saveAnamnesis } from "@/app/anamnesis-db";
import { structureAnamnesis } from "@/lib/dictation/openai-anamnesis";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function ownedPatient(ownerId: string, raw: unknown) {
  const patientId = Number(raw);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return null;
  const [p] = await getDb().select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  return p ? patientId : null;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const patientId = await ownedPatient(user.userId, new URL(request.url).searchParams.get("patientId"));
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  try { return json({ anamnesis: await loadAnamnesis(user.userId, patientId) }); }
  catch { return json({ error: "No se pudo leer la anamnesis." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { patientId?: unknown; anamnesis?: unknown } | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const patientId = await ownedPatient(user.userId, body.patientId);
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  try { return json({ anamnesis: await saveAnamnesis(user.userId, patientId, body.anamnesis) }); }
  catch { return json({ error: "No se pudo guardar la anamnesis." }, 500); }
}

/** Ordena un dictado en los campos de la anamnesis. No guarda: el clínico revisa y guarda. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { transcript?: unknown } | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length < 3) return json({ error: "Dicta o escribe la anamnesis primero." }, 400);
  if (transcript.length > 8_000) return json({ error: "El texto supera 8.000 caracteres." }, 400);
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return json({ error: "Falta configurar OPENAI_API_KEY para ordenar el dictado." }, 503);
  try { return json({ anamnesis: await structureAnamnesis(transcript, key, { model: env.OPENAI_TEXT_MODEL }) }); }
  catch { return json({ error: "La IA no respondió. Reintenta o completa el formulario a mano." }, 502); }
}
