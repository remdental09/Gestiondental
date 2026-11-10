import { env } from "cloudflare:workers";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const database = () => (env as unknown as { DB?: Db }).DB;

let ready = false;
async function ensure(db: Db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS appointment_confirmations (owner_id TEXT NOT NULL, event_id INTEGER NOT NULL, start_at TEXT NOT NULL, confirmed_at TEXT NOT NULL, PRIMARY KEY (owner_id, event_id))").run();
  ready = true;
}

/** Citas marcadas como confirmadas. Si la cita cambió de hora después, deja de contar (hay que volver a confirmar). */
export async function loadConfirmations(ownerId: string): Promise<Record<number, string>> {
  const db = database();
  if (!db) return {};
  await ensure(db);
  const { results } = await db.prepare(
    "SELECT c.event_id AS event_id, c.confirmed_at AS confirmed_at FROM appointment_confirmations c JOIN calendar_events e ON e.id = c.event_id AND e.owner_id = c.owner_id WHERE c.owner_id = ? AND e.start_at = c.start_at"
  ).bind(ownerId).all<{ event_id: number; confirmed_at: string }>();
  return Object.fromEntries(results.map(row => [row.event_id, row.confirmed_at]));
}

/** Marca o desmarca una cita propia como confirmada. Devuelve false si la cita no existe o no es del usuario. */
export async function setConfirmation(ownerId: string, eventId: number, confirmed: boolean): Promise<boolean> {
  const db = database();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensure(db);
  const event = await db.prepare("SELECT start_at FROM calendar_events WHERE id = ? AND owner_id = ?").bind(eventId, ownerId).first<{ start_at: string }>();
  if (!event) return false;
  if (confirmed) {
    await db.prepare("INSERT INTO appointment_confirmations (owner_id, event_id, start_at, confirmed_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, event_id) DO UPDATE SET start_at = excluded.start_at, confirmed_at = excluded.confirmed_at")
      .bind(ownerId, eventId, event.start_at, new Date().toISOString()).run();
  } else {
    await db.prepare("DELETE FROM appointment_confirmations WHERE owner_id = ? AND event_id = ?").bind(ownerId, eventId).run();
  }
  return true;
}
