"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { dentistsCsv, type DashboardSummary, type DentistRow } from "@/lib/developer-dashboard";

type Payload = { dentists: DentistRow[]; summary: DashboardSummary; generatedAt: string };
type Filter = "todos" | "registrados" | "pendientes";

const dateTime = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", year: "numeric" });
const fmt = (iso: string | null, withTime = true) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : (withTime ? dateTime : dateOnly).format(date);
};

function Tile({ label, value, hint, tone = "plain" }: { label: string; value: number; hint: string; tone?: "plain" | "good" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-[#35343f]";
  return (
    <div className="rounded-xl border border-[#dddbe6] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#6f6d80]">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-[#6f6d80]">{hint}</p>
    </div>
  );
}

function Status({ row }: { row: DentistRow }) {
  return row.registered
    ? <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Registrado</span>
    : <span className="inline-flex whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Sin completar datos</span>;
}

export default function PanelDesarrollador() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/desarrollador", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el panel.");
      setData(body as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el panel.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.dentists ?? []).filter(r =>
      (filter === "todos" || (filter === "registrados") === r.registered) &&
      (!needle || [r.name, r.email, r.googleName, r.rut, r.specialty, r.clinic].some(v => v.toLowerCase().includes(needle))));
  }, [data, query, filter]);

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([dentistsCsv(data.dentists)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `speakdent-dentistas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(url);
  }

  const s = data?.summary;
  return (
    <main className="min-h-screen bg-[#f1f0f5] text-[#35343f]">
      <header className="sticky top-0 z-10 border-b border-[#dddbe6] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <a href="/" className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#473a6d] hover:bg-[#e6e4ee]"><ArrowLeft className="size-4" /><span className="hidden sm:inline">Volver a la app</span></a>
            <span className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold"><ShieldCheck className="size-4 shrink-0 text-[#473a6d]" />Panel del desarrollador</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="flex min-h-10 items-center gap-2 rounded-lg border border-[#dddbe6] bg-white px-3 text-sm font-medium text-[#473a6d] hover:bg-[#f7f6fa] disabled:opacity-60" aria-label="Actualizar"><RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /><span className="hidden sm:inline">Actualizar</span></button>
            <button type="button" onClick={downloadCsv} disabled={!data?.dentists.length} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50"><Download className="size-4" /><span className="hidden sm:inline">Descargar Excel (CSV)</span></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
        <div>
          <h1 className="text-2xl font-semibold">Dentistas en SpeakDent</h1>
          <p className="mt-1 text-sm text-[#6f6d80]">Quién entró con Google y quién completó su registro profesional. Solo tú ves esta página.{data && <> Actualizado: {fmt(data.generatedAt)}</>}</p>
        </div>

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading && !data && <p role="status" className="text-sm text-[#6f6d80]">Cargando dentistas…</p>}

        {s && (
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Tile label="Entraron" value={s.total} hint="cuentas de Google" />
            <Tile label="Registrados" value={s.registered} hint="con RUT y especialidad" tone="good" />
            <Tile label="Sin completar" value={s.pending} hint="entraron, sin datos" tone={s.pending ? "warn" : "plain"} />
            <Tile label="Activos 7 días" value={s.activeLast7Days} hint="abrieron la app" />
            <Tile label="Nuevos 30 días" value={s.newLast30Days} hint="primer ingreso" />
            <Tile label="Pacientes" value={s.patients} hint="fichas en total" />
          </section>
        )}

        {data && (
          <section className="rounded-xl border border-[#dddbe6] bg-white">
            <div className="flex flex-col gap-3 border-b border-[#dddbe6] p-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative flex-1 sm:max-w-sm">
                <span className="sr-only">Buscar dentista</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8c8a9c]" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, correo, RUT o especialidad" className="h-10 w-full rounded-lg border border-[#dddbe6] pl-9 pr-3 text-sm outline-none focus:border-[#9d93c4]" />
              </label>
              <div className="flex gap-1 rounded-lg bg-[#f1f0f5] p-1" role="group" aria-label="Filtrar">
                {(["todos", "registrados", "pendientes"] as const).map(f => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-8 rounded-md px-3 text-sm font-medium ${filter === f ? "bg-white text-[#473a6d] shadow-sm" : "text-[#6f6d80]"}`}>{f === "pendientes" ? "Sin completar" : f === "registrados" ? "Registrados" : "Todos"}</button>
                ))}
              </div>
            </div>

            {rows.length === 0 && <p className="p-6 text-sm text-[#6f6d80]">{data.dentists.length ? "Ningún dentista coincide con la búsqueda." : "Todavía no ha entrado nadie."}</p>}

            {rows.length > 0 && (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm" data-testid="tabla-dentistas">
                    <thead className="bg-[#f7f6fa] text-xs uppercase tracking-wide text-[#6f6d80]">
                      <tr><th className="px-4 py-3 font-medium">Dentista</th><th className="px-4 py-3 font-medium">RUT</th><th className="px-4 py-3 font-medium">Especialidad</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Primer ingreso</th><th className="px-4 py-3 font-medium">Último ingreso</th><th className="px-4 py-3 text-right font-medium">Visitas</th><th className="px-4 py-3 text-right font-medium">Pacientes</th><th className="px-4 py-3 text-right font-medium">Evoluciones</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[#eceaf2]">
                      {rows.map(r => (
                        <tr key={r.key} className="align-top hover:bg-[#faf9fc]">
                          <td className="px-4 py-3"><p className="font-semibold">{r.name || r.googleName || "—"}</p><p className="text-xs text-[#6f6d80]">{r.email}</p>{r.clinic && <p className="text-xs text-[#6f6d80]">{r.clinic}</p>}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.rut || "—"}</td>
                          <td className="px-4 py-3">{r.specialty || "—"}{r.extraTitles && <p className="text-xs text-[#6f6d80]">{r.extraTitles}</p>}</td>
                          <td className="px-4 py-3"><Status row={r} /></td>
                          <td className="whitespace-nowrap px-4 py-3">{fmt(r.firstSeen, false)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{fmt(r.lastSeen)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.visits}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.patients}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-[#eceaf2] md:hidden" data-testid="lista-dentistas-movil">
                  {rows.map(r => (
                    <li key={r.key} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{r.name || r.googleName || r.email}</p><p className="truncate text-xs text-[#6f6d80]">{r.email}</p></div><Status row={r} /></div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="text-[#6f6d80]">RUT</dt><dd className="tabular-nums">{r.rut || "—"}</dd>
                        <dt className="text-[#6f6d80]">Especialidad</dt><dd>{r.specialty || "—"}</dd>
                        <dt className="text-[#6f6d80]">Primer ingreso</dt><dd>{fmt(r.firstSeen, false)}</dd>
                        <dt className="text-[#6f6d80]">Último ingreso</dt><dd>{fmt(r.lastSeen)}</dd>
                        <dt className="text-[#6f6d80]">Pacientes / evol.</dt><dd className="tabular-nums">{r.patients} / {r.notes}</dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        <p className="text-xs text-[#8c8a9c]">«Último ingreso» y «Visitas» se cuentan desde hoy en adelante: los ingresos anteriores a este panel no quedaron anotados. Los registros profesionales sí aparecen desde el inicio.</p>
      </div>
    </main>
  );
}
