import { getChatGPTUser } from "@/app/chatgpt-auth";
import { listBoxes } from "@/app/box-db";
import { addBlock, createBoxAppointment, deleteSchedule, listBlocks, listSchedules, loadBoxAppointments, removeBlock, saveSchedule, setBoxStatus, updateBoxAppointment } from "@/app/agenda-box-db";
import { isIsoDay, addDays } from "@/lib/agenda-box";
import { isAttendanceStatus } from "@/lib/dashboard";
import { ownerSeedOf } from "@/app/professional-owner";
import { listProfessionals } from "@/app/professionals-db";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → box, horarios, bloqueos, citas (con estado) y pacientes para el buscador. */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!isIsoDay(from) || !isIsoDay(to) || to < from || to > addDays(from, 41)) return fail("Rango de fechas no válido.");
  // Lo movido en Google se trae antes de mostrar (como máximo cada 2 minutos; nunca bloquea la vista).
  const { syncAppEventsFromGoogle } = await import("@/app/drive-oauth");
  await syncAppEventsFromGoogle(user.userId, { onDemand: true }).catch(() => []);
  const seed = await ownerSeedOf(user);
  const professionals = await listProfessionals(user.userId, seed); // primero: enlaza nombres escritos a mano con la lista
  const [boxes, schedules, blocks, appointments] = await Promise.all([listBoxes(user.userId), listSchedules(user.userId), listBlocks(user.userId, from, to), loadBoxAppointments(user.userId, from, to)]);
  const { db } = await import("@/app/box-db");
  const patients = (await db()?.prepare("SELECT id, name, rut, phone FROM patients WHERE owner_id = ? ORDER BY name LIMIT 3000").bind(user.userId).all<{ id: number; name: string; rut: string | null; phone: string }>())?.results ?? [];
  const owner = professionals.find(p => p.isOwner && p.active) ?? professionals.find(p => p.active);
  return Response.json({ boxes, schedules, blocks, appointments, patients, professionals, professional: owner?.name ?? seed.name, defaultProfessionalId: owner?.id ?? null }, { headers });
}

const idOf = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/**
 * POST {action}:
 * «cita» {patientId | newPatient{name,phone}, day, time, minutes, boxId, reason, professionalId?} · «mover» {id, boxId?, time?, day?, minutes?, professionalId?}
 * «estado» {source:"app"|"cal", id, status} · «bloquear» {boxId, day, start, end, repeat, until, reason, note} · «quitarBloqueo» {id}
 * «horario» {id?, boxId, professionalId, weekdays[], start, end, validFrom, validTo, blockMinutes} · «borrarHorario» {id}
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud no válida."); }
  const owner = user.userId;
  switch (body.action) {
    case "cita": {
      const result = await createBoxAppointment(owner, body as never, await ownerSeedOf(user));
      return result.ok ? Response.json({ appointment: result.appointment, calendar: result.calendar }, { status: 201, headers }) : fail(result.error);
    }
    case "mover": {
      const id = idOf(body.id);
      if (!id) return fail("Cita no válida.");
      const result = await updateBoxAppointment(owner, id, { boxId: body.boxId, time: body.time, day: body.day, minutes: body.minutes, professionalId: body.professionalId });
      return result.ok ? Response.json({ ok: true }, { headers }) : fail(result.error);
    }
    case "estado": {
      const id = idOf(body.id);
      const source = body.source === "cal" ? "cal" : body.source === "app" ? "app" : null;
      if (!id || !source || !isAttendanceStatus(body.status)) return fail("Estado no válido.");
      return (await setBoxStatus(owner, source, id, body.status)) ? Response.json({ ok: true }, { headers }) : fail("Cita no encontrada.", 404);
    }
    case "bloquear": {
      const result = await addBlock(owner, body);
      return result.ok ? Response.json({ block: result.block }, { status: 201, headers }) : fail(result.error);
    }
    case "quitarBloqueo": {
      const id = idOf(body.id);
      return id && (await removeBlock(owner, id)) ? Response.json({ ok: true }, { headers }) : fail("Bloqueo no encontrado.", 404);
    }
    case "horario": {
      const result = await saveSchedule(owner, body, await ownerSeedOf(user));
      return result.ok ? Response.json({ schedules: result.schedules }, { headers }) : fail(result.error);
    }
    case "borrarHorario": {
      const id = idOf(body.id);
      if (!id) return fail("Horario no válido.");
      return Response.json({ schedules: await deleteSchedule(owner, id) }, { headers });
    }
    default:
      return fail("Acción no válida.");
  }
}
