"use client";
import React, { useEffect, useState } from "react";
import { formatBytes, type QuotaStatus } from "@/lib/space-quota";

/** Barra de uso de almacenamiento R2 para el plan del dentista. */
export function StorageQuotaBar({ className = "" }: { className?: string }) {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/espacio")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: unknown) => setQuota(d as QuotaStatus))
      .catch(() => setError(true));
  }, []);

  if (error || !quota) return null;

  const color = quota.exceeded
    ? "bg-red-500"
    : quota.warning
      ? "bg-amber-400"
      : "bg-sky-500";

  const textColor = quota.exceeded
    ? "text-red-600"
    : quota.warning
      ? "text-amber-600"
      : "text-sky-700";

  const label = `${formatBytes(quota.usedBytes)} de ${formatBytes(quota.quotaBytes)}`;

  return (
    <div className={`flex flex-col gap-1 ${className}`} aria-label="Uso de almacenamiento">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Almacenamiento</span>
        <span className={`font-medium ${textColor}`}>{label}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all ${color}`}
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
        <p className="text-xs text-amber-600">
          Estás usando más del 80 % de tu espacio disponible.
        </p>
      )}
    </div>
  );
}
