import { env } from "cloudflare:workers";
import type { PriceMap } from "@/lib/aranceles";

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Statement; batch?(statements: Statement[]): Promise<unknown> };
const arancelDb = () => (env as unknown as { DB?: Db }).DB;

async function ensureTable(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS prestacion_prices (owner_id TEXT NOT NULL, code TEXT NOT NULL, price INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, code))"
  ).run();
}

async function ensureHidden(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS hidden_prestaciones (owner_id TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, code))"
  ).run();
}

/** Prestaciones del catálogo que este profesional borró de su lista (la lista base no cambia para los demás). */
export async function loadHidden(ownerId: string): Promise<string[]> {
  const database = arancelDb();
  if (!database) return [];
  await ensureHidden(database);
  const { results } = await database.prepare("SELECT code FROM hidden_prestaciones WHERE owner_id = ?").bind(ownerId).all<{ code: string }>();
  return results.map(row => row.code);
}

export async function setHidden(ownerId: string, code: string, hidden: boolean) {
  const database = arancelDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureHidden(database);
  if (hidden) await database.prepare("INSERT OR IGNORE INTO hidden_prestaciones (owner_id, code, created_at) VALUES (?, ?, ?)").bind(ownerId, code, new Date().toISOString()).run();
  else await database.prepare("DELETE FROM hidden_prestaciones WHERE owner_id = ? AND code = ?").bind(ownerId, code).run();
}

async function ensureNames(database: Db) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS prestacion_names (owner_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, code))"
  ).run();
}

/** Nombres que este profesional cambió en prestaciones del catálogo (código → nombre propio). */
export async function loadNames(ownerId: string): Promise<Record<string, string>> {
  const database = arancelDb();
  if (!database) return {};
  await ensureNames(database);
  const { results } = await database.prepare("SELECT code, name FROM prestacion_names WHERE owner_id = ?").bind(ownerId).all<{ code: string; name: string }>();
  return Object.fromEntries(results.map(row => [row.code, row.name]));
}

/** name null = volver al nombre original. */
export async function setName(ownerId: string, code: string, name: string | null) {
  const database = arancelDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureNames(database);
  if (name === null) { await database.prepare("DELETE FROM prestacion_names WHERE owner_id = ? AND code = ?").bind(ownerId, code).run(); return; }
  await database.prepare(
    "INSERT INTO prestacion_names (owner_id, code, name, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, code) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at"
  ).bind(ownerId, code, name, new Date().toISOString()).run();
}

export async function loadPrices(ownerId: string): Promise<PriceMap> {
  const database = arancelDb();
  if (!database) return {};
  await ensureTable(database);
  const { results } = await database.prepare("SELECT code, price FROM prestacion_prices WHERE owner_id = ?").bind(ownerId).all<{ code: string; price: number }>();
  return Object.fromEntries(results.map(row => [row.code, row.price]));
}

/** price null = quitar el precio de esa prestación. */
export async function savePrice(ownerId: string, code: string, price: number | null) {
  const database = arancelDb();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureTable(database);
  if (price === null) {
    await database.prepare("DELETE FROM prestacion_prices WHERE owner_id = ? AND code = ?").bind(ownerId, code).run();
    return;
  }
  await database.prepare(
    "INSERT INTO prestacion_prices (owner_id, code, price, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, code) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at"
  ).bind(ownerId, code, price, new Date().toISOString()).run();
}
