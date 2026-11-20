import { SPACE_ADMIN_ONLY, getChatGPTUser, managesSpace } from "@/app/chatgpt-auth";
import { syncAppEventsFromGoogle, createAgendaEvent, deleteAgendaEvent, updateAgendaEvent, listCalendarChoices, listCalendarConnections, removeCalendarConnection, setCalendarChoice, syncGoogleCalendars } from "@/app/drive-oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  // Al abrir la agenda: trae lo que se movió o borró en Google (como máximo cada 2 minutos).
  const back = await syncAppEventsFromGoogle(user.userId, { onDemand: true }).catch(() => []);
  const agendaSynced = back.reduce((sum, item) => sum + item.moved + item.cancelled, 0);
  return json({ accounts: await listCalendarConnections(user.userId), calendars: await listCalendarChoices(user.userId), agendaSynced });
}

/** {action:"sync"} actualiza ahora; {action:"remove", id} desconecta una cuenta. Conectar se hace con /api/drive/connect?calendar=1. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { action?: unknown; id?: unknown; calendarId?: unknown; enabled?: unknown; eventId?: unknown; patientId?: unknown; title?: unknown; day?: unknown; time?: unknown; minutes?: unknown } | null;
  try {
    if (body?.action === "sync") { await syncAppEventsFromGoogle(user.userId).catch(() => []); const results = await syncGoogleCalendars(user.userId); return json({ results, accounts: await listCalendarConnections(user.userId), calendars: await listCalendarChoices(user.userId) }); }
    // Elegir o quitar calendarios cambia la agenda de toda la clínica; las citas sí las mueve cualquier dentista del equipo.
    if ((body?.action === "setCalendar" || body?.action === "remove") && !managesSpace(user)) return json({ error: SPACE_ADMIN_ONLY }, 403);
    if (body?.action === "setCalendar" && typeof body.id === "string" && typeof body.calendarId === "string" && typeof body.enabled === "boolean") {
      await setCalendarChoice(user.userId, body.id, body.calendarId, body.enabled);
      return json({ accounts: await listCalendarConnections(user.userId), calendars: await listCalendarChoices(user.userId) });
    }
    if (body?.action === "remove" && typeof body.id === "string") { await removeCalendarConnection(user.userId, body.id); return json({ accounts: await listCalendarConnections(user.userId) }); }
    // Cita de Google sin paciente reconocido: se le asigna desde la agenda y pasa a ser cita de la app.
    if (body?.action === "assignPatient" && Number.isSafeInteger(body.eventId) && Number(body.eventId) > 0 && Number.isSafeInteger(body.patientId) && Number(body.patientId) > 0) {
      const { assignPatientToCalendarEvent } = await import("@/app/calendar-two-way");
      const result = await assignPatientToCalendarEvent(user.userId, Number(body.eventId), Number(body.patientId));
      return result.ok ? json({ ok: true, appointmentId: result.appointmentId }) : json({ error: result.error }, 404);
    }
    if (body?.action === "deleteEvent" && Number.isSafeInteger(body.eventId) && Number(body.eventId) !== 0) {
      const result = await deleteAgendaEvent(user.userId, Number(body.eventId));
      return result.ok ? json({ ok: true }) : json({ error: result.error }, 409);
    }
    if (body?.action === "updateEvent" && Number.isSafeInteger(body.eventId) && Number(body.eventId) !== 0 && typeof body.title === "string" && typeof body.day === "string" && typeof body.time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
      const result = await updateAgendaEvent(user.userId, Number(body.eventId), { title: body.title, day: body.day, time: body.time });
      return result.ok ? json({ ok: true }) : json({ error: result.error }, 409);
    }
    if (body?.action === "createEvent" && typeof body.title === "string" && typeof body.day === "string" && typeof body.time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
      const result = await createAgendaEvent(user.userId, { title: body.title, day: body.day, time: body.time, minutes: Number(body.minutes) });
      return result.ok ? json({ ok: true }) : json({ error: result.error }, 409);
    }
    return json({ error: "Acción no reconocida." }, 400);
  } catch {
    return json({ error: "No se pudo completar la acción con el calendario." }, 500);
  }
}
