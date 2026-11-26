// Tests unitarios de lógica y cableado de cuotas de almacenamiento (lib/space-quota.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkUploadQuota, computeQuotaStatus, formatBytes, getQuotaStatus, QUOTA_GRATIS_BYTES } from "../lib/space-quota.ts";

/** Mock de DB compatible con D1Database (`env.DB`: prepare/bind/first). */
function mockDb({ usedBytes = 0, quotaBytes = null, planName = "gratis", missingTable = false } = {}) {
  return {
    prepare(sqlText) {
      return {
        bind(..._args) {
          return {
            async first() {
              if (sqlText.includes("SUM(size)")) return { used: usedBytes };
              if (sqlText.includes("space_quotas")) {
                if (missingTable) throw new Error("no such table: space_quotas");
                if (quotaBytes === null) return null;
                return { quota_bytes: quotaBytes, plan_name: planName };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

// ── computeQuotaStatus (lógica pura, sin DB) ──────────────────────────────────

test("computeQuotaStatus: sin uso → 0 %, availableBytes igual al tope", () => {
  const s = computeQuotaStatus(0, 1000, "gratis");
  assert.equal(s.pct, 0);
  assert.equal(s.availableBytes, 1000);
  assert.equal(s.warning, false);
  assert.equal(s.exceeded, false);
});

test("computeQuotaStatus: uso al 80 % → warning pero no exceeded", () => {
  const s = computeQuotaStatus(800, 1000, "gratis");
  assert.equal(s.warning, true);
  assert.equal(s.exceeded, false);
  assert.equal(s.availableBytes, 200);
});

test("computeQuotaStatus: uso al 100 % → exceeded, pct 100, available 0", () => {
  const s = computeQuotaStatus(1000, 1000, "gratis");
  assert.equal(s.exceeded, true);
  assert.equal(s.warning, false);
  assert.equal(s.pct, 100);
  assert.equal(s.availableBytes, 0);
});

test("computeQuotaStatus: uso por encima del límite → exceeded, pct capped a 100, available 0", () => {
  const s = computeQuotaStatus(1500, 1000, "gratis");
  assert.equal(s.exceeded, true);
  assert.equal(s.pct, 100);
  assert.equal(s.availableBytes, 0);
});

test("computeQuotaStatus: uso al 79 % → sin warning", () => {
  const s = computeQuotaStatus(790, 1000, "gratis");
  assert.equal(s.warning, false);
  assert.equal(s.exceeded, false);
});

// ── getQuotaStatus (con mock de DB) ───────────────────────────────────────────

test("sin fila en space_quotas: usa límite gratuito por defecto (500 MB)", async () => {
  const status = await getQuotaStatus(mockDb({ usedBytes: 0 }), "owner-1");
  assert.equal(status.quotaBytes, QUOTA_GRATIS_BYTES);
  assert.equal(status.availableBytes, QUOTA_GRATIS_BYTES);
  assert.equal(status.planName, "gratis");
  assert.equal(status.usedBytes, 0);
  assert.equal(status.exceeded, false);
  assert.equal(status.pct, 0);
});

test("si space_quotas aún no existe en entorno local, cae a 500 MB sin fallar", async () => {
  const status = await getQuotaStatus(mockDb({ usedBytes: 1024, missingTable: true }), "owner-1");
  assert.equal(status.quotaBytes, QUOTA_GRATIS_BYTES);
  assert.equal(status.usedBytes, 1024);
  assert.equal(status.availableBytes, QUOTA_GRATIS_BYTES - 1024);
});

test("con fila en space_quotas: usa cuota y plan configurados", async () => {
  const status = await getQuotaStatus(mockDb({ usedBytes: 100, quotaBytes: 500, planName: "pro" }), "o");
  assert.equal(status.quotaBytes, 500);
  assert.equal(status.availableBytes, 400);
  assert.equal(status.planName, "pro");
  assert.equal(status.usedBytes, 100);
});

// ── checkUploadQuota ──────────────────────────────────────────────────────────

test("checkUploadQuota: permite si hay espacio suficiente", async () => {
  const result = await checkUploadQuota(mockDb({ usedBytes: 0, quotaBytes: 1000 }), "o", 500);
  assert.equal(result, null);
});

test("checkUploadQuota: permite exactamente hasta el límite", async () => {
  const result = await checkUploadQuota(mockDb({ usedBytes: 700, quotaBytes: 1000 }), "o", 300);
  assert.equal(result, null);
});

test("checkUploadQuota: bloquea si el archivo supera el espacio restante", async () => {
  const result = await checkUploadQuota(mockDb({ usedBytes: 800, quotaBytes: 1000 }), "o", 300);
  assert.ok(typeof result === "string" && result.length > 0);
});

test("checkUploadQuota: bloquea si ya está al límite (1 byte más)", async () => {
  const result = await checkUploadQuota(mockDb({ usedBytes: 1000, quotaBytes: 1000 }), "o", 1);
  assert.ok(typeof result === "string");
});

// ── Cableado real con env.DB (evita pasar la instancia Drizzle a prepare) ─────

test("rutas de API pasan env.DB (D1Database) sin casteos forzados", () => {
  const espacioRoute = readFileSync(fileURLToPath(new URL("../app/api/espacio/route.ts", import.meta.url)), "utf8");
  const imagesRoute = readFileSync(fileURLToPath(new URL("../app/api/images/route.ts", import.meta.url)), "utf8");
  const journalRaw = readFileSync(fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)), "utf8");

  assert.match(espacioRoute, /getQuotaStatus\(env\.DB,/);
  assert.doesNotMatch(espacioRoute, /as unknown/);
  assert.match(imagesRoute, /checkUploadQuota\(env\.DB,/);
  assert.doesNotMatch(imagesRoute, /checkUploadQuota\([^)]*as unknown/);

  const journal = JSON.parse(journalRaw);
  assert.ok(journal.entries.some((e) => e.tag === "0032_space_quotas"));
});

// ── formatBytes ───────────────────────────────────────────────────────────────

test("formatBytes: bytes, KB, MB y GB", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), "2.00 GB");
});
