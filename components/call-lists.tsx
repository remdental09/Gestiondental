"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, MessageCircle, Phone, Undo2 } from "lucide-react";
import { agoLabel, CALL_LISTS, CALL_LIST_HELP, CALL_LIST_LABEL, INACTIVE_MONTHS, recentlyContacted, type CallEntry, type CallList, type CallLists } from "@/lib/call-lists";

type Data = { today: string; months: number; lists: CallLists; unassignedFutureEvents: number };
const selectCls = "h-11 rounded-md border border-[#d9d5e4] bg-white px-2 text-base sm:h-9 sm:text-sm";
const telHref = (phone: string) => { const digits = phone.replace(/[^\d+]/g, ""); return digits.replace(/\D/g, "").length >= 8 ? `tel:${digits}` : null; };
const shortDay = (day: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/**
 * «A quién llamar» (Controles): pacientes sin cita futura, inactivos, presupuestos sin iniciar y morosos.
 * El mensaje de WhatsApp sale listo y la persona lo envía; al abrirlo queda marcado «contactado» (se puede deshacer)
 * y esa persona se oculta de su lista por unos días.
 */
export function CallLists({ onOpenPatient }: { onOpenPatient: (patientId: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [months, setMonths] = useState(12);
  const [tab, setTab] = useState<CallList>("sinCita");
  const [showContacted, setShowContacted] = useState(false);

  const load = useCallback(async (signal?: { live: boolean }) => {
    try {
      const response = await fetch(`/api/llamar?meses=${months}`, { cache: "no-store" });
      const next = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(next.error || "No se pudieron cargar las listas.");
      if (!signal || signal.live) { setData(next); setError(""); }
    } catch (cause) { if (!signal || signal.live) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las listas."); }
  }, [months]);
  useEffect(() => { const signal = { live: true }; void load(signal); return () => { signal.live = false; }; }, [load]);

  /** Marca o desmarca al instante y revierte si el servidor no lo guarda. */
  const mark = useCallback(async (list: CallList, patientId: number, contacted: boolean) => {
    let previous: Data | null = null;
    setData(current => {
      previous = current;
      if (!current) return current;
      const day = current.today;
      return { ...current, lists: { ...current.lists, [list]: current.lists[list].map(e => e.patientId === patientId ? { ...e, contactedOn: contacted ? day : null } : e) } };
    });
    try {
      const response = await fetch("/api/llamar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, list, contacted }) });
      if (!response.ok) throw new Error();
      setError("");
    } catch { setData(previous); setError("No se pudo guardar el contacto. Reintenta."); }
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    return Object.fromEntries(CALL_LISTS.map(list => {
      const all = data.lists[list];
      const hidden = all.filter(e => recentlyContacted(e.contactedOn, data.today)).length;
      return [list, { rows: showContacted ? all : all.filter(e => !recentlyContacted(e.contactedOn, data.today)), hidden, total: all.length }];
    })) as Record<CallList, { rows: CallEntry[]; hidden: number; total: number }>;
  }, [data, showContacted]);

  const current = view?.[tab];
  return <section className="space-y-3" aria-label="A quién llamar" data-testid="call-lists">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Listas">
        {CALL_LISTS.map(list => <button key={list} type="button" role="tab" aria-selected={tab === list} onClick={() => setTab(list)} data-testid={`call-tab-${list}`}
          className={"min-h-11 rounded-full border px-3 text-sm font-medium sm:min-h-9 " + (tab === list ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#dddbe6] bg-white text-[#35343f]")}>
          {CALL_LIST_LABEL[list]}{view ? <span className={"ml-1.5 rounded-full px-1.5 text-xs " + (tab === list ? "bg-white/20" : "bg-[#efeef4]")}>{view[list].rows.length}</span> : null}
        </button>)}
      </div>
      <label className="ml-auto flex items-center gap-2 text-sm">Inactivo tras
        <select className={selectCls} value={months} onChange={event => setMonths(Number(event.target.value))} aria-label="Meses sin venir para considerar inactivo" data-testid="call-months">
          {INACTIVE_MONTHS.map(m => <option key={m} value={m}>{m} meses</option>)}
        </select>
      </label>
    </div>
    <p className="text-xs text-[#615f73]">{CALL_LIST_HELP[tab]}</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    {!data && !error && <p role="status" className="text-sm text-[#6b6a7c]">Armando las listas…</p>}
    {current && <>
      <label className="flex items-center gap-2 text-sm text-[#35343f]"><input type="checkbox" className="size-4" checked={showContacted} onChange={event => setShowContacted(event.target.checked)} />
        Mostrar los ya contactados{current.hidden > 0 && !showContacted ? ` (${current.hidden} oculto${current.hidden === 1 ? "" : "s"})` : ""}</label>
      {current.rows.length === 0
        ? <p className="rounded-xl bg-[#f4f3f8] p-4 text-sm text-[#615f73]" data-testid="call-empty">{current.total === 0 ? "Nadie en esta lista por ahora." : "Ya contactaste a todos los de esta lista. 🎉"}</p>
        : <ul className="divide-y divide-[#ebeaf1] rounded-xl border border-[#e6e4ee] bg-white" data-testid="call-rows">
          {current.rows.map(entry => <CallRow key={`${tab}-${entry.patientId}-${entry.budgetId ?? ""}`} entry={entry} list={tab} today={data!.today} onOpenPatient={onOpenPatient} onMark={mark} />)}
        </ul>}
      {data && data.unassignedFutureEvents > 0 && <p className="text-xs text-[#7a5a12]" data-testid="call-unassigned">{data.unassignedFutureEvents} cita{data.unassignedFutureEvents === 1 ? "" : "s"} de Google Calendar sin paciente asignado no se cuenta{data.unassignedFutureEvents === 1 ? "" : "n"}: asígnalas en la Agenda para que esas personas no aparezcan como «sin cita».</p>}
    </>}
  </section>;
}

function CallRow({ entry, list, today, onOpenPatient, onMark }: { entry: CallEntry; list: CallList; today: string; onOpenPatient: (id: number) => void; onMark: (list: CallList, patientId: number, contacted: boolean) => void }) {
  const tel = telHref(entry.phone);
  const done = entry.contactedOn !== null;
  return <li className={"flex flex-wrap items-center gap-x-3 gap-y-2 p-3 " + (done ? "bg-[#f6f9f6]" : "")} data-testid="call-row">
    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
      <button type="button" onClick={() => onOpenPatient(entry.patientId)} className="block max-w-full truncate text-left font-medium text-[#35343f] hover:text-[#473a6d] hover:underline">{entry.name}</button>
      <p className="text-xs text-[#615f73]">{entry.detail}{entry.phone ? ` · ${entry.phone}` : ""}</p>
      {done && <p className="text-xs font-medium text-[#1f5a2c]" data-testid="call-contacted">Contactado {entry.contactedOn === today ? "hoy" : `el ${shortDay(entry.contactedOn!)} (${agoLabel(Math.max(0, Math.round((Date.parse(today) - Date.parse(entry.contactedOn!)) / 86400000)))})`}</p>}
    </div>
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {entry.whatsapp
        ? <a href={entry.whatsapp} target="_blank" rel="noreferrer" onClick={() => { if (!done) onMark(list, entry.patientId, true); }} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-[#25d366] px-3 text-sm font-semibold text-white sm:min-h-9" data-testid="call-whatsapp"><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>
        : <span className="text-xs text-[#6b6a7c]" title="El paciente no tiene un celular chileno válido en su ficha.">Sin celular</span>}
      {tel && <a href={tel} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[#dddbe6] bg-white px-3 text-sm font-medium text-[#35343f] sm:min-h-9" data-testid="call-phone"><Phone className="size-4" aria-hidden="true" />Llamar</a>}
      {done
        ? <button type="button" onClick={() => onMark(list, entry.patientId, false)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[#dddbe6] bg-white px-3 text-sm text-[#615f73] sm:min-h-9" data-testid="call-undo"><Undo2 className="size-4" aria-hidden="true" />Deshacer</button>
        : <button type="button" onClick={() => onMark(list, entry.patientId, true)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[#9ccc65] bg-white px-3 text-sm font-semibold text-[#2f5d12] sm:min-h-9" data-testid="call-done"><Check className="size-4" aria-hidden="true" />Contactado</button>}
    </div>
  </li>;
}
