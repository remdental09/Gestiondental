import { env } from "cloudflare:workers";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const db = () => (env as unknown as { DB?: Db }).DB;

export type TreatmentBox = { id: number; name: string; enabled: boolean };
export const MAX_BOXES = 20;
/** Los box que la clínica ya tenía: se crean una sola vez, la primera vez que se abre la configuración. */
const INITIAL_BOXES = ["Box 1", "Box 2", "Vitacura"];

async function ensureTable(database: Db) {
  await database.prepare("CREATE TABLE IF NOT EXISTS treatment_boxes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)").run();
  await database.prepare("CREATE INDEX IF NOT EXISTS treatment_boxes_owner ON treatment_boxes (owner_id)").run();
  await database.prepare("CREATE TABLE IF NOT EXISTS treatment_boxes_seeded (owner_id TEXT PRIMARY KEY)").run();
}

const row = (r: { id: number; name: string; enabled: number }): TreatmentBox => ({ id: r.id, name: r.name, enabled: r.enabled === 1 });

/** Box de la clínica (espacio). La primera vez se crean Box 1, Box 2 y Vitacura. */
export async function listBoxes(spaceId: string): Promise<TreatmentBox[]> {
  const database = db();
  if (!database) return [];
  await ensureTable(database);
  const seeded = await database.prepare("SELECT owner_id FROM treatment_boxes_seeded WHERE owner_id = ?").bind(spaceId).first<{ owner_id: string }>();
  if (!seeded) {
    const existing = await database.prepare("SELECT COUNT(*) AS n FROM treatment_boxes WHERE owner_id = ?").bind(spaceId).first<{ n: number }>();
    await database.prepare("INSERT OR IGNORE INTO treatment_boxes_seeded (owner_id) VALUES (?)").bind(spaceId).run();
    if (!existing?.n) {
      const at = new Date().toISOString();
      for (const name of INITIAL_BOXES) await database.prepare("INSERT INTO treatment_boxes (owner_id, name, enabled, created_at) VALUES (?, ?, 1, ?)").bind(spaceId, name, at).run();
    }
  }
  const { results } = await database.prepare("SELECT id, name, enabled FROM treatment_boxes WHERE owner_id = ? ORDER BY id").bind(spaceId).all<{ id: number; name: string; enabled: number }>();
  return results.map(row);
}

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "");

export async function saveBox(spaceId: string, input: { id?: number; name?: unknown; enabled?: unknown }): Promise<{ ok: true; boxes: TreatmentBox[] } | { ok: false; error: string }> {
  const database = db();
  if (!database) return { ok: false, error: "La base de datos no está disponible." };
  const boxes = await listBoxes(spaceId);
  const name = input.name === undefined ? undefined : clean(input.name);
  if (name !== undefined) {
    if (!name) return { ok: false, error: "Escribe el nombre del box." };
    if (boxes.some((box) => box.id !== input.id && box.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "Ya existe un box con ese nombre." };
  }
  if (input.id === undefined) {
    if (!name) return { ok: false, error: "Escribe el nombre del box." };
    if (boxes.length >= MAX_BOXES) return { ok: false, error: `Máximo ${MAX_BOXES} box.` };
    await database.prepare("INSERT INTO treatment_boxes (owner_id, name, enabled, created_at) VALUES (?, ?, 1, ?)").bind(spaceId, name, new Date().toISOString()).run();
  } else {
    const current = boxes.find((box) => box.id === input.id);
    if (!current) return { ok: false, error: "Box no encontrado." };
    const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
    await database.prepare("UPDATE treatment_boxes SET name = ?, enabled = ? WHERE id = ? AND owner_id = ?").bind(name ?? current.name, enabled ? 1 : 0, input.id, spaceId).run();
  }
  return { ok: true, boxes: await listBoxes(spaceId) };
}
