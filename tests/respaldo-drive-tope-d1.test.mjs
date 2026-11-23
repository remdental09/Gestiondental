import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BACKUP_QUERIES, DRIVE_D1_QUERY_BUDGET, SNAPSHOT_QUERIES, affordablePage, fairQueryShare, nextCursor, queryBudget, rotateOwners,
} from "../lib/drive-backup-rotation.ts";

// Incidente 22/23-11: el respaldo automático revisaba cientos de fichas por pasada (~16 consultas a D1 cada una)
// y pasaba el tope de 1.000 consultas por invocación del Worker. Desde ahí TODAS las consultas fallaban
// («Failed query: select … from tooth_statuses …»), también la constancia y cron_health: la tarjeta quedó en
// «Última revisión automática 22-11 01:25» y el vigilante vio drive-backup sin registro.

test("el presupuesto de consultas deja margen bajo el tope de 1.000 de Cloudflare", () => {
  assert.ok(DRIVE_D1_QUERY_BUDGET <= 800);
  const budget = queryBudget(100);
  assert.equal(budget.spend(60), true);
  assert.equal(budget.canAfford(41), false);
  assert.equal(budget.spend(41), false, "no descuenta si no alcanza");
  assert.equal(budget.used, 60);
  assert.equal(budget.left, 40);
});

test("la página de revisión se achica según lo que queda y llega a 0", () => {
  assert.equal(affordablePage(queryBudget()), 20);
  const budget = queryBudget(SNAPSHOT_QUERIES * 3 + 1 + BACKUP_QUERIES);
  assert.equal(affordablePage(budget), 3, "deja espacio para copiar una ficha de la página");
  assert.equal(affordablePage(budget, 20, SNAPSHOT_QUERIES * 2 + 1 + BACKUP_QUERIES), 2, "respeta la cuota de la cuenta");
  budget.spend(SNAPSHOT_QUERIES * 3);
  assert.equal(affordablePage(budget), 0);
});

test("el cursor retoma donde quedó y vuelve a 0 al terminar la vuelta", () => {
  assert.equal(nextCursor(0, null, 40, true), 40, "página completa: sigue después de la última revisada");
  assert.equal(nextCursor(40, 57, 80, false), 56, "cortó antes de la ficha 57: la próxima pasada parte en ella");
  assert.equal(nextCursor(560, null, null, true), 0, "última página: nueva vuelta desde el principio");
  assert.equal(nextCursor(30, 10, 80, false), 30, "nunca retrocede");
});

test("simulación: una cuenta de 593 fichas y otra de 365 con 141 pendientes nunca pasan el tope y avanzan", () => {
  const accounts = [
    { ids: Array.from({ length: 593 }, (_, i) => i + 1), pending: new Set() },
    { ids: Array.from({ length: 365 }, (_, i) => 1000 + i), pending: new Set(Array.from({ length: 141 }, (_, i) => 1224 + i)) },
  ];
  const cursors = [0, 0];
  let runs = 0;
  while (accounts.some(a => a.pending.size) && runs < 200) {
    runs++;
    const budget = queryBudget();
    budget.spend(3);
    const share = fairQueryShare(budget.left, accounts.length);
    // Igual que el cron: el punto de partida rota y la primera vuelta reparte las consultas.
    for (const limit of [share, Infinity]) {
      for (const index of rotateOwners([0, 1], runs * 20 * 60_000)) {
        const account = accounts[index];
        let after = cursors[index];
        budget.spend(1);
        const start = budget.used;
        while (affordablePage(budget) > 0 && budget.used - start < limit) {
          const size = affordablePage(budget, undefined, limit - (budget.used - start));
          if (size < 1) break;
          budget.spend(1 + size * SNAPSHOT_QUERIES);
          const page = account.ids.filter(id => id > after).slice(0, size + 1);
          const selected = page.slice(0, size);
          const next = page.length > size ? selected[selected.length - 1] : null;
          let stopped = null;
          for (const id of selected.filter(id => account.pending.has(id))) {
            if (!budget.canAfford(BACKUP_QUERIES)) { stopped = id; break; }
            budget.spend(BACKUP_QUERIES);
            account.pending.delete(id);
          }
          after = nextCursor(after, stopped, next, stopped === null);
          if (stopped !== null || next === null) break;
        }
        cursors[index] = after;
        budget.spend(1);
      }
    }
    assert.ok(budget.used + 4 <= 1000, `pasada ${runs}: ${budget.used} consultas`);
  }
  assert.equal(accounts[1].pending.size, 0, "todas las pendientes quedan copiadas");
  assert.ok(runs <= 48, `termina en ${runs} pasadas (cada 20 minutos ≈ ${Math.round(runs / 3)} h)`);
});

test("el respaldo programado usa el presupuesto, el cursor y no tumba la constancia", () => {
  const src = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function runScheduledDriveBackup"), src.indexOf("async function ensureCursorTable"));
  assert.match(fn, /const queries = queryBudget\(\)/);
  assert.match(fn, /readCursor\(user\.userId, "principal"\)/);
  assert.match(fn, /saveCursor\(user\.userId, "principal", after\)/);
  assert.match(fn, /listDriveBackupQueue\(user\.userId, after, pageSize/);
  assert.match(fn, /"revisión de la cola: " \+ message/);
  assert.match(fn, /syncDriveMirrors\(user, "cron", budget, undefined, queries\)/);
  const mirrors = src.slice(src.indexOf("export async function syncDriveMirrors"));
  assert.doesNotMatch(mirrors.slice(0, 600), /SELECT id FROM patients WHERE owner_id = \? ORDER BY id"/, "ya no revisa todas las fichas en cada pasada");
  assert.match(mirrors, /id > \? ORDER BY id LIMIT \?/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS drive_backup_cursor/);
});

test("la foto de la ficha lee sus tablas en un solo db.batch (1 consulta del tope) y cae a lecturas sueltas si falla", () => {
  const src = readFileSync(new URL("../app/drive-backup.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function getDriveSnapshot"), src.indexOf("const [address, anamnesis]"));
  assert.match(fn, /await db\.batch\(\[/);
  assert.match(fn, /catch \{ rows = null;/);
  assert.match(fn, /if \(!rows\) \{/);
  for (const table of ["evolutions", "budgets", "appointments", "periodontalExams", "toothStatuses", "clinicalImages", "patientDocuments", "driveBackups", "consentSignatures", "biomedicalProducts"]) {
    assert.match(fn, new RegExp(`from\\(${table}\\)`), table);
  }
  assert.ok(SNAPSHOT_QUERIES <= 10);
});

test("la pasada descuenta las fichas realmente revisadas, no la página completa", () => {
  const src = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  assert.match(src, /queries\.spend\(1 \+ queue\.scanned \* SNAPSHOT_QUERIES\)/);
  assert.match(readFileSync(new URL("../app/drive-backup.ts", import.meta.url), "utf8"), /scanned: selected\.length/);
});
