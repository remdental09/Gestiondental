import { sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { ensureTeamTables, evolutionAuthors, type TeamDb } from "@/app/clinic-team-db";
import { getDb } from "@/db";

const teamDb = () => (env as unknown as { DB?: TeamDb }).DB;

/** Autor (id personal, correo y nombre) de lo que se guarda ahora en el espacio. */
export async function currentAuthor() {
  const viewer = await getChatGPTUser();
  const raw = teamDb();
  if (!viewer) throw new Error("Sin sesión para registrar el autor.");
  if (raw) await ensureTeamTables(raw);
  const personalId = personalIdOf(viewer);
  const profile = await loadProfile(personalId).catch(() => null);
  return { authorId: personalId, authorEmail: viewer.email, authorName: (profile ? displayName(profile) : viewer.displayName).slice(0, 120), recordedAt: new Date().toISOString() };
}

/**
 * Sentencia que registra al autor de la evolución recién insertada. Va en el MISMO batch que el INSERT
 * (usa last_insert_rowid()): si no se puede registrar el autor, tampoco se guarda la evolución, así una
 * evolución de un colega nunca queda atribuida por error al titular.
 * Se devuelve envuelto: una función async que devolviera la consulta la ejecutaría al resolverse.
 */
export async function authorStatement(db: ReturnType<typeof getDb>, spaceId: string) {
  return { statement: db.insert(evolutionAuthors).values({ ownerId: spaceId, evolutionId: sql`last_insert_rowid()`, ...await currentAuthor() }) };
}
