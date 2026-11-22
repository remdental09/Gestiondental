import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRIVE_BACKUP_MAX_PER_RUN, DRIVE_BACKUP_ROTATION_MS, fairShare, rotateOwners, runClock } from "../lib/drive-backup-rotation.ts";

test("el punto de partida rota en cada pasada: ninguna cuenta queda siempre al final", () => {
  const owners = ["a", "b", "c", "d"];
  const firsts = new Set();
  for (let pass = 0; pass < owners.length; pass++) {
    const order = rotateOwners(owners, pass * DRIVE_BACKUP_ROTATION_MS);
    assert.deepEqual([...order].sort(), owners, "no pierde ni duplica cuentas");
    firsts.add(order[0]);
  }
  assert.equal(firsts.size, owners.length);
  assert.deepEqual(rotateOwners([], 123), []);
  assert.deepEqual(rotateOwners(["solo"], 999999999), ["solo"]);
});

test("cuota pareja por cuenta, con un mínimo", () => {
  assert.equal(fairShare(60, 4), 15);
  assert.equal(fairShare(60, 100), 3);
  assert.equal(fairShare(60, 0), 0);
});

test("el lote por pasada aprovecha el plan pagado sin acercarse al límite de subpeticiones", () => {
  assert.ok(DRIVE_BACKUP_MAX_PER_RUN >= 30);
  assert.ok(DRIVE_BACKUP_MAX_PER_RUN * 12 < 10_000);
});

test("el reloj de la pasada corta a tiempo", () => {
  let t = 0;
  const clock = runClock(1000, () => t);
  assert.equal(clock.expired(), false);
  t = 1000;
  assert.equal(clock.expired(), true);
});

test("el respaldo programado usa el turno justo", () => {
  const src = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function runScheduledDriveBackup"), src.indexOf("async function ensureHeartbeatTable"));
  assert.match(fn, /rotateOwners\(allConnections, nowMs\)/);
  assert.match(fn, /fairShare\(maxPatients, connections\.length\)/);
  assert.match(fn, /clock\.expired\(\)/);
  assert.doesNotMatch(fn, /maxPatients = 5\b/);
});
