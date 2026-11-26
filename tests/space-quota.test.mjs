// Tests unitarios de lógica de cuotas de almacenamiento (lib/space-quota.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { checkUploadQuota, computeQuotaStatus, formatBytes, getQuotaStatus, QUOTA_GRATIS_BYTES } from "../lib/space-quota.ts";

/** Mock de DB compatible con la interfaz QuotaDb (prepare/bind/first). */
function mockDb({ usedBytes = 0, quotaBytes = null, planName = "gratis" } = {}) {
  return {
    prepare(sqlText) {
      return {
        bind(..._args) {
          return {
            async first() {
              if (sqlText.includes("SUM(size)")) return { used: usedBytes };
              if (sqlText.includes("space_quotas")) {
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

test("computeQuotaStatus: sin uso → 0 %, sin warning ni exceeded", () => {
  const s = computeQuotaStatus(0, 1000, "gratis");
  assert.equal(s.pct, 0);
  assert.equal(s.warning, false);
  assert.equal(s.exceeded, false);
});

test("computeQuotaStatus: uso al 80 % → warning pero no exceeded", () => {
  const s = computeQuotaStatus(800, 1000, "gratis");
  assert.equal(s.warning, true);
  assert.equal(s.exceeded, false);
});

test("computeQuotaStatus: uso al 100 % → exceeded, pct 100", () => {
  const s = computeQuotaStatus(1000, 1000, "gratis");
  assert.equal(s.exceeded, true);
  assert.equal(s.warning, false);
  assert.equal(s.pct, 100);
});

test("computeQuotaStatus: uso por encima del límite → exceeded, pct capped a 100", () => {
  const s = computeQuotaStatus(1500, 1000, "gratis");
  assert.equal(s.exceeded, true);
  assert.equal(s.pct, 100);
});

test("computeQuotaStatus: uso al 79 % → sin warning", () => {
  const s = computeQuotaStatus(790, 1000, "gratis");
  assert.equal(s.warning, false);
  assert.equal(s.exceeded, false);
});

// ── getQuotaStatus (con mock de DB) ───────────────────────────────────────────

test("sin fila en space_quotas: usa límite gratuito por defecto", async () => {
  const status = await getQuotaStatus(mockDb({ usedBytes: 0 }), "owner-1");
  assert.equal(status.quotaBytes, QUOTA_GRATIS_BYTES);
  assert.equal(status.planName, "gratis");
  assert.equal(status.usedBytes, 0);
  assert.equal(status.exceeded, false);
  assert.equal(status.pct, 0);
});

test("con fila en space_quotas: usa cuota y plan configurados", async () => {
  const status = await getQuotaStatus(mockDb({ usedBytes: 100, quotaBytes: 500, planName: "pro" }), "o");
  assert.equal(status.quotaBytes, 500);
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

// ── formatBytes ───────────────────────────────────────────────────────────────

test("formatBytes: bytes bajo 1 KB", () => assert.equal(formatBytes(512), "512 B"));
test("formatBytes: kilobytes", () => assert.equal(formatBytes(2048), "2.0 KB"));
test("formatBytes: megabytes", () => assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB"));
