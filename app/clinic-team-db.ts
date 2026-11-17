import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { TeamMember, TeamRole } from "@/lib/clinic-team";

/** Para insertar el autor en el mismo batch que la evolución (Drizzle). La tabla la crea `ensureTeamTables`. */
export const evolutionAuthors = sqliteTable("evolution_authors", {
  ownerId: text("owner_id").notNull(),
  evolutionId: integer("evolution_id").notNull(),
  authorId: text("author_id").notNull(),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name").notNull().default(""),
  recordedAt: text("recorded_at").notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.evolutionId] })]);

/**
 * Tabla `clinic_members`: quién pertenece a qué clínica. `clinic_id` es el owner_id del titular, que es
 * también la partición de sus fichas. Se crea sola la primera vez (mismo patrón que las demás tablas nuevas),
 * sin migración y sin tocar las tablas clínicas.
 */
type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
export type TeamDb = { prepare(sql: string): Stmt };

type Row = {
  clinic_id: string; email: string; role: string; status: string; invited_by: string; invited_at: string; expires_at: string;
  accepted_at: string | null; revoked_at: string | null; member_id: string | null; name: string;
};

const COLUMNS = "clinic_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at, member_id, name";

let ready = false;
export async function ensureTeamTables(db: TeamDb) {
  if (ready) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS clinic_members (clinic_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, " +
    "invited_by TEXT NOT NULL, invited_at TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT, revoked_at TEXT, member_id TEXT, " +
    "name TEXT NOT NULL DEFAULT '', PRIMARY KEY (clinic_id, email))"
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS clinic_members_email_idx ON clinic_members (email, status)").run();
  // Autoría de cada evolución: quién la escribió dentro de un espacio compartido.
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS evolution_authors (owner_id TEXT NOT NULL, evolution_id INTEGER NOT NULL, author_id TEXT NOT NULL, " +
    "author_email TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL, PRIMARY KEY (owner_id, evolution_id))"
  ).run();
  ready = true;
}

const toMember = (row: Row): TeamMember => ({
  clinicId: row.clinic_id, email: row.email, role: row.role === "admin" ? "admin" : "dentista",
  status: (["invitada", "activa", "revocada", "rechazada"].includes(row.status) ? row.status : "revocada") as TeamMember["status"],
  invitedBy: row.invited_by, invitedAt: row.invited_at, expiresAt: row.expires_at, acceptedAt: row.accepted_at,
  revokedAt: row.revoked_at, memberId: row.member_id, name: row.name,
});

/** Miembros (y su historia de invitaciones) de una clínica. */
export async function listMembers(db: TeamDb, clinicId: string): Promise<TeamMember[]> {
  await ensureTeamTables(db);
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM clinic_members WHERE clinic_id = ? ORDER BY status, invited_at DESC`).bind(clinicId).all<Row>();
  return results.map(toMember);
}

/** Todas las filas de un correo en cualquier clínica (invitaciones pendientes y membresías activas). */
export async function membershipsOf(db: TeamDb, email: string): Promise<TeamMember[]> {
  await ensureTeamTables(db);
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM clinic_members WHERE email = ? AND status IN ('invitada', 'activa')`).bind(email).all<Row>();
  return results.map(toMember);
}

/** Membresías activas de una persona; es lo único que consulta el Worker en cada solicitud. */
export async function activeMemberships(db: TeamDb, email: string): Promise<TeamMember[]> {
  return (await membershipsOf(db, email)).filter(m => m.status === "activa");
}

export async function upsertInvite(db: TeamDb, clinicId: string, email: string, role: TeamRole, invitedBy: string, now: string, expiresAt: string) {
  await ensureTeamTables(db);
  await db.prepare(
    `INSERT INTO clinic_members (${COLUMNS}) VALUES (?, ?, ?, 'invitada', ?, ?, ?, NULL, NULL, NULL, '') ` +
    "ON CONFLICT(clinic_id, email) DO UPDATE SET role = excluded.role, status = 'invitada', invited_by = excluded.invited_by, " +
    "invited_at = excluded.invited_at, expires_at = excluded.expires_at, accepted_at = NULL, revoked_at = NULL"
  ).bind(clinicId, email, role, invitedBy, now, expiresAt).run();
}

export async function renewInvite(db: TeamDb, clinicId: string, email: string, expiresAt: string) {
  await ensureTeamTables(db);
  await db.prepare("UPDATE clinic_members SET expires_at = ? WHERE clinic_id = ? AND email = ? AND status = 'invitada'").bind(expiresAt, clinicId, email).run();
}

/** Acepta solo si la invitación sigue pendiente y vigente (la condición va en el mismo UPDATE). */
export async function acceptInvite(db: TeamDb, clinicId: string, email: string, memberId: string, name: string, now: string): Promise<boolean> {
  await ensureTeamTables(db);
  await db.prepare(
    "UPDATE clinic_members SET status = 'activa', accepted_at = ?, member_id = ?, name = ? WHERE clinic_id = ? AND email = ? AND status = 'invitada' AND expires_at > ?"
  ).bind(now, memberId, name.slice(0, 120), clinicId, email, now).run();
  const row = await db.prepare("SELECT status FROM clinic_members WHERE clinic_id = ? AND email = ?").bind(clinicId, email).first<{ status: string }>();
  return row?.status === "activa";
}

export async function declineInvite(db: TeamDb, clinicId: string, email: string) {
  await ensureTeamTables(db);
  await db.prepare("UPDATE clinic_members SET status = 'rechazada' WHERE clinic_id = ? AND email = ? AND status = 'invitada'").bind(clinicId, email).run();
}

/** Revoca una invitación o una membresía. El acceso se corta en la siguiente solicitud del miembro. */
export async function revokeMember(db: TeamDb, clinicId: string, email: string, now: string) {
  await ensureTeamTables(db);
  await db.prepare("UPDATE clinic_members SET status = 'revocada', revoked_at = ? WHERE clinic_id = ? AND email = ? AND status IN ('invitada', 'activa')").bind(now, clinicId, email).run();
}

/** El propio miembro deja la clínica (mismo efecto que revocar). */
export const leaveClinic = revokeMember;

export async function setMemberRole(db: TeamDb, clinicId: string, email: string, role: TeamRole) {
  await ensureTeamTables(db);
  await db.prepare("UPDATE clinic_members SET role = ? WHERE clinic_id = ? AND email = ? AND status IN ('invitada', 'activa')").bind(role, clinicId, email).run();
}

export async function recordAuthor(db: TeamDb, spaceId: string, evolutionId: number, author: { id: string; email: string; name: string }) {
  await ensureTeamTables(db);
  await db.prepare("INSERT OR IGNORE INTO evolution_authors (owner_id, evolution_id, author_id, author_email, author_name, recorded_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(spaceId, evolutionId, author.id, author.email, author.name.slice(0, 120), new Date().toISOString()).run();
}

export type AuthorRow = { evolution_id: number; author_id: string; author_email: string; author_name: string };

export async function authorsOf(db: TeamDb, spaceId: string): Promise<Map<number, AuthorRow>> {
  await ensureTeamTables(db);
  const { results } = await db.prepare("SELECT evolution_id, author_id, author_email, author_name FROM evolution_authors WHERE owner_id = ?").bind(spaceId).all<AuthorRow>();
  return new Map(results.map(row => [row.evolution_id, row]));
}

export async function authorOf(db: TeamDb, spaceId: string, evolutionId: number): Promise<string | null> {
  await ensureTeamTables(db);
  const row = await db.prepare("SELECT author_id FROM evolution_authors WHERE owner_id = ? AND evolution_id = ?").bind(spaceId, evolutionId).first<{ author_id: string }>();
  return row?.author_id ?? null;
}
