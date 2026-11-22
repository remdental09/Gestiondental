import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("../app/app-users-db.ts", import.meta.url), "utf8");
const sql = src.match(/"INSERT INTO app_users[\s\S]*?OR app_users\.email <> excluded\.email"/)[0].replace(/"\s*\+\s*"/g, "").replace(/^"|"$/g, "");

test("touchAppUser: memoria por día y upsert que no escribe si ya ingresó hoy", () => {
  assert.match(src, /touchedToday\.get\(key\) === day\) return;/);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE app_users (owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, google_name TEXT NOT NULL DEFAULT '', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, visits INTEGER NOT NULL DEFAULT 1)");
  const run = (at, email = "a@x.cl") => db.prepare(sql).run("o1", email, "", at, at, at.slice(0, 10)).changes;
  assert.equal(run("2026-11-21T10:00:00.000Z"), 1);
  assert.equal(run("2026-11-21T15:00:00.000Z"), 0, "segunda apertura del día: sin escritura");
  assert.equal(run("2026-11-22T09:00:00.000Z"), 1);
  assert.equal(run("2026-11-22T10:00:00.000Z", "b@x.cl"), 1, "cambio de correo sí escribe");
  assert.deepEqual({ ...db.prepare("SELECT visits, last_seen FROM app_users").get() }, { visits: 3, last_seen: "2026-11-22T10:00:00.000Z" });
});
