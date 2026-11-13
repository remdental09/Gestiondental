"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { hasAnamnesis, normalizeAnamnesis, type Anamnesis } from "@/lib/anamnesis";
import { buildPatientBrief, type BriefBudget, type BriefNote, type BriefPayment } from "@/lib/patient-brief";
import { chileDay } from "@/lib/chile-day";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const ago = (days: number | null) => days === null ? "" : days <= 0 ? "hoy" : days === 1 ? "ayer" : days < 60 ? `hace ${days} días` : `hace ${Math.round(days / 30)} meses`;

/** Resumen previo a la cita: solo lo ya registrado en la ficha, con las alertas primero. No propone ni deduce nada. */
export function PatientBriefCard({ patientId, legacyAllergies, notes, budgets, payments }: {
  patientId: number;
  legacyAllergies?: string;
  notes: BriefNote[];
  budgets: BriefBudget[];
  payments: BriefPayment[];
}) {
  const [anamnesis, setAnamnesis] = useState<Anamnesis | null>(null);
  const [state, setState] = useState<"cargando" | "listo" | "error">("cargando");
  useEffect(() => {
    let alive = true;
    setState("cargando"); setAnamnesis(null);
    void fetch(`/api/anamnesis?patientId=${patientId}`, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { anamnesis?: unknown };
        if (alive) { setAnamnesis(data.anamnesis ? normalizeAnamnesis(data.anamnesis) : null); setState("listo"); }
      })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [patientId]);
  const brief = useMemo(() => buildPatientBrief({ anamnesis, legacyAllergies, notes, budgets, payments, today: chileDay(new Date().toISOString()) }), [anamnesis, legacyAllergies, notes, budgets, payments]);

  return <div className="mt-4 space-y-3 text-sm" data-testid="patient-brief" aria-label="Resumen previo a la cita">
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]"><ClipboardList className="size-3.5" aria-hidden="true" />Antes de atender</p>
    {state === "error" && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" data-testid="brief-error">No se pudo leer la anamnesis: revisa las alertas en la ficha antes de anestesiar.</p>}
    {state === "listo" && brief.alerts.length > 0 && <ul className="flex flex-wrap gap-2" data-testid="brief-alerts">{brief.alerts.map(alert => <li key={alert} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900"><AlertTriangle className="size-3.5" aria-hidden="true" />{alert}</li>)}</ul>}
    {state === "listo" && brief.gaps.length > 0 && <p className="text-xs text-amber-900" data-testid="brief-gaps"><strong>Sin registrar:</strong> {brief.gaps.join(", ")}.</p>}
    {state === "listo" && brief.alerts.length === 0 && brief.gaps.length === 0 && <p className="text-xs text-[#4a6a50]" data-testid="brief-clear">Sin alertas registradas.</p>}
    {state === "listo" && hasAnamnesis(anamnesis) && brief.background.length > 0 && <details className="text-xs text-[#4b4a5b]"><summary className="cursor-pointer font-medium text-[#473a6d]">Antecedentes registrados</summary><dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">{brief.background.map(([label, value]) => <div key={label} className="contents"><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl></details>}
    {brief.lastVisit
      ? <p data-testid="brief-last-visit"><strong>Última atención:</strong> {brief.lastVisit.date}{brief.lastVisit.daysAgo !== null && ` (${ago(brief.lastVisit.daysAgo)})`} · {brief.lastVisit.title}{brief.lastVisit.excerpt && <span className="block text-xs text-[#615f73]">{brief.lastVisit.excerpt}</span>}</p>
      : <p className="text-xs text-[#6b6a7c]" data-testid="brief-no-visit">Aún no hay evoluciones registradas.</p>}
    {brief.recentDiagnoses.length > 0 && <p data-testid="brief-diagnoses"><strong>Diagnósticos recientes:</strong> {brief.recentDiagnoses.join("; ")}.</p>}
    {brief.pendingTreatments.items.length > 0 && <p data-testid="brief-pending"><strong>Pendiente en el plan:</strong> {brief.pendingTreatments.items.join("; ")}{brief.pendingTreatments.more > 0 && ` y ${brief.pendingTreatments.more} más`}.</p>}
    {brief.owed > 0 && <p data-testid="brief-owed"><strong>Saldo por cobrar:</strong> {money(brief.owed)}</p>}
  </div>;
}
