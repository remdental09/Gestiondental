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
