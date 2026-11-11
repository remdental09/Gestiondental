"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Finding = { key: string; rule: string; severity: "alta" | "media"; patientId: number; patientName: string; tooth?: number; message: string; fix: string; decision: "abierta" | "real" | "falsa" };
type Report = { findings: Finding[]; abiertas: number; real: number; falsa: number; precision: number | null; iaDisponible: boolean; pendientesIA: number; titular: boolean; casos: number };
type CaseResult = { id: string; nota: string; ok: boolean; faltaron: string[]; sobraron: string[]; error?: string };

// Una sola revisión con IA a la vez en toda la pantalla, aunque haya varios avisos montados.
let reviewing = false;

/** Observaciones de la revisión posterior: lo que quedó guardado y no cuadra. Solo marca, nunca modifica la ficha. */
function useAudit(patientId?: number) {
  const [report, setReport] = useState<Report | null>(null);
  const load = useCallback(() => {
    const query = patientId ? `?patientId=${patientId}` : "";
    fetch(`/api/auditoria${query}`, { cache: "no-store" }).then((r) => r.ok ? r.json() as Promise<Report> : null).then(setReport).catch(() => setReport(null));
  }, [patientId]);
  useEffect(load, [load]);
  // La IA lee en segundo plano las evoluciones recientes aún sin revisar (de a pocas) y la lista se actualiza sola.
  const pending = report?.iaDisponible ? report.pendientesIA : 0;
  useEffect(() => {
    if (!pending || reviewing) return;
    reviewing = true;
    (async () => {
      for (let round = 0; round < 8; round++) {
        const result = await fetch("/api/auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "revisar" }) }).then((r) => r.ok ? r.json() as Promise<{ revisadas: number; pendientes: number }> : null).catch(() => null);
        if (!result || result.revisadas === 0 || result.pendientes === 0) break;
      }
    })().finally(() => { reviewing = false; load(); });
  }, [pending, load]);
  const decide = async (key: string, decision: "real" | "falsa" | "abierta") => {
    await fetch("/api/auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, decision }) }).catch(() => null);
    load();
  };
  return { report, decide, reviewingNotes: pending > 0 };
}

function Row({ item, onDecide, onOpen }: { item: Finding; onDecide: (key: string, decision: "real" | "falsa" | "abierta") => void; onOpen?: (patientId: number) => void }) {
  return <li className={`rounded-lg border p-3 text-sm ${item.severity === "alta" ? "border-[#e8b8bd] bg-[#fdf3f4]" : "border-amber-200 bg-amber-50"}`} data-testid="audit-finding">
    <p>{onOpen ? <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => onOpen(item.patientId)}>{item.patientName}</button> : null}{onOpen ? " · " : ""}{item.message}</p>
    <p className="mt-1 text-xs text-[#615f73]">{item.fix}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {item.decision === "real"
        ? <><span className="text-xs font-medium text-[#a43542]">Marcada como real</span><Button type="button" size="sm" variant="outline" onClick={() => onDecide(item.key, "abierta")}>Deshacer</Button></>
        : <><Button type="button" size="sm" variant="outline" onClick={() => onDecide(item.key, "real")}>Es real, lo reviso</Button><Button type="button" size="sm" variant="outline" onClick={() => onDecide(item.key, "falsa")}>Falsa alarma</Button></>}
    </div>
  </li>;
}

/** Resumen: todas las observaciones abiertas del profesional. */
export function AuditPanel({ onOpenPatient }: { onOpenPatient: (patientId: number) => void }) {
  const { report, decide, reviewingNotes } = useAudit();
  const [results, setResults] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false), [error, setError] = useState("");
  if (!report) return null;
  const shown = report.findings.slice(0, 8);
  const evaluate = async () => {
    setRunning(true); setError(""); setResults([]);
    let from: number | null = 0;
    try {
      while (from !== null) {
        const response = await fetch("/api/auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "probar", desde: from }) });
        const body = await response.json().catch(() => ({})) as { results?: CaseResult[]; siguiente?: number | null; error?: string };
        if (!response.ok) throw new Error(body.error || "No se pudo probar.");
        setResults((current) => [...current, ...(body.results ?? [])]);
        from = body.siguiente ?? null;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo probar."); }
    finally { setRunning(false); }
  };
  const passed = results.filter((item) => item.ok).length;
  return <section className="surface md:col-span-3" aria-label="Revisión posterior" data-testid="audit-panel">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-[#473a6d]" /><h3 className="font-semibold">Revisión posterior de las fichas</h3></div>
      {report.titular && report.iaDisponible && <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void evaluate()} data-testid="audit-evaluate">
        {running ? <Loader2 className="mr-1 size-4 animate-spin" /> : <FlaskConical className="mr-1 size-4" />}Probar la lectura con la IA real ({report.casos} casos)</Button>}</div>
    <p className="mt-1 text-xs text-[#6b6a7c]">Revisa lo que quedó guardado (odontograma, presupuestos y evoluciones recientes) y marca lo que no cuadra. No cambia nada solo.{reviewingNotes && " Leyendo con IA las evoluciones recientes…"}{report.precision !== null && ` Hasta ahora marcaste ${report.real} como reales y ${report.falsa} como falsas alarmas.`}</p>
    {(running || results.length > 0 || error) && <div className="mt-3 rounded-lg border border-[#e6e4ee] bg-[#f7f6fa] p-3 text-sm" data-testid="audit-results">
      <p className="font-medium">{running ? `Probando… ${results.length} de ${report.casos}` : `Resultado: ${passed} de ${results.length} casos correctos con la IA real.`}</p>
      {error && <p className="mt-1 text-[#a43542]">{error}</p>}
      <ul className="mt-2 space-y-1 text-xs">{results.map((item) => <li key={item.id} className={item.ok ? "text-[#2f6b4a]" : "text-[#a43542]"}>{item.ok ? "✓" : "✗"} {item.nota}{item.faltaron.length > 0 && ` — no encontró: ${item.faltaron.join(", ")}`}{item.sobraron.length > 0 && ` — avisó de más: ${item.sobraron.join(", ")}`}{item.error && ` — ${item.error}`}</li>)}</ul>
    </div>}
    {shown.length ? <ul className="mt-3 space-y-2">{shown.map((item) => <Row key={item.key} item={item} onDecide={decide} onOpen={onOpenPatient} />)}</ul>
      : <p className="mt-3 text-sm text-[#615f73]">Sin observaciones abiertas.</p>}
    {report.findings.length > shown.length && <p className="mt-2 text-xs text-[#6b6a7c]">Y {report.findings.length - shown.length} más; ábrelas desde cada ficha.</p>}
  </section>;
}

/** Ficha de un paciente: sus observaciones abiertas, si las hay. */
export function AuditNotice({ patientId }: { patientId: number }) {
  const { report, decide } = useAudit(patientId);
  if (!report?.findings.length) return null;
  return <div className="surface border-amber-200" data-testid="audit-notice">
    <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-[#473a6d]" />Revisión posterior: {report.findings.length} {report.findings.length === 1 ? "observación" : "observaciones"}</h3>
    <ul className="mt-3 space-y-2">{report.findings.map((item) => <Row key={item.key} item={item} onDecide={decide} />)}</ul>
  </div>;
}
