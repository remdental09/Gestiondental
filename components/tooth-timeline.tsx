"use client";
import { chileDay } from "@/lib/chile-day";
import { useState } from "react";
import { PERIO_SITES, formatFdi, type PerioExam, type PerioReading, type PerioSiteKey, type PerioTooth, type ToothHistoryEvent } from "@/app/clinical-data";

const dayOf = (iso?: string, fallback = "") => iso ? chileDay(iso) : chileDay(fallback);
/** Hitos antiguos guardaron la causa de ausencia en inglés («other»): se muestra en español. */
const spanishTitle = (title: string) => title.replace(/^(Causa de ausencia: )(caries|other|unknown)$/, (_, head: string, value: string) => head + (value === "caries" ? "caries" : value === "other" ? "otra causa" : "sin registrar"));
const shown = (day: string) => (day ? day.split("-").reverse().join("-") : "sin fecha");
const MOBILITY = ["", "I", "II", "III"];
const FURCATION = ["", "I", "II", "III"];
const inputClass = "rounded-md border border-[#cfc6e6] bg-white px-2 py-1 text-sm";

type EventFields = { title: string; detail: string; clinicalDate: string };

/** Evolución de una pieza en el tiempo: hitos del odontograma y sondaje por sitio, con variación entre exámenes y edición por fecha. */
export function ToothTimeline({ tooth, history, exams, mode, editableIds = [], onDeleteEvent, onEditEvent, onDeleteReading, onEditReading }: {
  tooth: number; history: ToothHistoryEvent[]; exams: PerioExam[]; mode: "odontograma" | "periodontograma"; editableIds?: string[];
  onDeleteEvent?: (tooth: number, eventId: string, title: string) => Promise<void>;
  onEditEvent?: (tooth: number, eventId: string, fields: EventFields) => Promise<void>;
  onDeleteReading?: (tooth: number, examId: number, day: string) => Promise<void>;
  onEditReading?: (tooth: number, examId: number, reading: PerioTooth, clinicalDate: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventFields>({ title: "", detail: "", clinicalDate: "" });
  const [editingExam, setEditingExam] = useState<number | null>(null);
  const [readingDraft, setReadingDraft] = useState<PerioTooth | null>(null);
  const [examDate, setExamDate] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setMessage(""); setBusy(true);
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar el cambio."); return false; } finally { setBusy(false); }
    return true;
  };

  const events = history
    .filter((event) => event.tooth === tooth)
    .map((event) => ({ id: event.id, day: dayOf(event.clinicalDate, event.recordedAt), title: spanishTitle(event.title || event.eventType), detail: event.detail || "", manual: event.source === "manual" }))
    .sort((a, b) => b.day.localeCompare(a.day));
  const measured = exams
    .filter((exam) => exam.teeth[tooth])
    .map((exam) => ({ exam, data: exam.teeth[tooth], day: dayOf(exam.recordedAt) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const sites = PERIO_SITES.map((site) => site.key as PerioSiteKey);
  const today = chileDay(new Date().toISOString());

  const patchSite = (site: PerioSiteKey, patch: Partial<PerioReading>) => setReadingDraft((current) => {
    if (!current) return current;
    const old = current.sites[site] ?? { depth: null, margin: null, bleeding: false, suppuration: false };
    return { ...current, sites: { ...current.sites, [site]: { ...old, ...patch } } };
  });

  return (
    <section className="rounded-xl border border-[#ddd6f0] bg-white p-4" aria-label={`Evolución de la pieza ${formatFdi(tooth)}`} data-testid="tooth-timeline">
      <h4 className="font-semibold">Evolución de la pieza FDI {formatFdi(tooth)}</h4>
      {message ? <p role="alert" className="mt-2 text-sm text-rose-700">{message}</p> : null}
      {mode === "odontograma" && (
        <ul className="mt-3 space-y-2 text-sm text-[#3d2f73]">
          {events.length === 0 && <li className="text-[#6e6a8c]">Sin cambios registrados para esta pieza.</li>}
          {events.map((event) => {
            const editable = editableIds.includes(event.id);
            if (editingEvent === event.id) {
              return (
                <li key={event.id} className="space-y-2 rounded-lg border border-[#a78bf0] bg-[#f7f4ff] p-2.5">
                  <label className="block text-xs">Fecha<input type="date" max={today} value={eventDraft.clinicalDate} onChange={(e) => setEventDraft({ ...eventDraft, clinicalDate: e.target.value })} className={`${inputClass} ml-2`} /></label>
                  <label className="block text-xs">Hito<input value={eventDraft.title} maxLength={180} onChange={(e) => setEventDraft({ ...eventDraft, title: e.target.value })} className={`${inputClass} mt-1 w-full`} /></label>
                  <label className="block text-xs">Detalle<input value={eventDraft.detail} maxLength={400} onChange={(e) => setEventDraft({ ...eventDraft, detail: e.target.value })} className={`${inputClass} mt-1 w-full`} /></label>
                  <div className="flex gap-3 text-xs font-semibold">
                    <button type="button" disabled={busy || !eventDraft.title.trim()} className="text-[#6a3fc8] underline disabled:opacity-50" onClick={async () => { if (await run(() => onEditEvent!(tooth, event.id, eventDraft))) setEditingEvent(null); }}>Guardar</button>
                    <button type="button" className="text-[#625e82] underline" onClick={() => setEditingEvent(null)}>Cancelar</button>
                  </div>
                </li>
              );
            }
            return (
              <li key={event.id} className="rounded-lg border border-[#e6e0f4] p-2.5">
                <span className="font-semibold text-[#6a3fc8]">{shown(event.day)}</span> · {event.title}
                {event.detail ? <span className="text-[#625e82]"> — {event.detail}</span> : null}
                {event.manual ? <span className="ml-2 text-xs text-[#6e6a8c]">(manual)</span> : null}
                {editable && onEditEvent ? <button type="button" className="ml-3 text-xs font-semibold text-[#6a3fc8] underline" aria-label={`Editar hito ${event.title}`} onClick={() => { setEditingEvent(event.id); setEventDraft({ title: event.title, detail: event.detail, clinicalDate: event.day }); }}>Editar</button> : null}
                {editable && onDeleteEvent ? <button type="button" className="ml-3 text-xs font-semibold text-rose-700 underline" aria-label={`Eliminar hito ${event.title}`} onClick={() => run(() => onDeleteEvent(tooth, event.id, event.title))}>Eliminar</button> : null}
              </li>
            );
          })}
        </ul>
      )}
      {mode === "periodontograma" && (
        measured.length === 0 ? <p className="mt-3 text-sm text-[#6e6a8c]">Sin sondaje registrado para esta pieza.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="text-xs text-[#625e82]"><th className="p-1.5">Fecha</th>{sites.map((site) => <th key={site} className="p-1.5">{site}</th>)}<th className="p-1.5">Mov.</th><th className="p-1.5">Furc.</th>{onDeleteReading || onEditReading ? <th className="p-1.5"><span className="sr-only">Acciones</span></th> : null}</tr></thead>
              <tbody>
                {measured.map((row, index) => {
                  const before = index > 0 ? measured[index - 1].data : undefined;
                  const editing = editingExam === row.exam.id && readingDraft;
                  return (
                    <tr key={row.exam.id} className="border-t border-[#eeeaf8] align-top">
                      <td className="p-1.5 font-semibold text-[#6a3fc8]">
                        {editing ? <input type="date" max={today} aria-label="Fecha del examen" value={examDate} onChange={(e) => setExamDate(e.target.value)} className={inputClass} /> : shown(row.day)}
                      </td>
                      {sites.map((site) => {
                        const now = editing ? readingDraft.sites[site] : row.data.sites[site];
                        const prev = before?.sites[site];
                        const depth = now?.depth;
                        const delta = !editing && depth != null && prev?.depth != null ? depth - prev.depth : null;
                        if (editing) {
                          return (
                            <td key={site} className="p-1">
                              <input type="number" min={0} max={15} aria-label={`Sondaje ${site}`} value={depth ?? ""} onChange={(e) => patchSite(site, { depth: e.target.value === "" ? null : Math.max(0, Math.min(15, Math.round(Number(e.target.value)))) })} className={`${inputClass} w-14`} />
                              <label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`Sangrado ${site}`} checked={Boolean(now?.bleeding)} onChange={(e) => patchSite(site, { bleeding: e.target.checked })} />sang.</label>
                            </td>
                          );
                        }
                        return (
                          <td key={site} className={`p-1.5 ${depth != null && depth >= 6 ? "text-rose-800" : depth != null && depth >= 4 ? "text-amber-800" : ""}`}>
                            {depth == null ? "–" : depth}{now?.bleeding ? "•" : ""}
                            {delta ? <span className={`ml-1 text-xs ${delta > 0 ? "text-rose-700" : "text-emerald-700"}`}>{delta > 0 ? `+${delta}` : delta}</span> : null}
                          </td>
                        );
                      })}
                      <td className="p-1.5">{editing ? <select aria-label="Movilidad" value={readingDraft.mobility} onChange={(e) => setReadingDraft({ ...readingDraft, mobility: e.target.value })} className={inputClass}>{MOBILITY.map((v) => <option key={v} value={v}>{v || "–"}</option>)}</select> : row.data.mobility || "–"}</td>
                      <td className="p-1.5">{editing ? <select aria-label="Furcación" value={readingDraft.furcation} onChange={(e) => setReadingDraft({ ...readingDraft, furcation: e.target.value })} className={inputClass}>{FURCATION.map((v) => <option key={v} value={v}>{v || "–"}</option>)}</select> : row.data.furcation || "–"}</td>
                      {onDeleteReading || onEditReading ? (
                        <td className="whitespace-nowrap p-1.5 text-xs font-semibold">
                          {editing ? (
                            <>
                              <button type="button" disabled={busy} className="text-[#6a3fc8] underline disabled:opacity-50" onClick={async () => { if (await run(() => onEditReading!(tooth, row.exam.id, readingDraft, examDate && examDate !== row.day ? examDate : ""))) { setEditingExam(null); setReadingDraft(null); } }}>Guardar</button>
                              <button type="button" className="ml-2 text-[#625e82] underline" onClick={() => { setEditingExam(null); setReadingDraft(null); }}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              {onEditReading ? <button type="button" className="text-[#6a3fc8] underline" aria-label={`Editar medición del ${shown(row.day)}`} onClick={() => { setEditingExam(row.exam.id); setReadingDraft(structuredClone(row.data)); setExamDate(row.day); }}>Editar</button> : null}
                              {onDeleteReading ? <button type="button" className="ml-2 text-rose-700 underline" aria-label={`Eliminar medición del ${shown(row.day)}`} onClick={() => run(() => onDeleteReading(tooth, row.exam.id, shown(row.day)))}>Eliminar</button> : null}
                            </>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[#625e82]">Profundidad de sondaje en mm; • = sangrado; +/− = cambio respecto del examen anterior. Cambiar la fecha mueve todo el examen.</p>
          </div>
        )
      )}
    </section>
  );
}
