import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failedItems, failingJobs, runJob, safeError } from "../lib/cron-health.ts";

function fakeDb() {
  const runs = [];
  return { runs, prepare(sql) { return { bind(...values) { return { async run() { runs.push({ sql, values }); }, async all() { return { results: [] }; } }; } }; } };
}

test("cuenta elementos fallidos en listas u objetos", () => {
  assert.equal(failedItems([{ ok: true }, { ok: false }, { ok: false }]), 2);
  assert.equal(failedItems({ ok: false }), 1);
  assert.equal(failedItems({ skipped: "x" }), 0);
  assert.equal(failedItems(null), 0);
});

test("el error guardado no lleva correos ni tokens y es corto", () => {
  const text = safeError(new Error("fallo para luis@example.cl con ya29.abcDEF-123 y sk-XYZ" + " x".repeat(300)));
  assert.doesNotMatch(text, /@example|ya29\.abc|sk-XYZ/);
  assert.ok(text.length <= 200);
});

test("runJob registra éxito y devuelve el resultado", async () => {
  const db = fakeDb();
  let t = 0;
  const result = await runJob(db, "google-calendars", async () => [{ ok: true }, { ok: false }], () => new Date(Date.UTC(2026, 10, 22, 2, 0, t++)));
  assert.deepEqual(result, [{ ok: true }, { ok: false }]);
  const [{ values }] = db.runs;
  assert.equal(values[0], "google-calendars");
  assert.equal(values[2], values[1]); // last_ok_at = ahora
  assert.equal(values[3], null);
  assert.equal(values[6], 1); // parcial
  assert.equal(values[7], 1000);
});

test("runJob no lanza: anota el error y devuelve ok:false", async () => {
  const db = fakeDb();
  const original = console.error; console.error = () => {};
  try {
    const result = await runJob(db, "drive-backup", async () => { throw new Error("token revocado de ana@x.cl"); });
    assert.equal(result.ok, false);
    const [{ values }] = db.runs;
    assert.equal(values[2], null);
    assert.ok(values[3]);
    assert.match(values[4], /\[correo\]/);
    assert.equal(values[5], 1);
  } finally { console.error = original; }
});

test("runJob sigue aunque la tabla falle", async () => {
  const broken = { prepare() { throw new Error("no such table"); } };
  assert.equal(await runJob(broken, "x", async () => 5), 5);
  assert.equal(await runJob(null, "x", async () => 6), 6);
});

test("fallando = último error posterior al último éxito", () => {
  const base = { last_run_at: "", last_error: null, runs: 1, failures: 0, partial: 0, duration_ms: 0 };
  const rows = [
    { ...base, job: "a", last_ok_at: "2026-11-22T02:00:00Z", last_error_at: "2026-11-22T01:00:00Z" },
    { ...base, job: "b", last_ok_at: "2026-11-22T01:00:00Z", last_error_at: "2026-11-22T02:00:00Z" },
    { ...base, job: "c", last_ok_at: null, last_error_at: "2026-11-22T02:00:00Z" },
    { ...base, job: "d", last_ok_at: "2026-11-22T02:00:00Z", last_error_at: null },
  ];
  assert.deepEqual(failingJobs(rows).map((row) => row.job), ["b", "c"]);
});

test("cada tarea del cron pasa por runJob; migración aditiva; estado sin datos de otras cuentas", () => {
  const scheduled = readFileSync(new URL("../app/scheduled.ts", import.meta.url), "utf8");
  for (const name of ["google-calendars", "calendar-sync", "google-pending", "google-two-way", "agenda-changes", "appointment-reminders", "agenda-digest", "note-audits", "drive-backup"]) assert.match(scheduled, new RegExp(`job\\("${name}"`), name);
  const sql = readFileSync(new URL("../drizzle/0016_cron_health.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  const route = readFileSync(new URL("../app/api/estado/route.ts", import.meta.url), "utf8");
  assert.match(route, /FROM ai_usage WHERE owner_id = \?/);
  assert.match(route, /isOwner \? \{ detalle/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<SystemStatus\/>/);
});
