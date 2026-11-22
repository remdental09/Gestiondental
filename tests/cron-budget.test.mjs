import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chunks, cronBudget, oldestFirst } from "../lib/cron-budget.ts";

test("presupuesto por pasada: corta por cantidad o tiempo y cuenta lo que queda", () => {
  const byCount = cronBudget({ maxItems: 2, maxMs: 1e9 });
  assert.deepEqual([byCount.take(), byCount.take(), byCount.take(), byCount.take()], [true, true, false, false]);
  assert.equal(byCount.used, 2); assert.equal(byCount.skipped, 2);
  let t = 0; const byTime = cronBudget({ maxItems: 99, maxMs: 100, clock: () => t });
  assert.equal(byTime.take(), true); t = 150; assert.equal(byTime.take(), false);
});

test("rotación: nunca sincronizada primero, luego la más antigua; empates estables", () => {
  const rows = [{ id: "a", at: "2026-11-21T10:00:00Z" }, { id: "b", at: null }, { id: "c", at: "2026-11-20T10:00:00Z" }, { id: "d", at: "2026-11-20T10:00:00Z" }];
  assert.deepEqual(oldestFirst(rows, r => r.at).map(r => r.id), ["b", "c", "d", "a"]);
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("crons sin tope fijo de 20 cuentas y con escrituras en tandas", () => {
  const drive = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  const audit = readFileSync(new URL("../app/audit-notes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(drive, /results\.slice\(0, 20\)/);
  assert.match(drive, /FROM google_calendar_connections ORDER BY COALESCE\(last_sync_at, ''\) ASC/);
  assert.match(drive, /ORDER BY COALESCE\(s\.last_run_at, ''\) ASC/);
  assert.match(drive, /await runBatched\(stmts\)/);
  assert.doesNotMatch(drive, /for \(const stmt of stmts\) await stmt\.run\(\)/);
  assert.doesNotMatch(audit, /LIMIT 20/);
  assert.match(audit, /cron_rotation/);
});
