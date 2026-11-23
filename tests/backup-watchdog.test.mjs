import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const viteRequire = createRequire(createRequire(import.meta.url).resolve("vite"));
const { buildSync } = viteRequire("esbuild");
const out = join(mkdtempSync(join(tmpdir(), "gd-wd-")), "bundle.mjs");
writeFileSync(out, buildSync({ entryPoints: [fileURLToPath(new URL("../lib/backup-watchdog.ts", import.meta.url))], bundle: true, format: "esm", platform: "neutral", write: false }).outputFiles[0].text);
const m = await import(pathToFileURL(out).href);

const now = new Date("2026-11-23T11:00:00Z");
const ago = h => new Date(now.getTime() - h * 3_600_000).toISOString();
const okJobs = [
  { job: "drive-backup", last_run_at: ago(0.3), last_ok_at: ago(0.3), last_error_at: null, last_error: null },
  { job: "nightly-backup", last_run_at: ago(9), last_ok_at: ago(9), last_error_at: null, last_error: null },
];
const okOwner = { email: "a@b.cl", connectedAt: ago(500), heartbeatAt: ago(0.5), lastRun: { ok: true, ranAt: ago(0.5), detail: "ficha 1 respaldada" }, failures24h: 0, neverBackedUp: 0 };

test("todo sano: sin hallazgos", () => {
  assert.deepEqual(m.evaluateBackups({ now, jobs: okJobs, owners: [okOwner], nightly: { today: true, yesterday: true } }), []);
});

test("detecta tarea de Drive detenida, fallando y copia nocturna ausente", () => {
  const jobs = [
    { job: "drive-backup", last_run_at: ago(5), last_ok_at: ago(6), last_error_at: ago(5), last_error: "boom" },
    { job: "nightly-backup", last_run_at: ago(60), last_ok_at: ago(60), last_error_at: null, last_error: null },
  ];
  const codes = m.evaluateBackups({ now, jobs, owners: [], nightly: { today: false, yesterday: false } }).map(f => f.code);
  assert.deepEqual(codes.sort(), ["drive-job-failing", "drive-job-stale", "nightly-missing-dump", "nightly-stale"]);
});

test("sin ninguna ejecución registrada es un error", () => {
  const codes = m.evaluateBackups({ now, jobs: [], owners: [], nightly: { today: true, yesterday: true } }).map(f => f.code);
  assert.ok(codes.includes("drive-job-missing") && codes.includes("nightly-stale"));
});

test("cuenta de Drive: revisión vieja, autorización vencida, fallos y fichas sin respaldo", () => {
  const owner = { ...okOwner, heartbeatAt: ago(8), lastRun: { ok: false, ranAt: ago(1), detail: "invalid_grant" }, failures24h: 6, neverBackedUp: 3 };
  const codes = m.evaluateBackups({ now, jobs: okJobs, owners: [owner], nightly: { today: true, yesterday: true } }).map(f => f.code);
  assert.deepEqual(codes.sort(), ["owner-backlog", "owner-heartbeat-stale", "owner-many-failures", "owner-reconnect"]);
});

test("cuenta recién conectada con fichas pendientes no alarma", () => {
  const owner = { ...okOwner, connectedAt: ago(5), neverBackedUp: 40 };
  assert.deepEqual(m.evaluateBackups({ now, jobs: okJobs, owners: [owner], nightly: { today: true, yesterday: true } }), []);
});

test("bucket sin configurar es solo aviso, y el correo escapa HTML", () => {
  const findings = m.evaluateBackups({ now, jobs: okJobs, owners: [], nightly: null });
  assert.equal(findings[0].level, "warn");
  const mail = m.buildAlertMail([{ level: "error", code: "x", message: "<b>mal</b>" }], "2026-11-23");
  assert.match(mail.html, /&lt;b&gt;/);
  assert.match(mail.subject, /problemas/);
});

test("el cron diario del vigilante está conectado sin crear un trigger nuevo", () => {
  const sched = readFileSync(new URL("../app/scheduled.ts", import.meta.url), "utf8");
  assert.match(sched, /getUTCHours\(\) === 11[\s\S]*runBackupWatchdog/);
  const run = readFileSync(new URL("../app/backup-watchdog.ts", import.meta.url), "utf8");
  assert.doesNotMatch(run, /FROM (evolutions|patients_|clinical)/);
});
