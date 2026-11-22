/**
 * Equipo de la clínica: un administrador invita a otros dentistas a atender a los pacientes de su clínica.
 *
 * Modelo: la «clínica» es el espacio de datos de su titular (su owner_id). Todos los pacientes, evoluciones,
 * odontogramas, imágenes y agenda ya viven particionados por ese owner_id, así que un miembro activo trabaja
 * dentro de ese mismo espacio y no hay que copiar ni fusionar fichas. Cada miembro conserva su espacio
 * personal (sus propios pacientes, si los tiene) y elige en cuál trabajar.
 *
 * Reglas:
 * - La invitación va a un correo de Google y no lleva enlace secreto: se acepta entrando a la app con ese correo.
 * - Vence a los 14 días; se puede reenviar (renueva el plazo) o revocar.
 * - Revocar corta el acceso en la siguiente solicitud; las evoluciones que el miembro escribió se conservan con su autoría.
 * - Una evolución solo la edita, anula o elimina quien la escribió (Ley 20.584: la autoría no se transfiere).
 * - Nunca se fusionan datos de un espacio con otro.
 */

/** «recepcion» y «asistente»: roles de apoyo (sin perfil profesional); sus permisos están en lib/role-policy.ts. */
export type TeamRole = "admin" | "dentista" | "recepcion" | "asistente";
export type MemberStatus = "invitada" | "activa" | "revocada" | "rechazada";
/** Rol efectivo en el espacio en que se trabaja: el titular es el dueño del espacio. */
export type SpaceRole = "titular" | TeamRole;

export const TEAM_ROLES: TeamRole[] = ["admin", "dentista", "recepcion", "asistente"];
export const ROLE_LABEL: Record<SpaceRole, string> = { titular: "Titular", admin: "Administrador", dentista: "Dentista", recepcion: "Recepción", asistente: "Asistente" };
/** Roles de apoyo: no escriben en la ficha clínica y no necesitan perfil profesional para aceptar la invitación. */
export const isSupportRole = (role: unknown): role is "recepcion" | "asistente" => role === "recepcion" || role === "asistente";
export const INVITE_DAYS = 14;
export const MAX_MEMBERS = 30;

export type TeamMember = {
  clinicId: string;
  email: string;
  role: TeamRole;
  status: MemberStatus;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  /** owner_id personal del miembro, conocido al aceptar. */
  memberId: string | null;
  name: string;
};

export type Space = { spaceId: string; role: SpaceRole; clinicId: string | null };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isTeamRole(value: unknown): value is TeamRole {
  return value === "admin" || value === "dentista" || value === "recepcion" || value === "asistente";
}

/** Plazo de una invitación nueva o reenviada. */
export function inviteExpiry(now: Date): string {
  return new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
}

export function isExpired(member: Pick<TeamMember, "status" | "expiresAt">, now: Date): boolean {
  return member.status === "invitada" && Date.parse(member.expiresAt) <= now.getTime();
}

/** Estado que ve la interfaz: una invitación vencida se muestra como tal, aunque en la base siga «invitada». */
export function visibleStatus(member: Pick<TeamMember, "status" | "expiresAt">, now: Date): MemberStatus | "vencida" {
  return isExpired(member, now) ? "vencida" : member.status;
}

export type InviteCheck = { ok: true; email: string; role: TeamRole } | { ok: false; error: string };

/** Valida una invitación antes de guardarla. `existing` son los miembros actuales de esa clínica. */
export function checkInvite(input: { email?: unknown; role?: unknown }, ctx: { inviterEmail: string; existing: TeamMember[]; now: Date }): InviteCheck {
  const email = normalizeEmail(input.email);
  if (!email || !EMAIL.test(email) || email.length > 200) return { ok: false, error: "Escribe un correo válido." };
  const role = input.role ?? "dentista";
  if (!isTeamRole(role)) return { ok: false, error: "Elige el rol: dentista, administrador, recepción o asistente." };
  if (email === normalizeEmail(ctx.inviterEmail)) return { ok: false, error: "Ya eres parte de esta clínica." };
  const current = ctx.existing.find(m => m.email === email);
  if (current?.status === "activa") return { ok: false, error: "Ese correo ya es parte del equipo." };
  if (current?.status === "invitada" && !isExpired(current, ctx.now)) return { ok: false, error: "Ya tiene una invitación pendiente. Puedes reenviarla." };
  const open = ctx.existing.filter(m => m.status === "activa" || (m.status === "invitada" && !isExpired(m, ctx.now)));
  if (!current && open.length >= MAX_MEMBERS) return { ok: false, error: `El equipo admite hasta ${MAX_MEMBERS} personas.` };
  return { ok: true, email, role };
}

/** Puede invitar, revocar y cambiar roles en este espacio. */
export function canManageTeam(role: SpaceRole): boolean {
  return role === "titular" || role === "admin";
}

/** Puede editar el perfil de la clínica (nombre, logo, dirección). */
export function canEditClinic(role: SpaceRole): boolean {
  return canManageTeam(role);
}

/**
 * Autor de una evolución. Las anteriores a esta función no tienen autor registrado: las escribió el titular
 * del espacio, porque hasta ahora nadie más tenía acceso.
 */
export function evolutionAuthor(recordedAuthorId: string | null | undefined, spaceId: string): string {
  return recordedAuthorId || spaceId;
}

/** Solo quien escribió una evolución la edita, anula o elimina. */
export function canChangeEvolution(recordedAuthorId: string | null | undefined, spaceId: string, viewerPersonalId: string): boolean {
  return evolutionAuthor(recordedAuthorId, spaceId) === viewerPersonalId;
}

/**
 * Un presupuesto lo modifican quien lo armó y el dueño de la clínica (titular o administradores que él nombra).
 * Otro dentista invitado no lo toca: el ortodoncista invitado establece sus presupuestos, pero no los de otros.
 */
export function canChangeBudget(recordedAuthorId: string | null | undefined, spaceId: string, viewerPersonalId: string, viewerRole: SpaceRole): boolean {
  // Recepción arma y modifica presupuestos de la clínica (los cobra y los confirma con el paciente).
  return evolutionAuthor(recordedAuthorId, spaceId) === viewerPersonalId || canManageTeam(viewerRole) || viewerRole === "recepcion";
}

/**
 * Espacio de datos en que trabaja una persona.
 * `requested`: el último espacio elegido (cookie). Solo se respeta si sigue siendo válido;
 * un miembro revocado vuelve a su espacio personal en la siguiente solicitud.
 * Sin elección previa, quien pertenece a una clínica entra a ella (la aceptó para trabajar ahí).
 */
export function chooseSpace(personalId: string, active: Array<Pick<TeamMember, "clinicId" | "role" | "acceptedAt">>, requested: string | null | undefined): Space {
  const personal: Space = { spaceId: personalId, role: "titular", clinicId: null };
  const valid = active.filter(m => m.clinicId && m.clinicId !== personalId);
  if (requested === personalId) return personal;
  const chosen = (requested && valid.find(m => m.clinicId === requested))
    || (!requested ? [...valid].sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""))[0] : undefined);
  return chosen ? { spaceId: chosen.clinicId, role: chosen.role, clinicId: chosen.clinicId } : personal;
}

/**
 * Puerta de entrada (portada): «Entrar a mi consulta» abre siempre el espacio personal; «Entrar a una clínica» abre
 * solo clínicas donde la persona es miembro activo. Así el colega nunca ve su consulta y la clínica por la misma puerta.
 * Sin entrada elegida (sesiones antiguas) se entra a la consulta personal: nunca a un espacio ajeno por omisión.
 */
export type Entry = "personal" | "clinica";
export const ENTRY_COOKIE = "gd_entrada";
export const parseEntry = (value: string | null | undefined): Entry => (value === "clinica" ? "clinica" : "personal");

export function chooseSpaceForEntry(personalId: string, active: Array<Pick<TeamMember, "clinicId" | "role" | "acceptedAt">>, requested: string | null | undefined, entry: Entry): Space {
  const personal: Space = { spaceId: personalId, role: "titular", clinicId: null };
  if (entry !== "clinica") return personal;
  // En la entrada de clínica, la cookie del espacio personal no cuenta: se elige entre las clínicas.
  return chooseSpace(personalId, active, requested === personalId ? null : requested);
}

/** Nombre visible de un espacio: el de la clínica si lo tiene; si no, «Clínica de <titular>» (nunca solo el nombre de una persona). */
export function clinicDisplayName(clinicName: string | null | undefined, titularName: string | null | undefined): string {
  const named = (clinicName ?? "").trim();
  if (named) return named;
  const owner = (titularName ?? "").trim();
  return owner ? `Clínica de ${owner}` : "Clínica";
}

/** No se puede dejar a una clínica sin nadie que la administre: el titular siempre lo hace, así que solo se valida el titular. */
export function checkRoleChange(target: Pick<TeamMember, "status">, role: unknown): { ok: true; role: TeamRole } | { ok: false; error: string } {
  if (!isTeamRole(role)) return { ok: false, error: "Rol no válido." };
  if (target.status !== "activa" && target.status !== "invitada") return { ok: false, error: "Esa persona ya no es parte del equipo." };
  return { ok: true, role };
}

/** Mensaje listo para avisar al colega (WhatsApp o correo); el acceso real lo da su Gmail, no este texto. */
export function inviteMessage(clinicName: string, inviterName: string, appUrl: string): string {
  const clinic = clinicName.trim() || "nuestra clínica";
  const who = inviterName.trim() || "Un colega";
  return `${who} te invitó a atender pacientes de ${clinic} en SpeakDent. Entra a ${appUrl}, pulsa «Entrar a una clínica» con este mismo Gmail y acepta la invitación. Tu consulta personal sigue aparte, en «Entrar a mi consulta». Vence en ${INVITE_DAYS} días.`;
}

const escHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Correo de invitación que la app envía sola desde el Gmail conectado de la clínica. No lleva enlace secreto: el acceso lo da el Gmail invitado. */
export function inviteEmail(input: { clinicName: string; inviterName: string; appUrl: string; invitedEmail: string; roleLabel: string }): { subject: string; text: string; html: string } {
  const clinic = input.clinicName.trim() || "su clínica";
  const who = input.inviterName.trim() || "Un colega";
  const role = input.roleLabel.trim().toLowerCase() || "dentista";
  const subject = `${who} te invitó a ${clinic} en SpeakDent`;
  const text = [
    "Hola:",
    "",
    `${who} te invitó a atender pacientes de ${clinic} en SpeakDent como ${role}.`,
    "",
    `1. Entra a ${input.appUrl}`,
    `2. Pulsa «Entrar a una clínica» con este mismo Gmail (${input.invitedEmail}).`,
    "3. Acepta la invitación.",
    "",
    "Tu consulta personal sigue aparte: entras a ella con «Entrar a mi consulta».",
    `La invitación vence en ${INVITE_DAYS} días. No necesitas instalar ni configurar nada.`,
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f">
<div style="max-width:520px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e6e4ee">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#473a6d">SpeakDent</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5"><strong>${escHtml(who)}</strong> te invitó a atender pacientes de <strong>${escHtml(clinic)}</strong> como ${escHtml(role)}.</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6">Pulsa <strong>«Entrar a una clínica»</strong> con este mismo Gmail (<strong>${escHtml(input.invitedEmail)}</strong>) y acepta la invitación. No necesitas instalar ni configurar nada.</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#57566a">Tu consulta personal sigue aparte: entras a ella con «Entrar a mi consulta».</p>
<p style="margin:0 0 20px"><a href="${escHtml(input.appUrl)}" style="display:inline-block;background:#473a6d;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Entrar a SpeakDent</a></p>
<p style="margin:0;font-size:12px;color:#6b6a7c">La invitación vence en ${INVITE_DAYS} días.</p>
</div></div></body></html>`;
  return { subject, text, html };
}
