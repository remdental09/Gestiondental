import { getChatGPTUser } from "@/app/chatgpt-auth";
import { addControl, deleteControl, getControl, listControls, updateControl } from "@/app/followup-db";
import { backfillControlAppointments, cancelControlAppointment, completeControlAppointment, moveControlAppointment, rescheduleRemovedControl, restoreCancelledControl, scheduleControl } from "@/app/control-agenda";
import { isIsoDay, json, ownedPatient, positiveId, sameOrigin, shortText } from "@/app/followup-http";
import { DEFAULT_CONTROL_TIME, isClockTime, isControlStatus, weekendName } from "@/lib/next-control";

const todayInChile = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

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
  // Ida y vuelta: lo movido o borrado directo en Google Calendar se aplica antes de listar (como máximo cada 2 minutos).
  const { syncAppEventsFromGoogle } = await import("@/app/drive-oauth");
  const back = await syncAppEventsFromGoogle(user.userId, { onDemand: true }).catch(() => []);
  const agendaSynced = back.reduce((sum, item) => sum + item.moved + item.cancelled, 0);
  // Controles pendientes creados antes de que existiera la cita automática: se agendan una sola vez.
  await backfillControlAppointments(user.userId, todayInChile()).catch(() => 0);
  try { return json({ controls: await listControls(user.userId, patientId), agendaSynced }); }
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
  if (s.body.time !== undefined && !isClockTime(s.body.time)) return json({ error: "Hora inválida." }, 400);
  const time = isClockTime(s.body.time) ? s.body.time : DEFAULT_CONTROL_TIME;
  let control;
  try { control = await addControl(s.user.userId, { patientId, dueOn: s.body.dueOn, reason, note, evolutionId, createdBy: (s.user.fullName || s.user.displayName || "").slice(0, 120) }); }
  catch { return json({ error: "No se pudo guardar el control." }, 500); }
  // El control queda como cita en la agenda (y en Google Calendar si hay permiso de escritura).
  const agenda = await scheduleControl(s.user.userId, control.id, time).catch(() => null);
  return json({ control: agenda?.control ?? control, calendar: agenda?.calendar ?? "sin-cita", weekend: weekendName(control.dueOn) });
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
  if (s.body.time !== undefined && !isClockTime(s.body.time)) return json({ error: "Hora inválida." }, 400);
  const time = isClockTime(s.body.time) ? s.body.time : undefined;
  const ownerId = s.user.userId;
  try {
    const before = await getControl(ownerId, id);
    if (!before) return json({ error: "Control no encontrado." }, 404);
    let control = await updateControl(ownerId, id, patch);
    if (!control) return json({ error: "Control no encontrado." }, 404);
    let calendar: string = "sin-cita";
    const linked = { ...control, appointmentId: before.appointmentId };
    if (patch.status === "descartado") calendar = await cancelControlAppointment(ownerId, linked);
    else if (patch.status === "realizado") await completeControlAppointment(ownerId, linked);
    else if (linked.appointmentId && before.status === "descartado" && control.status !== "descartado") calendar = await restoreCancelledControl(ownerId, { ...control, appointmentId: linked.appointmentId }, time);
    else if (linked.appointmentId && (patch.dueOn !== undefined || time !== undefined || patch.reason !== undefined)) calendar = await moveControlAppointment(ownerId, linked, { day: control.dueOn, time, reason: control.reason });
    else if (!linked.appointmentId && control.status !== "realizado" && (patch.status === "agendado" || before.status === "descartado" || before.status === "realizado")) calendar = (await rescheduleRemovedControl(ownerId, id, time)).calendar;
    control = (await getControl(ownerId, id)) ?? control;
    return json({ control, calendar, weekend: weekendName(control.dueOn) });
  } catch { return json({ error: "No se pudo guardar el control." }, 500); }
}

export async function DELETE(request: Request) {
  const s = await session(request);
  if ("error" in s) return s.error;
  const id = positiveId(s.body.id);
  if (!id) return json({ error: "Control inválido." }, 400);
  // Al borrar el control también se quita su cita de la agenda.
  const existing = await getControl(s.user.userId, id).catch(() => null);
  if (existing?.appointmentId) await cancelControlAppointment(s.user.userId, existing).catch(() => undefined);
  try { return (await deleteControl(s.user.userId, id)) ? json({ ok: true }) : json({ error: "Control no encontrado." }, 404); }
  catch { return json({ error: "No se pudo borrar el control." }, 500); }
}
