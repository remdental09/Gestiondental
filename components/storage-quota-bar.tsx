"use client";
import React, { useEffect, useState } from "react";
import { formatBytes, PLAN_GRATIS, type QuotaStatus } from "@/lib/space-quota";

/** Tarjeta de espacio disponible y uso de almacenamiento R2 en Configuración. */
export function StorageQuotaBar({ className = "" }: { className?: string }) {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/espacio", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: unknown) => setQuota(d as QuotaStatus))
      .catch(() => setError(true));
  }, []);

  if (error || !quota) return null;

  const barColor = quota.exceeded
    ? "bg-red-500"
    : quota.warning
      ? "bg-amber-400"
      : "bg-sky-500";

  const statusColor = quota.exceeded
    ? "text-red-600"
    : quota.warning
      ? "text-amber-700"
      : "text-sky-700";

  const availableBytes = quota.availableBytes ?? Math.max(0, quota.quotaBytes - quota.usedBytes);
  const planLabel = quota.planName === PLAN_GRATIS ? "Plan gratuito" : `Plan ${quota.planName}`;

  return (
    <section className={`surface flex flex-col gap-2 ${className}`} aria-label="Espacio disponible">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Espacio de almacenamiento</h3>
          <p className="text-xs text-gray-500">
            {planLabel} · {formatBytes(quota.usedBytes)} usados de {formatBytes(quota.quotaBytes)}
          </p>
        </div>
        <span className={`text-sm font-semibold ${statusColor}`}>
          {formatBytes(availableBytes)} disponibles
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${quota.pct}%` }}
          role="progressbar"
          aria-valuenow={quota.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {quota.exceeded && (
        <p className="text-xs text-red-600">
          Espacio lleno. Elimina imágenes o contacta soporte para ampliar tu plan.
        </p>
      )}
      {quota.warning && !quota.exceeded && (
        <p className="text-xs text-amber-700">
          Estás usando más del 80 % de tu espacio disponible.
        </p>
      )}
    </section>
  );
}
