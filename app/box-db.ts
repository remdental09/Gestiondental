import { env } from "cloudflare:workers";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
export const db = () => (env as unknown as { DB?: Db }).DB;

import { BOX_COLUMNS_DDL, BOX_SCHEMA_DDL, isBoxKind, isHexColor, type BoxKind } from "@/lib/agenda-box";

export type TreatmentBox = { id: number; name: string; enabled: boolean; kind: BoxKind; color: string | null };
export const MAX_BOXES = 20;
/** Los box que la clínica ya tenía: se crean una sola vez, la primera vez que se abre la configuración. */
const INITIAL_BOXES = ["Box 1"];

async function ensureTable(database: Db) {
  await database.prepare("CREATE TABLE IF NOT EXISTS treatment_boxes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)").run();
  await database.prepare("CREATE INDEX IF NOT EXISTS treatment_boxes_owner ON treatment_boxes (owner_id)").run();
  await database.prepare("CREATE TABLE IF NOT EXISTS treatment_boxes_seeded (owner_id TEXT PRIMARY KEY)").run();
  await ensureBoxSchema(database);
}

let boxSchema: Promise<void> | null = null;
/** Tablas y columnas de la agenda por box (aditivas: horarios, bloqueos, box y profesional en la cita). */
export function ensureBoxSchema(database: Db): Promise<void> {
  boxSchema ??= (async () => {
    for (const sql of BOX_SCHEMA_DDL) await database.prepare(sql).run();
    for (const sql of BOX_COLUMNS_DDL) { try { await database.prepare(sql).run(); } catch { /* la columna ya existe */ } }
  })().catch((cause) => { boxSchema = null; throw cause; });
  return boxSchema;
}

type BoxRow = { id: number; name: string; enabled: number; kind: string | null; color: string | null };
const row = (r: BoxRow): TreatmentBox => ({ id: r.id, name: r.name, enabled: r.enabled === 1, kind: isBoxKind(r.kind) ? r.kind : "odontologia", color: isHexColor(r.color) ? r.color : null });

/** Box de la clínica (espacio). La primera vez se crea «Box 1» (las cuentas ya sembradas conservan los suyos). */
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
  const { results } = await database.prepare("SELECT id, name, enabled, kind, color FROM treatment_boxes WHERE owner_id = ? ORDER BY id").bind(spaceId).all<BoxRow>();
  return results.map(row);
}

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "");

export async function saveBox(spaceId: string, input: { id?: number; name?: unknown; enabled?: unknown; kind?: unknown; color?: unknown }): Promise<{ ok: true; boxes: TreatmentBox[] } | { ok: false; error: string }> {
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
    await database.prepare("INSERT INTO treatment_boxes (owner_id, name, enabled, created_at, kind, color) VALUES (?, ?, 1, ?, ?, ?)").bind(spaceId, name, new Date().toISOString(), isBoxKind(input.kind) ? input.kind : "odontologia", isHexColor(input.color) ? input.color : null).run();
  } else {
    const current = boxes.find((box) => box.id === input.id);
    if (!current) return { ok: false, error: "Box no encontrado." };
    const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
    const kind = isBoxKind(input.kind) ? input.kind : current.kind;
    const color = isHexColor(input.color) ? input.color : current.color;
    await database.prepare("UPDATE treatment_boxes SET name = ?, enabled = ?, kind = ?, color = ? WHERE id = ? AND owner_id = ?").bind(name ?? current.name, enabled ? 1 : 0, kind, color, input.id, spaceId).run();
  }
  return { ok: true, boxes: await listBoxes(spaceId) };
}
