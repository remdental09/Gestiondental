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

export type TeamRole = "admin" | "dentista";
export type MemberStatus = "invitada" | "activa" | "revocada" | "rechazada";
/** Rol efectivo en el espacio en que se trabaja: el titular es el dueño del espacio. */
export type SpaceRole = "titular" | TeamRole;

export const TEAM_ROLES: TeamRole[] = ["admin", "dentista"];
export const ROLE_LABEL: Record<SpaceRole, string> = { titular: "Titular", admin: "Administrador", dentista: "Dentista" };
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
  return value === "admin" || value === "dentista";
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
  if (!isTeamRole(role)) return { ok: false, error: "Elige si será dentista o administrador." };
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
  return evolutionAuthor(recordedAuthorId, spaceId) === viewerPersonalId || canManageTeam(viewerRole);
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
  return `${who} te invitó a atender pacientes de ${clinic} en SpeakDent. Entra a ${appUrl} con «Entrar con Google» usando este mismo Gmail y acepta la invitación. Vence en ${INVITE_DAYS} días.`;
}
