#!/usr/bin/env node
/**
 * Aplica en D1 (remoto) las migraciones de drizzle/*.sql que aún no se han aplicado, y las anota en `_gd_migrations`,
 * así cada migración corre UNA sola vez (las que hacen ALTER ... ADD no se pueden repetir). Si una falla, el despliegue se detiene.
 * Primera ejecución: las migraciones hasta BASELINE ya estaban en producción; solo se anotan, no se ejecutan.
 * Uso (CI): node scripts/apply-migrations.mjs   ·   Probar sin tocar nada: node scripts/apply-migrations.mjs --dry-run
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BASELINE = "0021_biomedical_products.sql";
const CONFIG = "wrangler.cloudflare.jsonc";

/** Migraciones pendientes, en orden. Si el registro está vacío (primera vez), las de la línea base se dan por aplicadas. */
export function planMigrations(files, applied, baseline = BASELINE) {
  const sorted = files.filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  const done = new Set(applied);
  if (!done.size) {
    const upTo = sorted.filter(name => name <= baseline);
    return { baseline: upTo, run: sorted.filter(name => name > baseline) };
  }
  return { baseline: [], run: sorted.filter(name => !done.has(name)) };
}

const wrangler = (args) => {
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--yes", "--config", CONFIG, "--json", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`wrangler falló (${args[0]} ${args[1]?.slice(0, 60) ?? ""}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const sqlString = (value) => `'${value.replace(/'/g, "''")}'`;

function main() {
  const dry = process.argv.includes("--dry-run");
  const files = readdirSync(new URL("../drizzle/", import.meta.url));
  if (!dry) wrangler(["--command", "CREATE TABLE IF NOT EXISTS _gd_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"]);
  const out = dry ? "[]" : wrangler(["--command", "SELECT name FROM _gd_migrations"]);
  const applied = (JSON.parse(out)[0]?.results ?? []).map(row => row.name);
  const plan = planMigrations(files, applied);
  console.log(`Línea base (solo se anotan): ${plan.baseline.length}. A ejecutar: ${plan.run.join(", ") || "ninguna"}.`);
  if (dry) return;
  const mark = (name) => wrangler(["--command", `INSERT OR IGNORE INTO _gd_migrations (name, applied_at) VALUES (${sqlString(name)}, ${sqlString(new Date().toISOString())})`]);
  plan.baseline.forEach(mark);
  for (const name of plan.run) {
    console.log(`Aplicando ${name}…`);
    wrangler(["--file", fileURLToPath(new URL(`../drizzle/${name}`, import.meta.url))]);
    mark(name);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
