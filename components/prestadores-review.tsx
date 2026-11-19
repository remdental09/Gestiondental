"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, LoaderCircle, XCircle } from "lucide-react";
import { RNPI_SITE, type PublicRegistration } from "@/lib/prestador-certificate";

type Row = PublicRegistration & { professionalId: string; email: string; status: "pendiente" | "aprobado" | "rechazado"; reviewNote: string; updatedAt: string };
const STATUS = { pendiente: "bg-amber-50 text-amber-900 border-amber-200", aprobado: "bg-emerald-50 text-emerald-900 border-emerald-200", rechazado: "bg-rose-50 text-rose-900 border-rose-200" } as const;

/** Solo desarrollador: compara los datos del certificado con el registro oficial y aprueba o rechaza la emisión de recetas. */
export function PrestadoresReview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/desarrollador/prestadores", { cache: "no-store" });
      const data = await response.json() as { registrations?: Row[]; error?: string };
      if (!response.ok || !data.registrations) throw new Error(data.error || "No se pudieron leer las habilitaciones.");
      setRows(data.registrations); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudieron leer las habilitaciones."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const review = async (row: Row, action: "aprobar" | "rechazar") => {
    let note = "";
    if (action === "rechazar") { note = (window.prompt("Motivo del rechazo (se le muestra al profesional):") ?? "").trim(); if (!note) return; }
    else if (!window.confirm(`¿Confirmas que ${row.fullName} (REG-SIS ${row.regSis}, RUN ${row.run}) figura en ${RNPI_SITE}? Podrá emitir recetas.`)) return;
    setBusy(row.professionalId);
    try {
      const response = await fetch("/api/desarrollador/prestadores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ professionalId: row.professionalId, action, note }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(""); }
  };

  return <section className="rounded-xl border border-[#dddbe6] bg-white p-4" aria-label="Habilitaciones para recetas">
    <h2 className="font-semibold">Habilitación para recetas</h2>
    <p className="mt-1 text-sm text-[#6f6d80]">Compara el N° de registro y el RUN con la búsqueda oficial ({RNPI_SITE}) antes de aprobar. Solo se guardan los datos necesarios, no el PDF.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}
    {loading ? <p className="mt-3 text-sm text-[#6f6d80]" role="status">Cargando…</p> : !rows.length ? <p className="mt-3 text-sm text-[#6f6d80]">Aún no hay certificados subidos.</p> : <ul className="mt-3 space-y-2">{rows.map(row => <li key={row.professionalId} className="rounded-lg border border-[#e6e4ee] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.fullName}</strong><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS[row.status]}`}>{row.status}</span></div>
      <p className="mt-1 text-[#44425a]">{row.profession}{row.specialties.length ? ` · ${row.specialties.join(", ")}` : ""} · REG-SIS {row.regSis} · RUN {row.run}</p>
      <p className="text-xs text-[#6f6d80]">{row.email} · certificado del {row.issuedOn} · código {row.validationCode}</p>
      {row.reviewNote && <p className="mt-1 text-xs text-rose-900">Motivo: {row.reviewNote}</p>}
      {row.status !== "aprobado" && <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy === row.professionalId} onClick={() => void review(row, "aprobar")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-3 font-semibold text-white disabled:opacity-50">{busy === row.professionalId ? <LoaderCircle className="size-4 animate-spin"/> : <BadgeCheck className="size-4"/>}Aprobar</button><button type="button" disabled={busy === row.professionalId} onClick={() => void review(row, "rechazar")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300 px-3 font-semibold text-rose-800 disabled:opacity-50"><XCircle className="size-4"/>Rechazar</button></div>}
      {row.status === "aprobado" && <button type="button" disabled={busy === row.professionalId} onClick={() => void review(row, "rechazar")} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300 px-3 font-semibold text-rose-800 disabled:opacity-50"><XCircle className="size-4"/>Revocar</button>}
    </li>)}</ul>}
  </section>;
}
