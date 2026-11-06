"use client";
import { PERIO_SITES, formatFdi, type PerioExam, type PerioSiteKey, type ToothHistoryEvent } from "@/app/clinical-data";

const dayOf = (iso?: string, fallback = "") => (iso || fallback).slice(0, 10);
const shown = (day: string) => (day ? day.split("-").reverse().join("-") : "sin fecha");

/** Evolución de una pieza en el tiempo: hitos del odontograma y sondaje por sitio con su variación entre exámenes. */
export function ToothTimeline({ tooth, history, exams, mode }: { tooth: number; history: ToothHistoryEvent[]; exams: PerioExam[]; mode: "odontograma" | "periodontograma" }) {
  const events = history
    .filter((event) => event.tooth === tooth)
    .map((event) => ({ day: dayOf(event.clinicalDate, event.recordedAt), title: event.title || event.eventType, detail: event.detail || "", manual: event.source === "manual" }))
    .sort((a, b) => b.day.localeCompare(a.day));
  const measured = exams
    .filter((exam) => exam.teeth[tooth])
    .map((exam) => ({ exam, data: exam.teeth[tooth], day: dayOf(exam.recordedAt) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const sites = PERIO_SITES.map((site) => site.key as PerioSiteKey);
  return (
    <section className="rounded-xl border border-[#dce5e7] bg-white p-4" aria-label={`Evolución de la pieza ${formatFdi(tooth)}`} data-testid="tooth-timeline">
      <h4 className="font-semibold">Evolución de la pieza FDI {formatFdi(tooth)}</h4>
      {mode === "odontograma" && (
        <ul className="mt-3 space-y-2 text-sm text-[#31575b]">
          {events.length === 0 && <li className="text-[#71858b]">Sin cambios registrados para esta pieza.</li>}
          {events.map((event, index) => (
            <li key={index} className="rounded-lg border border-[#e5eced] p-2.5">
              <span className="font-semibold text-[#087f83]">{shown(event.day)}</span> · {event.title}
              {event.detail ? <span className="text-[#60757a]"> — {event.detail}</span> : null}
              {event.manual ? <span className="ml-2 text-xs text-[#71858b]">(manual)</span> : null}
            </li>
          ))}
        </ul>
      )}
      {mode === "periodontograma" && (
        measured.length === 0 ? <p className="mt-3 text-sm text-[#71858b]">Sin sondaje registrado para esta pieza.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead><tr className="text-xs text-[#60757a]"><th className="p-1.5">Fecha</th>{sites.map((site) => <th key={site} className="p-1.5">{site}</th>)}<th className="p-1.5">Mov.</th><th className="p-1.5">Furc.</th></tr></thead>
              <tbody>
                {measured.map((row, index) => {
                  const before = index > 0 ? measured[index - 1].data : undefined;
                  return (
                    <tr key={row.exam.id} className="border-t border-[#edf1f2]">
                      <td className="p-1.5 font-semibold text-[#087f83]">{shown(row.day)}</td>
                      {sites.map((site) => {
                        const now = row.data.sites[site];
                        const prev = before?.sites[site];
                        const depth = now?.depth;
                        const delta = depth != null && prev?.depth != null ? depth - prev.depth : null;
                        return (
                          <td key={site} className={`p-1.5 ${depth != null && depth >= 6 ? "text-rose-800" : depth != null && depth >= 4 ? "text-amber-800" : ""}`}>
                            {depth == null ? "–" : depth}{now?.bleeding ? "•" : ""}
                            {delta ? <span className={`ml-1 text-xs ${delta > 0 ? "text-rose-700" : "text-emerald-700"}`}>{delta > 0 ? `+${delta}` : delta}</span> : null}
                          </td>
                        );
                      })}
                      <td className="p-1.5">{row.data.mobility || "–"}</td>
                      <td className="p-1.5">{row.data.furcation || "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[#60757a]">Profundidad de sondaje en mm; • = sangrado; +/− = cambio respecto del examen anterior.</p>
          </div>
        )
      )}
    </section>
  );
}
