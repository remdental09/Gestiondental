import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("el respaldo se revisa cada hora y deja constancia aunque no haya cambios", async () => {
  const sched = await import("../app/scheduled.ts").catch(() => null);
  const src = read("app/scheduled.ts"), drive = read("app/drive-oauth.ts"), ui = read("components/google-drive-backup.tsx");
  assert.match(src, /HOURLY_BACKUP_CRON = "20 \* \* \* \*"/);
  assert.match(src, /cron === BACKUP_CRON \|\| cron === HOURLY_BACKUP_CRON/);
  assert.match(drive, /recordHeartbeat\(connection\.owner_id/);
  assert.match(drive, /"sin cambios pendientes"/);
  assert.match(drive, /recordBackupRun\(user\.userId, "guardado"/);
  assert.match(ui, /Última revisión automática/);
  assert.match(ui, /"al guardar"/);
  void sched;
});
