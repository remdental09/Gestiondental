"use client";

import { useEffect, useMemo, useState } from "react";
import { anamnesisAlerts, hasAnamnesis, normalizeAnamnesis, anamnesisSummary, type Anamnesis } from "@/lib/anamnesis";

type Snapshot = { patientId: number; status: "ready" | "error"; anamnesis: Anamnesis | null };
const meaningful = (value?: string) => value?.trim() && !/^sin registrar$/i.test(value.trim()) ? value.trim() : "";

/** Muestra la anamnesis guardada y usa los campos antiguos de ficha solo como respaldo explícito. */
export function PatientAnamnesisSummary({ patientId, legacyHistory, legacyAllergies }: {
  patientId: number;
  legacyHistory?: string;
  legacyAllergies?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const current = snapshot?.patientId === patientId ? snapshot : null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/anamnesis?patientId=${patientId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("No se pudo leer la anamnesis.");
        const data = await response.json() as { anamnesis?: unknown };
        if (active) setSnapshot({ patientId, status: "ready", anamnesis: data.anamnesis ? normalizeAnamnesis(data.anamnesis) : null });
      })
      .catch(() => { if (active && !controller.signal.aborted) setSnapshot({ patientId, status: "error", anamnesis: null }); });

    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: number; anamnesis?: unknown }>).detail;
      if (detail?.patientId === patientId) {
        controller.abort();
        setSnapshot({ patientId, status: "ready", anamnesis: detail.anamnesis ? normalizeAnamnesis(detail.anamnesis) : null });
      }
    };
    window.addEventListener("patient-anamnesis-saved", onSaved);
    return () => { active = false; controller.abort(); window.removeEventListener("patient-anamnesis-saved", onSaved); };
  }, [patientId]);

  const entries = useMemo(() => current?.anamnesis && hasAnamnesis(current.anamnesis) ? anamnesisSummary(current.anamnesis) : [], [current]);
  const anamnesis = current?.anamnesis;
  const recorded = !!anamnesis && hasAnamnesis(anamnesis);
  const historyEntries = entries.filter(([label]) => label !== "Alergias" && label !== "Medicamentos");
  const oldHistory = meaningful(legacyHistory);
  const oldAllergies = meaningful(legacyAllergies);
  const history = historyEntries.map(([label, value]) => `${label}: ${value}`).join(" · ") || oldHistory || "Sin registrar";
  const allergies = anamnesis?.allergies || oldAllergies || "Sin registrar";
  const medications = anamnesis?.medications || "Sin registrar";
  const allergyAlert = anamnesis
    ? anamnesisAlerts(anamnesis).some(alert => alert.startsWith("Alergias:"))
    : Boolean(oldAllergies && !/^(niega|no|sin|ninguna|sin alergias|no refiere)\b/i.test(oldAllergies));
  const legacyDiffers = (value: string, currentValue: string) => Boolean(value && currentValue && value.toLocaleLowerCase() !== currentValue.toLocaleLowerCase());

  return <section className="mt-7 border-t border-[#ebeaf1] pt-5" aria-label="Antecedentes y anamnesis" data-testid="patient-anamnesis-summary">
    {current ? <>
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryField label={recorded ? "Antecedentes clínicos" : "Antecedentes"} value={history}/>
        <SummaryField label="Alergias" value={allergies} alert={allergyAlert}/>
        <SummaryField label="Medicamentos" value={medications}/>
      </div>
      {current.status === "error" && <p role="alert" className="mt-3 text-xs text-amber-900">No se pudo actualizar la anamnesis; se muestran los antecedentes previos de la ficha.</p>}
      {recorded && <>
        {legacyDiffers(oldHistory, historyEntries.map(([, value]) => value).join(" · ")) && <p className="mt-3 text-xs text-[#6b6a7c]">Antecedentes previos de la ficha: {oldHistory}</p>}
        {legacyDiffers(oldAllergies, anamnesis?.allergies ?? "") && <p className="mt-1 text-xs text-[#6b6a7c]">Alergias previas de la ficha: {oldAllergies}</p>}
        {entries.length > 0 && <details className="mt-3 rounded-lg border border-[#e6e4ee] px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-[#473a6d]">Ver todos los antecedentes registrados</summary>
          <dl className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap">{value}</dd></div>)}</dl>
        </details>}
      </>}
    </> : <p role="status" className="text-sm text-[#6b6a7c]">Cargando antecedentes clínicos…</p>}
  </section>;
}

function SummaryField({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={alert ? "rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200" : "min-w-0"}>
    <p className="text-xs font-medium uppercase tracking-wide text-[#8b8ca3]">{label}</p>
    <p className={`mt-1 whitespace-pre-wrap text-sm font-medium ${alert ? "text-rose-900" : "text-[#35343f]"}`}>{value}</p>
  </div>;
}
