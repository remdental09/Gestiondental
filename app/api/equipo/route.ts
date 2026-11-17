import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf, spaceRoleOf, type ChatGPTUser } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { loadClinic } from "@/app/clinic-profile-db";
import {
  acceptInvite, declineInvite, leaveClinic, listMembers, membershipsOf, renewInvite, revokeMember, setMemberRole, upsertInvite, type TeamDb,
} from "@/app/clinic-team-db";
import {
  ROLE_LABEL, canManageTeam, checkInvite, checkRoleChange, inviteEmail, inviteExpiry, inviteMessage, isExpired, normalizeEmail, visibleStatus, type TeamRole,
} from "@/lib/clinic-team";
import { getSender } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { buildRawMessage } from "@/lib/appointment-mail";
import { displayName } from "@/lib/clinician-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SPACE_COOKIE = "gd_espacio";
const headers = { "Cache-Control": "no-store" };
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers });
const teamDb = () => (env as unknown as { DB?: TeamDb }).DB;
const spaceCookie = (value: string) => `${SPACE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 86_400}`;

async function nameOf(ownerId: string, fallback: string) {
  const profile = await loadProfile(ownerId).catch(() => null);
  return profile ? displayName(profile) : fallback;
}

async function clinicLabel(clinicId: string) {
  const clinic = await loadClinic(clinicId).catch(() => null);
  return clinic?.clinicName?.trim() || (await nameOf(clinicId, "Clínica")) ;
}

async function state(user: ChatGPTUser, db: TeamDb, origin: string) {
  const now = new Date();
  const personalId = personalIdOf(user);
  const role = spaceRoleOf(user);
  const mine = await membershipsOf(db, normalizeEmail(user.email));
  const active = mine.filter(m => m.status === "activa" && m.clinicId !== personalId);
  const pending = mine.filter(m => m.status === "invitada" && !isExpired(m, now) && m.clinicId !== personalId);
  const spaceName = await clinicLabel(user.userId);
  const manage = canManageTeam(role);
  const members = await listMembers(db, user.userId);
  const titularName = await nameOf(user.userId, "Titular");
  return {
    space: { name: spaceName, role, roleLabel: ROLE_LABEL[role], inClinic: personalId !== user.userId, manage },
    spaces: [
      { id: personalId, name: "Mi espacio personal", current: personalId === user.userId },
      ...await Promise.all(active.map(async m => ({ id: m.clinicId, name: await clinicLabel(m.clinicId), current: m.clinicId === user.userId }))),
    ],
    invitations: await Promise.all(pending.map(async m => ({ clinicId: m.clinicId, clinicName: await clinicLabel(m.clinicId), invitedBy: await nameOf(m.invitedBy, "Un colega"), role: m.role, roleLabel: ROLE_LABEL[m.role], expiresAt: m.expiresAt }))),
    team: {
      titular: titularName,
      // Quien no administra ve solo a los miembros activos; el administrador ve también invitaciones e historial.
      members: members
        .filter(m => manage || m.status === "activa")
        .map(m => ({ email: m.email, name: m.name, role: m.role, roleLabel: ROLE_LABEL[m.role], status: visibleStatus(m, now), invitedAt: m.invitedAt, acceptedAt: m.acceptedAt, expiresAt: m.expiresAt, isMe: m.email === normalizeEmail(user.email) })),
      message: manage ? inviteMessage(spaceName === "Clínica" ? "" : spaceName, await nameOf(personalId, user.displayName), origin) : "",
    },
  };
}

export type InviteMailResult = { sent: true; to: string; from: string } | { sent: false; to: string; reason: "sin-correo" | "error"; detail?: string };

/**
 * La invitación se avisa sola por correo, desde el Gmail que la clínica conectó para enviar (Agenda → correos a pacientes;
 * si un administrador invita, se usa el de la clínica y, si no hay, el suyo). Sin Gmail conectado o si Gmail falla,
 * la invitación igual queda creada y la interfaz ofrece WhatsApp, correo manual o copiar el mensaje.
 */
async function mailInvite(clinicId: string, personalId: string, to: string, role: TeamRole, inviterName: string, origin: string): Promise<InviteMailResult> {
  const sender = await getSender(clinicId).catch(() => null) ?? (personalId !== clinicId ? await getSender(personalId).catch(() => null) : null);
  if (!sender) return { sent: false, to, reason: "sin-correo" };
  try {
    const clinicName = await clinicLabel(clinicId);
    const mail = inviteEmail({ clinicName: clinicName === "Clínica" ? "" : clinicName, inviterName, appUrl: origin, invitedEmail: to, roleLabel: ROLE_LABEL[role] });
    await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: clinicName === "Clínica" ? "SpeakDent" : clinicName, to, replyTo: sender.google_email, ...mail }));
    return { sent: true, to, from: sender.google_email };
  } catch (error) {
    return { sent: false, to, reason: "error", detail: error instanceof Error ? error.message.slice(0, 200) : "error" };
  }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail("Inicia sesión.", 401);
  const db = teamDb();
  if (!db) return fail("La base de datos no está disponible.", 503);
  try { return Response.json(await state(user, db, new URL(request.url).origin), { headers }); }
  catch { return fail("No se pudo leer el equipo.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail("Inicia sesión.", 401);
  const origin = new URL(request.url).origin;
  const sentFrom = request.headers.get("origin");
  if (sentFrom && sentFrom !== origin) return fail("Origen no permitido.", 403);
  const db = teamDb();
  if (!db) return fail("La base de datos no está disponible.", 503);
  let body: Record<string, unknown>;
  try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return fail("Solicitud no válida."); }

  const now = new Date();
  const stamp = now.toISOString();
  const personalId = personalIdOf(user);
  const myEmail = normalizeEmail(user.email);
  const clinicId = user.userId;
  const manage = canManageTeam(spaceRoleOf(user));
  const action = body.action;
  const done = async (extra: Record<string, unknown> = {}, cookie?: string) => {
    const response = Response.json({ ...await state(user, db, origin), ...extra }, { headers });
    if (cookie) response.headers.append("Set-Cookie", cookie);
    return response;
  };

  try {
    if (action === "invitar") {
      if (!manage) return fail("Solo un administrador puede invitar.", 403);
      const checked = checkInvite({ email: body.email, role: body.role }, { inviterEmail: myEmail, existing: await listMembers(db, clinicId), now });
      if (!checked.ok) return fail(checked.error);
      await upsertInvite(db, clinicId, checked.email, checked.role, personalId, stamp, inviteExpiry(now));
      const mail = await mailInvite(clinicId, personalId, checked.email, checked.role, await nameOf(personalId, user.displayName), origin);
      return done({ invited: checked.email, mail });
    }
    if (action === "reenviar" || action === "revocar" || action === "rol") {
      if (!manage) return fail("Solo un administrador puede cambiar el equipo.", 403);
      const email = normalizeEmail(body.email);
      const target = (await listMembers(db, clinicId)).find(m => m.email === email);
      if (!target) return fail("Esa persona no está en el equipo.", 404);
      if (action === "reenviar") {
        if (target.status !== "invitada") return fail("Solo se reenvía una invitación pendiente.");
        await renewInvite(db, clinicId, email, inviteExpiry(now));
        const mail = await mailInvite(clinicId, personalId, email, target.role, await nameOf(personalId, user.displayName), origin);
        return done({ invited: email, mail });
      } else if (action === "revocar") {
        if (email === myEmail) return fail("Para dejar la clínica usa «Salir de esta clínica».");
        await revokeMember(db, clinicId, email, stamp);
      } else {
        const checked = checkRoleChange(target, body.role);
        if (!checked.ok) return fail(checked.error);
        await setMemberRole(db, clinicId, email, checked.role);
      }
      return done();
    }
    if (action === "aceptar" || action === "rechazar") {
      const target = typeof body.clinicId === "string" ? body.clinicId : "";
      const invite = (await membershipsOf(db, myEmail)).find(m => m.clinicId === target && m.status === "invitada");
      if (!invite || target === personalId) return fail("No hay una invitación pendiente para este correo.", 404);
      if (action === "rechazar") { await declineInvite(db, target, myEmail); return done(); }
      if (isExpired(invite, now)) return fail("La invitación venció. Pide que te la reenvíen.", 410);
      const accepted = await acceptInvite(db, target, myEmail, personalId, await nameOf(personalId, user.displayName), stamp);
      if (!accepted) return fail("No se pudo aceptar la invitación. Pide que te la reenvíen.", 409);
      // Se entra directo a la clínica; la página se recarga para leer sus fichas.
      return done({ reload: true }, spaceCookie(target));
    }
    if (action === "salir") {
      if (personalId === clinicId) return fail("Estás en tu espacio personal.");
      await leaveClinic(db, clinicId, myEmail, stamp);
      return done({ reload: true }, spaceCookie(personalId));
    }
    if (action === "espacio") {
      const target = typeof body.spaceId === "string" ? body.spaceId : "";
      const allowed = target === personalId || (await membershipsOf(db, myEmail)).some(m => m.clinicId === target && m.status === "activa");
      if (!allowed) return fail("No perteneces a ese espacio.", 403);
      return done({ reload: true }, spaceCookie(target));
    }
    return fail("Acción no reconocida.");
  } catch {
    return fail("No se pudo guardar el cambio en el equipo.", 500);
  }
}
