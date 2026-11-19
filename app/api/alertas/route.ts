import { getChatGPTUser } from "@/app/chatgpt-auth";
import { addAlert, deleteAlert, listAlerts, updateAlert } from "@/app/followup-db";
import { json, ownedPatient, positiveId, sameOrigin } from "@/app/followup-http";
import { normalizeAlertKind, normalizeAlertText } from "@/lib/patient-alerts";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Alertas manuales (médicas y administrativas) de un paciente del espacio. */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const patientId = await ownedPatient(user.userId, new URL(request.url).searchParams.get("patientId"));
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  try { return json({ alerts: await listAlerts(user.userId, patientId) }); }
  catch { return json({ error: "No se pudieron leer las alertas." }, 500); }
}

async function mutate(request: Request, run: (ownerId: string, patientId: number, body: Record<string, unknown>) => Promise<Response>) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const patientId = await ownedPatient(user.userId, body.patientId);
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  try { return await run(user.userId, patientId, body); }
  catch { return json({ error: "No se pudo guardar la alerta." }, 500); }
}

export const POST = (request: Request) => mutate(request, async (ownerId, patientId, body) => {
  const kind = normalizeAlertKind(body.kind), text = normalizeAlertText(body.text);
  if (!kind || !text) return json({ error: "Escribe la alerta." }, 400);
  if ((await listAlerts(ownerId, patientId)).length >= 40) return json({ error: "Máximo 40 alertas por paciente." }, 400);
  return json({ alert: await addAlert(ownerId, patientId, kind, text) });
});

export const PATCH = (request: Request) => mutate(request, async (ownerId, patientId, body) => {
  const id = positiveId(body.id), text = normalizeAlertText(body.text);
  if (!id || !text) return json({ error: "Escribe la alerta." }, 400);
  const alert = await updateAlert(ownerId, patientId, id, text);
  return alert ? json({ alert }) : json({ error: "Alerta no encontrada." }, 404);
});

export const DELETE = (request: Request) => mutate(request, async (ownerId, patientId, body) => {
  const id = positiveId(body.id);
  if (!id) return json({ error: "Alerta inválida." }, 400);
  return (await deleteAlert(ownerId, patientId, id)) ? json({ ok: true }) : json({ error: "Alerta no encontrada." }, 404);
});
