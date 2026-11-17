import { env } from "cloudflare:workers";
import { decodeBudgetFormat, type BudgetFormat } from "@/lib/budget-format";

type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const db = () => (env as unknown as { DB?: Db }).DB;

async function ensureTable(database: Db) {
  await database.prepare("CREATE TABLE IF NOT EXISTS budget_formats (owner_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

/** Formato del PDF del profesional (su id personal, no el de la clínica). Sin registro: el formato por defecto. */
export async function loadBudgetFormat(professionalId: string): Promise<BudgetFormat> {
  const database = db();
  if (!database) return decodeBudgetFormat(null);
  await ensureTable(database);
  const row = await database.prepare("SELECT data FROM budget_formats WHERE owner_id = ?").bind(professionalId).first<{ data: string }>();
  return decodeBudgetFormat(row?.data);
}

export async function saveBudgetFormat(professionalId: string, format: BudgetFormat): Promise<void> {
  const database = db();
  if (!database) throw new Error("La base de datos no está disponible.");
  await ensureTable(database);
  await database.prepare("INSERT INTO budget_formats (owner_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(professionalId, JSON.stringify(format), new Date().toISOString()).run();
}
