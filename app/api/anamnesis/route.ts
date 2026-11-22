import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { aiLimitResponse, trackAi } from "@/app/ai-guard";
import { getDb } from "@/db";
import { evolutions, patients } from "@/db/schema";
import { loadAnamnesis, saveAnamnesis } from "@/app/anamnesis-db";
import { anamnesisFromNotes, structureAnamnesis, structureInterview } from "@/lib/dictation/openai-anamnesis";
import { localAnamnesisFromText } from "@/lib/anamnesis-interview";
import { addMissingMedications } from "@/lib/anamnesis-drugs";

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
  const body = await request.json().catch(() => null) as { transcript?: unknown; patientId?: unknown; fromEvolutions?: unknown; mode?: unknown } | null;
  // El uso de IA cuenta contra la cuenta (espacio) en que se trabaja: en una clínica, la del titular.
  const account = user.userId;
  const limited = await aiLimitResponse(account);
  if (limited) return limited;
  if (env.OPENAI_API_KEY?.trim()) void trackAi(account, { calls: 1 });
  if (body?.fromEvolutions === true) {
    const patientId = await ownedPatient(user.userId, body.patientId);
    if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) return json({ error: "Falta configurar OPENAI_API_KEY para armar la anamnesis." }, 503);
    const notes = await getDb().select({ date: evolutions.clinicalDate, body: evolutions.body }).from(evolutions)
      .where(and(eq(evolutions.ownerId, user.userId), eq(evolutions.patientId, patientId), eq(evolutions.status, "vigente")));
    if (!notes.length) return json({ error: "Este paciente no tiene evoluciones registradas." }, 400);
    try { const result = await anamnesisFromNotes(notes, apiKey, { model: env.OPENAI_TEXT_MODEL }); return json(result); }
    catch (cause) { return json({ error: cause instanceof Error && /sin evoluciones|no tiene evoluciones/.test(cause.message) ? cause.message : "La IA no respondió. Reintenta o completa el formulario a mano." }, 502); }
  }
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length < 3) return json({ error: "Dicta o escribe la anamnesis primero." }, 400);
  if (transcript.length > 8_000) return json({ error: "El texto supera 8.000 caracteres." }, 400);
  const key = env.OPENAI_API_KEY?.trim();
  if (body?.mode === "interview") {
    // Entrevista con el paciente: la IA separa voces y extrae solo lo que el paciente afirma. Si falla, orden local conservador (todo en ámbar).
    if (!key) return json({ ...localAnamnesisFromText(transcript), warning: "Falta OPENAI_API_KEY: se ordenó sin IA. Revisa cada campo." });
    try {
      const result = await structureInterview(transcript, key, { model: env.OPENAI_TEXT_MODEL });
      // Red de seguridad: todo fármaco que el paciente nombró queda en «Medicamentos», aunque la IA lo haya omitido (en ámbar para confirmar).
      const { anamnesis, added } = addMissingMedications(result.anamnesis, transcript);
      return json({ ...result, anamnesis, doubtful: added.length && !result.doubtful.includes("medications") ? [...result.doubtful, "medications"] : result.doubtful });
    }
    catch { return json({ ...localAnamnesisFromText(transcript), warning: "La IA no respondió: se ordenó sin IA a partir de la transcripción. Revisa cada campo en ámbar." }); }
  }
  if (!key) return json({ error: "Falta configurar OPENAI_API_KEY para ordenar el dictado." }, 503);
  try { return json({ anamnesis: addMissingMedications(await structureAnamnesis(transcript, key, { model: env.OPENAI_TEXT_MODEL }), transcript).anamnesis }); }
  catch { return json({ error: "La IA no respondió. Reintenta o completa el formulario a mano." }, 502); }
}
