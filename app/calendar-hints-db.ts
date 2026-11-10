import { env } from "cloudflare:workers";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };

export const HINTS_DDL = "CREATE TABLE IF NOT EXISTS calendar_event_hints (owner_id TEXT NOT NULL, calendar_id TEXT NOT NULL, google_event_id TEXT NOT NULL, hint TEXT NOT NULL, PRIMARY KEY (owner_id, calendar_id, google_event_id))";
export const HINTS_UPSERT = "INSERT INTO calendar_event_hints (owner_id, calendar_id, google_event_id, hint) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, calendar_id, google_event_id) DO UPDATE SET hint = excluded.hint";
export const HINTS_DELETE = "DELETE FROM calendar_event_hints WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?";

/** Celulares y correos hallados en la descripción o los invitados de cada cita, por id de cita. Solo se guardan esos datos, no el texto. */
export async function loadHints(ownerId: string): Promise<Record<number, string>> {
  const db = (env as unknown as { DB?: Db }).DB;
  if (!db) return {};
  await db.prepare(HINTS_DDL).run();
  const { results } = await db.prepare(
    "SELECT e.id AS id, h.hint AS hint FROM calendar_event_hints h JOIN calendar_events e ON e.owner_id = h.owner_id AND e.calendar_id = h.calendar_id AND e.google_event_id = h.google_event_id WHERE h.owner_id = ? AND e.status = 'confirmed'"
  ).bind(ownerId).all<{ id: number; hint: string }>();
  return Object.fromEntries(results.map(row => [row.id, row.hint]));
}
