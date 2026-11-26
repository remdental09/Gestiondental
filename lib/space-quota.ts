/**
 * Cuota de almacenamiento R2 por espacio (owner_id).
 *
 * Reglas:
 * - Plan «gratis»: 500 MB (524 288 000 bytes) por defecto para todo espacio nuevo.
 * - El titular puede ampliar el límite (plan pagado) sin redesplegar, solo cambiando la tabla.
 * - La lectura, exportación y respaldo NUNCA se bloquean por cuota.
 * - Solo se bloquea la subida de nuevos archivos al BUCKET R2.
 * - El uso se calcula desde D1 (SUM de clinical_images.size) para evitar listar R2.
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Nombre del plan gratuito. */
export const PLAN_GRATIS = "gratis";

/** Límite de almacenamiento por defecto para el plan gratuito: 500 MB. */
export const QUOTA_GRATIS_BYTES = 500 * 1024 * 1024; // 524 288 000 bytes

/** Umbral de aviso (80 % del límite). */
export const QUOTA_WARNING_RATIO = 0.8;

/** Tabla de cuotas (declaración para Drizzle). */
export const spaceQuotasTable = sqliteTable("space_quotas", {
  ownerId: text("owner_id").primaryKey(),
  planName: text("plan_name").notNull().default(PLAN_GRATIS),
  quotaBytes: integer("quota_bytes").notNull().default(QUOTA_GRATIS_BYTES),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SpaceQuota = typeof spaceQuotasTable.$inferSelect;

export type QuotaStatus = {
  usedBytes: number;
  quotaBytes: number;
  availableBytes: number;
  planName: string;
  /** true si supera el tope (no se puede subir más). */
  exceeded: boolean;
  /** true si superó el umbral de aviso (80 %). */
  warning: boolean;
  /** Porcentaje de uso (0–100). */
  pct: number;
};

/** Interfaz mínima compatible con D1Database (`env.DB`) y mocks de prueba. */
export type QuotaDb = {
  prepare(sql: string): {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
};

/** @internal Lógica pura: calcula el estado de cuota dado los valores medidos. */
export function computeQuotaStatus(usedBytes: number, quotaBytes: number, planName: string): QuotaStatus {
  const safeQuota = quotaBytes > 0 ? quotaBytes : QUOTA_GRATIS_BYTES;
  const availableBytes = Math.max(0, safeQuota - usedBytes);
  const exceeded = usedBytes >= safeQuota;
  const warning = !exceeded && usedBytes / safeQuota >= QUOTA_WARNING_RATIO;
  const pct = Math.min(100, Math.round((usedBytes / safeQuota) * 100));
  return { usedBytes, quotaBytes: safeQuota, availableBytes, planName, exceeded, warning, pct };
}

/**
 * Consulta el uso actual y el límite del espacio sobre el binding D1 (`env.DB`).
 * Si no existe una fila (o la tabla aún no existe en entorno local), usa el límite gratuito por defecto.
 */
export async function getQuotaStatus(db: QuotaDb, ownerId: string): Promise<QuotaStatus> {
  const usedRow = await db
    .prepare("SELECT COALESCE(SUM(size), 0) AS used FROM clinical_images WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ used: number }>();
  const usedBytes = Number(usedRow?.used ?? 0);

  let quotaRow: { quota_bytes: number; plan_name: string } | null = null;
  try {
    quotaRow = await db
      .prepare("SELECT quota_bytes, plan_name FROM space_quotas WHERE owner_id = ? LIMIT 1")
      .bind(ownerId)
      .first<{ quota_bytes: number; plan_name: string }>();
  } catch {
    quotaRow = null;
  }

  const quotaBytes = quotaRow?.quota_bytes ?? QUOTA_GRATIS_BYTES;
  const planName = quotaRow?.plan_name ?? PLAN_GRATIS;

  return computeQuotaStatus(usedBytes, quotaBytes, planName);
}

/**
 * Verifica si hay espacio para subir un archivo de `incomingBytes`.
 * Devuelve `null` si se puede proceder, o un mensaje de error para el usuario si no.
 */
export async function checkUploadQuota(
  db: QuotaDb,
  ownerId: string,
  incomingBytes: number,
): Promise<string | null> {
  const status = await getQuotaStatus(db, ownerId);
  if (status.usedBytes + incomingBytes > status.quotaBytes) {
    const usedMb = (status.usedBytes / 1024 / 1024).toFixed(1);
    const totalMb = (status.quotaBytes / 1024 / 1024).toFixed(0);
    return `Espacio insuficiente. Usas ${usedMb} MB de ${totalMb} MB disponibles en tu plan ${status.planName === PLAN_GRATIS ? "gratuito" : status.planName}. Elimina imágenes o contacta soporte para ampliar tu plan.`;
  }
  return null;
}

/** Formato legible para bytes (KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
