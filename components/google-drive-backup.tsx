"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DriveStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  lastRun?: { source: string; ranAt: string; ok: number; detail: string } | null;
  mirrors?: Array<{ email: string; backedUp: number; total: number; lastVerifiedAt: string | null }>;
};
type SyncResult = { saved?: boolean; message?: string };
const fechaChile = (iso: string) => new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso));
type SyncResponse = {
  configured?: boolean;
  connected?: boolean;
  complete?: boolean;
  nextAfterPatientId?: number | null;
  results?: SyncResult[];
  error?: string;
};

export function GoogleDriveBackup() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);

  const syncQueue = useCallback(async () => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setSyncError(false);
    let afterPatientId = 0;
    let complete = false;
    let failed = false;
    let pages = 0;
    let lastMessage = "";
    try {
      while (!complete && pages < 30) {
        const response = await fetch("/api/drive/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ afterPatientId }),
          cache: "no-store",
          keepalive: true,
        });
        const result = await response.json() as SyncResponse;
        if (!response.ok || !result.connected) throw new Error(result.error || "La cuenta de Drive no está conectada.");
        if (result.results?.some(item => !item.saved)) { failed = true; const bad = result.results.find(item => !item.saved && item.message); if (bad?.message) lastMessage = bad.message; }
        complete = Boolean(result.complete);
        afterPatientId = Number(result.nextAfterPatientId || 0);
        pages += 1;
      }
      const success = complete && !failed;
      setSyncError(!success);
      setMessage(success
        ? "Los respaldos pendientes se sincronizaron con Google Drive."
        : "Hay fichas pendientes de respaldo. Puedes reintentar sin perder los cambios guardados." + (lastMessage ? " Motivo: " + lastMessage : ""));
      return success;
    } catch {
      setSyncError(true);
      setMessage("No se pudo completar el respaldo. Las fichas siguen guardadas en Gestión Dental.");
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const onBackup = (event: Event) => {
      const detail = (event as CustomEvent<SyncResponse>).detail;
      if (!detail?.configured || !detail.connected) return;
      const result = detail.results?.[0];
      if (result?.saved) {
        setSyncError(false);
        setMessage("Respaldo actualizado en Google Drive.");
      } else {
        setSyncError(true);
        setMessage("La ficha quedó guardada en Gestión Dental; el respaldo en Drive quedó pendiente.");
      }
    };
    window.addEventListener("gestion-dental:drive-backup", onBackup);
    void (async () => {
      try {
        const response = await fetch("/api/drive/status", { cache: "no-store" });
        const next = await response.json() as DriveStatus;
        if (!active) return;
        setStatus(next);
        const query = new URLSearchParams(window.location.search);
        const outcome = query.get("drive");
        if (outcome === "connected") setMessage("Google Drive autorizado. Preparando los respaldos.");
        if (outcome === "denied") setMessage("No se autorizó Google Drive. Las fichas siguen guardándose en la aplicación.");
        if (outcome === "scope-missing") setMessage("Google no dio permiso para Drive. Vuelve a conectar y deja marcada la casilla que permite ver y crear archivos en Drive.");
        if (outcome === "mirror-connected") setMessage("Segunda cuenta de Drive conectada. Copiando las fichas también ahí.");
        if (outcome === "mirror-same") setMessage("Esa es la misma cuenta principal. Para la copia adicional elige otra cuenta de Google.");
        if (outcome === "error") setMessage("No se pudo completar la autorización de Google Drive. Puedes intentarlo otra vez.");
        if (outcome === "not-configured") setMessage("Google Drive todavía requiere configuración para esta aplicación.");
        if (outcome) {
          query.delete("drive");
          const suffix = query.toString();
          window.history.replaceState(null, "", window.location.pathname + (suffix ? "?" + suffix : "") + window.location.hash);
        }
        if (!next.connected) return;
        const key = "gestion-dental-drive-synced:" + (next.email || "account");
        const shouldSync = outcome === "connected" || outcome === "mirror-connected" || window.sessionStorage.getItem(key) !== "1";
        if (shouldSync) {
          const success = await syncQueue();
          if (success) window.sessionStorage.setItem(key, "1");
        }
      } catch {
        if (active) setMessage("No se pudo consultar la conexión con Google Drive.");
      }
    })();
    return () => {
      active = false;
      window.removeEventListener("gestion-dental:drive-backup", onBackup);
    };
  }, [syncQueue]);

  if (!status) return null;
  if (!status.configured) {
    return (
      <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
        <strong>Respaldo en Google Drive pendiente de configuración.</strong>
        <span className="ml-1">Cuando se active para la clínica, cada profesional podrá autorizar su propia cuenta desde aquí. Esto no impide guardar fichas.</span>
      </section>
    );
  }
  if (!status.connected) {
    return (
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#b9dcda] bg-white px-4 py-4" aria-label="Conexión de Google Drive">
        <div>
          <p className="font-semibold text-[#174c50]">Activa el respaldo automático en Google Drive</p>
          <p className="mt-1 text-sm text-[#60757a]">La aplicación te pedirá permiso para guardar las fichas en el Drive de esta cuenta. Puedes seguir trabajando aunque no lo conectes ahora.</p>
          {message && <p className="mt-2 text-sm text-[#60757a]" role="status">{message}</p>}
        </div>
        <a href="/api/drive/connect" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#087f83] px-4 py-2 text-sm font-semibold text-white hover:bg-[#07676b]">
          Conectar Google Drive
        </a>
      </section>
    );
  }
  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm" aria-label="Respaldo de Google Drive" role="status">
      <div>
        <p className="font-semibold text-emerald-950">Respaldo automático activo en {status.email || "Google Drive"}.</p>
        {message && <p className="mt-1 text-emerald-900">{message}</p>}
        {status.lastRun && !status.lastRun.ok && status.lastRun.detail.includes("insufficientPermissions") && <p className="mt-1"><a href="/api/drive/connect" className="font-semibold text-emerald-950 underline">Volver a conectar Google Drive</a> y dejar marcada la casilla de Drive.</p>}
        {(status.mirrors ?? []).map(mirror => <p key={mirror.email} className="mt-1 text-xs text-emerald-800">Copia adicional en {mirror.email}: {mirror.backedUp} de {mirror.total} fichas{mirror.lastVerifiedAt ? " (última " + fechaChile(mirror.lastVerifiedAt) + ")" : ""}.</p>)}
        <p className="mt-1 text-xs"><a href="/api/drive/connect?mirror=1" className="text-emerald-900 underline">{(status.mirrors ?? []).length ? "Agregar otra cuenta de Drive" : "Respaldar también en otra cuenta de Drive"}</a></p>
        {status.lastRun && <p className={"mt-1 text-xs " + (status.lastRun.ok ? "text-emerald-800" : "text-rose-800")}>Último intento {status.lastRun.source === "cron" ? "automático" : "manual"} ({fechaChile(status.lastRun.ranAt)}): {status.lastRun.ok ? "correcto" : status.lastRun.detail}</p>}
      </div>
      {syncError && (
        <button type="button" onClick={() => void syncQueue()} disabled={busy} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-semibold text-emerald-950 disabled:opacity-60">
          {busy ? "Sincronizando…" : "Reintentar respaldo"}
        </button>
      )}
    </section>
  );
}
