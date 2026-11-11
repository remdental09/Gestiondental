"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Finding = { key: string; rule: string; severity: "alta" | "media"; patientId: number; patientName: string; tooth?: number; message: string; fix: string; decision: "abierta" | "real" | "falsa" };
type Report = { findings: Finding[]; abiertas: number; real: number; falsa: number; precision: number | null };

/** Observaciones de la revisión posterior: lo que quedó guardado y no cuadra. Solo marca, nunca modifica la ficha. */
function useAudit(patientId?: number) {
  const [report, setReport] = useState<Report | null>(null);
  const load = useCallback(() => {
    const query = patientId ? `?patientId=${patientId}` : "";
    fetch(`/api/auditoria${query}`, { cache: "no-store" }).then((r) => r.ok ? r.json() as Promise<Report> : null).then(setReport).catch(() => setReport(null));
  }, [patientId]);
  useEffect(load, [load]);
  const decide = async (key: string, decision: "real" | "falsa" | "abierta") => {
    await fetch("/api/auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, decision }) }).catch(() => null);
    load();
  };
  return { report, decide };
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
  const { report, decide } = useAudit();
  if (!report) return null;
  const shown = report.findings.slice(0, 8);
  return <section className="surface md:col-span-3" aria-label="Revisión posterior" data-testid="audit-panel">
    <div className="flex flex-wrap items-center gap-2"><ShieldCheck className="size-5 text-[#473a6d]" /><h3 className="font-semibold">Revisión posterior de las fichas</h3></div>
    <p className="mt-1 text-xs text-[#6b6a7c]">Revisa lo que quedó guardado (odontograma, presupuestos y evoluciones recientes) y marca lo que no cuadra. No cambia nada solo.{report.precision !== null && ` Hasta ahora marcaste ${report.real} como reales y ${report.falsa} como falsas alarmas.`}</p>
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
