"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Group = { category: string; label: string; total: number; corrected: number; rate: number; top: Array<{ kind: string; rejected: number; edited: number; added: number }> };
type Clinician = { owner_id: string; label: string; fichas: number; evoluciones: number; evoluciones30d: number; dictados: number; ultima: string | null; aceptacion: number | null; groups: Group[] };
type Summary = { clinicians: Clinician[]; overall: Group[]; dictados: number; casos: number; iaDisponible: boolean };
type CaseResult = { id: string; nota: string; motor: string; ok: boolean; fallas: string[]; odontograma: string[]; arancel: string[] };

const pct = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)} %`;
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "sin actividad";

function Corrections({ groups }: { groups: Group[] }) {
  const shown = groups.filter((group) => group.corrected > 0);
  if (!shown.length) return <p className="text-xs text-[#6b6a7c]">Sin correcciones registradas.</p>;
  return <ul className="space-y-2">{shown.map((group) => <li key={group.category} className="rounded-lg border border-[#ebeaf1] p-2">
    <p className="text-sm font-medium">{group.label}: <span className="text-[#a43542]">{group.corrected} de {group.total} corregidos ({pct(group.rate)})</span></p>
    <ul className="mt-1 space-y-0.5 text-xs text-[#3b3355]">{group.top.map((item) => <li key={item.kind}>· {item.kind} — {[item.rejected && `${item.rejected} quitado${item.rejected > 1 ? "s" : ""}`, item.edited && `${item.edited} editado${item.edited > 1 ? "s" : ""}`, item.added && `${item.added} agregado${item.added > 1 ? "s" : ""} a mano`].filter(Boolean).join(", ")}</li>)}</ul>
  </li>)}</ul>;
}

/** Solo el titular: uso de cada profesional, qué se corrige de la IA y prueba del banco de casos con la IA real. */
export function ImprovementPanel() {
  const [data, setData] = useState<Summary | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/mejora", { cache: "no-store" }).then((r) => r.ok ? r.json() as Promise<Summary> : null).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;

  const evaluate = async () => {
    setRunning(true); setError(""); setResults([]);
    let from: number | null = 0;
    try {
      while (from !== null) {
        const response = await fetch("/api/mejora", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desde: from }) });
        const body = await response.json().catch(() => ({})) as { results?: CaseResult[]; siguiente?: number | null; error?: string };
        if (!response.ok) throw new Error(body.error || "No se pudo evaluar.");
        setResults((current) => [...current, ...(body.results ?? [])]);
        from = body.siguiente ?? null;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo evaluar."); }
    finally { setRunning(false); }
  };
  const passed = results.filter((item) => item.ok).length;

  return <section className="surface md:col-span-3" aria-label="Mejora continua" data-testid="improvement-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Mejora continua (solo tú la ves)</h3>
        <p className="mt-1 text-xs text-[#6b6a7c]">Uso de cada profesional y lo que más corrigen de las propuestas del dictado. Solo cifras y tipos de ítem: nunca el texto dictado ni datos de pacientes. {data.dictados} dictados revisados en total.</p></div>
      <Button type="button" variant="outline" size="sm" disabled={running || !data.iaDisponible} onClick={() => void evaluate()} data-testid="improvement-evaluate">
        {running ? <Loader2 className="mr-1 size-4 animate-spin" /> : <FlaskConical className="mr-1 size-4" />}Probar comprensión con la IA real ({data.casos} casos)</Button>
    </div>

    {(running || results.length > 0 || error) && <div className="mt-4 rounded-lg border border-[#e6e4ee] bg-[#f7f6fa] p-3 text-sm" data-testid="improvement-results">
      <p className="font-medium">{running ? `Evaluando… ${results.length} de ${data.casos}` : `Resultado: ${passed} de ${results.length} casos correctos con la IA real.`}</p>
      {error && <p role="alert" className="mt-1 text-[#a43542]">{error}</p>}
      <ul className="mt-2 space-y-1 text-xs">{results.map((item) => <li key={item.id} className={item.ok ? "text-emerald-800" : "text-[#a43542]"}>
        {item.ok ? "✓" : "✗"} {item.nota}{!item.ok && <span className="block pl-4 text-[#3b3355]">Falla: {item.fallas.join("; ")} · odontograma: {item.odontograma.join(", ") || "—"} · arancel: {item.arancel.join(", ") || "—"}</span>}
      </li>)}</ul>
    </div>}

    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div><h4 className="text-sm font-semibold">Lo que más se corrige (todos)</h4><div className="mt-2"><Corrections groups={data.overall} /></div></div>
      <div><h4 className="text-sm font-semibold">Profesionales</h4>
        <ul className="mt-2 space-y-2">{data.clinicians.map((item) => <li key={item.owner_id} className="rounded-lg border border-[#ebeaf1] p-3 text-sm">
          <p className="font-medium">{item.label}</p>
          <p className="text-xs text-[#6b6a7c]">{item.fichas} fichas · {item.evoluciones} evoluciones ({item.evoluciones30d} en 30 días) · {item.dictados} dictados revisados · aceptación sin cambios {pct(item.aceptacion)} · última actividad {when(item.ultima)}</p>
          {item.dictados > 0 && <details className="mt-1"><summary className="cursor-pointer text-xs font-medium text-[#473a6d]">Qué corrige</summary><div className="mt-2"><Corrections groups={item.groups} /></div></details>}
        </li>)}</ul></div>
    </div>
  </section>;
}
