import { env } from "cloudflare:workers";
import type { CustomPrestacion, NewItem } from "@/lib/custom-prestaciones";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement };
const database = () => (env as unknown as { DB?: Db }).DB;

async function ready(): Promise<Db> {
  const db = database();
  if (!db) throw new Error("La base de datos no está disponible.");
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS custom_prestaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, specialty TEXT NOT NULL, name TEXT NOT NULL, price INTEGER, created_at TEXT NOT NULL)"
  ).run();
  return db;
}

export async function listCustom(ownerId: string): Promise<CustomPrestacion[]> {
  const db = await ready();
  const { results } = await db.prepare("SELECT id, specialty, name, price FROM custom_prestaciones WHERE owner_id = ? ORDER BY specialty, name COLLATE NOCASE").bind(ownerId).all<CustomPrestacion>();
  return results;
}

/** Crea las que no existan ya (misma especialidad y nombre, sin distinguir mayúsculas). Devuelve cuántas se crearon y cuántas se omitieron. */
export async function createCustom(ownerId: string, specialty: string, items: NewItem[], max: number): Promise<{ created: number; skipped: number }> {
  const db = await ready();
  const existing = await listCustom(ownerId);
  const names = new Set(existing.filter(item => item.specialty === specialty).map(item => item.name.toLowerCase()));
  let room = max - existing.length;
  let created = 0, skipped = 0;
  for (const item of items) {
    if (names.has(item.name.toLowerCase()) || room <= 0) { skipped += 1; continue; }
    await db.prepare("INSERT INTO custom_prestaciones (owner_id, specialty, name, price, created_at) VALUES (?, ?, ?, ?, ?)").bind(ownerId, specialty, item.name, item.price, new Date().toISOString()).run();
    names.add(item.name.toLowerCase());
    room -= 1; created += 1;
  }
  return { created, skipped };
}

export async function updateCustom(ownerId: string, id: number, patch: { name?: string; price?: number | null }): Promise<boolean> {
  const db = await ready();
  const row = await db.prepare("SELECT id, specialty, name FROM custom_prestaciones WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<{ id: number; specialty: string; name: string }>();
  if (!row) return false;
  if (patch.name !== undefined) {
    const clash = await db.prepare("SELECT id FROM custom_prestaciones WHERE owner_id = ? AND specialty = ? AND lower(name) = lower(?) AND id <> ?").bind(ownerId, row.specialty, patch.name, id).first<{ id: number }>();
    if (clash) throw new Error("Ya tienes una prestación con ese nombre en esta especialidad.");
    await db.prepare("UPDATE custom_prestaciones SET name = ? WHERE id = ? AND owner_id = ?").bind(patch.name, id, ownerId).run();
  }
  if (patch.price !== undefined) await db.prepare("UPDATE custom_prestaciones SET price = ? WHERE id = ? AND owner_id = ?").bind(patch.price, id, ownerId).run();
  return true;
}

export async function deleteCustom(ownerId: string, id: number): Promise<boolean> {
  const db = await ready();
  const row = await db.prepare("SELECT id FROM custom_prestaciones WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<{ id: number }>();
  if (!row) return false;
  await db.prepare("DELETE FROM custom_prestaciones WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  return true;
}
