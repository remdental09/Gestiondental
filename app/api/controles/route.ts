import { getChatGPTUser } from "@/app/chatgpt-auth";
import { addControl, deleteControl, listControls, updateControl } from "@/app/followup-db";
import { isIsoDay, json, ownedPatient, positiveId, sameOrigin, shortText } from "@/app/followup-http";
import { isControlStatus } from "@/lib/next-control";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Próximos controles del espacio (con nombre y teléfono) o de un paciente (?patientId=). */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const raw = new URL(request.url).searchParams.get("patientId");
  let patientId: number | undefined;
  if (raw !== null) {
    const owned = await ownedPatient(user.userId, raw);
    if (!owned) return json({ error: "Paciente no encontrado." }, 404);
    patientId = owned;
  }
  try { return json({ controls: await listControls(user.userId, patientId) }); }
  catch { return json({ error: "No se pudieron leer los controles." }, 500); }
}

async function session(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: json({ error: "Inicia sesión." }, 401) } as const;
  if (!sameOrigin(request)) return { error: json({ error: "Origen no permitido." }, 403) } as const;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return { error: json({ error: "Solicitud inválida." }, 400) } as const;
  return { user, body } as const;
}

export async function POST(request: Request) {
  const s = await session(request);
  if ("error" in s) return s.error;
  const patientId = await ownedPatient(s.user.userId, s.body.patientId);
  if (!patientId) return json({ error: "Paciente no encontrado." }, 404);
  if (!isIsoDay(s.body.dueOn)) return json({ error: "Elige la fecha del control." }, 400);
  const reason = shortText(s.body.reason, 140) || "Control", note = shortText(s.body.note, 600);
  const evolutionId = s.body.evolutionId === undefined || s.body.evolutionId === null ? null : positiveId(s.body.evolutionId);
  try { return json({ control: await addControl(s.user.userId, { patientId, dueOn: s.body.dueOn, reason, note, evolutionId, createdBy: (s.user.fullName || s.user.displayName || "").slice(0, 120) }) }); }
  catch { return json({ error: "No se pudo guardar el control." }, 500); }
}

export async function PATCH(request: Request) {
  const s = await session(request);
  if ("error" in s) return s.error;
  const id = positiveId(s.body.id);
  if (!id) return json({ error: "Control inválido." }, 400);
  const patch: Parameters<typeof updateControl>[2] = {};
  if (s.body.dueOn !== undefined) { if (!isIsoDay(s.body.dueOn)) return json({ error: "Fecha inválida." }, 400); patch.dueOn = s.body.dueOn; }
  if (s.body.status !== undefined) { if (!isControlStatus(s.body.status)) return json({ error: "Estado inválido." }, 400); patch.status = s.body.status; }
  if (s.body.reason !== undefined) patch.reason = shortText(s.body.reason, 140) || "Control";
  if (s.body.note !== undefined) patch.note = shortText(s.body.note, 600);
  try {
    const control = await updateControl(s.user.userId, id, patch);
    return control ? json({ control }) : json({ error: "Control no encontrado." }, 404);
  } catch { return json({ error: "No se pudo guardar el control." }, 500); }
}

export async function DELETE(request: Request) {
  const s = await session(request);
  if ("error" in s) return s.error;
  const id = positiveId(s.body.id);
  if (!id) return json({ error: "Control inválido." }, 400);
  try { return (await deleteControl(s.user.userId, id)) ? json({ ok: true }) : json({ error: "Control no encontrado." }, 404); }
  catch { return json({ error: "No se pudo borrar el control." }, 500); }
}
