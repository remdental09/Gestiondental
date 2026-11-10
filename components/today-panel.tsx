"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, MessageCircle, Search, Wallet } from "lucide-react";
import { agendaForDay, confirmationMessage, type EventHints, nextDay, pendingBalances, quickSearch, todayAgenda, whatsappLink, type TodayBudget, type TodayEvent, type TodayPatient, type TodayPayment } from "@/lib/today-agenda";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const hour = (iso: string) => new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(new Date(iso));
const longDate = () => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).format(new Date());
const stateLabel = { pasada: "Atendida", ahora: "En curso", siguiente: "Siguiente", luego: "" } as const;

/** Panel del día: lo que importa ahora (próximo paciente, citas, saldos) y un buscador que abre la ficha con 3 letras. */
export function TodayPanel({ patients, events, budgets, payments, clinicName, onOpenPatient, onOpenAgenda }: {
  patients: Array<TodayPatient>;
  events: Array<TodayEvent>;
  budgets: TodayBudget[];
  payments: TodayPayment[];
  clinicName?: string;
  onOpenPatient: (id: number) => void;
  onOpenAgenda: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState<Record<number, string>>({});
  const [confirmError, setConfirmError] = useState("");
  const [hints, setHints] = useState<EventHints>({});
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  useEffect(() => {
    let alive = true;
    void fetch("/api/appointment-confirmations", { cache: "no-store" })
      .then(async response => { if (alive && response.ok) { const data = await response.json() as { confirmed?: Record<number, string>; hints?: EventHints; declined?: number[] }; setConfirmed(data.confirmed ?? {}); setHints(data.hints ?? {}); setDeclined(new Set(data.declined ?? [])); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [events]);
  const toggleConfirmed = useCallback(async (eventId: number) => {
    const next = !confirmed[eventId];
    setConfirmError("");
    setConfirmed(current => { const copy = { ...current }; if (next) copy[eventId] = new Date().toISOString(); else delete copy[eventId]; return copy; });
    try {
      const response = await fetch("/api/appointment-confirmations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId, confirmed: next }) });
      if (!response.ok) throw new Error();
    } catch {
      setConfirmed(current => { const copy = { ...current }; if (next) delete copy[eventId]; else copy[eventId] = new Date().toISOString(); return copy; });
      setConfirmError("No se pudo guardar la confirmación. Reintenta.");
    }
  }, [confirmed]);
  const items = useMemo(() => todayAgenda(events, patients, new Date(), hints), [events, patients, hints]);
  const balances = useMemo(() => pendingBalances(patients, budgets, payments), [patients, budgets, payments]);
  const results = useMemo(() => quickSearch(patients, query), [patients, query]);
  const tomorrow = useMemo(() => agendaForDay(events, patients, nextDay(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())), hints), [events, patients, hints]);
  const focus = items.find(item => item.state === "ahora") ?? items.find(item => item.state === "siguiente");
  const pending = items.filter(item => item.state !== "pasada");

  const confirmRow = (event: TodayEvent, patient: TodayPatient | null) => {
    const link = patient ? whatsappLink(patient.phone, confirmationMessage({ patientName: patient.name, startAt: event.startAt, clinicName })) : null;
    const done = Boolean(confirmed[event.id]);
    return <div className="flex shrink-0 flex-wrap items-center gap-2">
      {declined.has(event.id) && <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900" data-testid="today-declined">Avisó que no asistirá</span>}
      {link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[#25a244]/40 bg-[#f1fbf4] px-2.5 py-1.5 text-xs font-semibold text-[#17692e] transition hover:bg-[#e2f6e8]" data-testid="today-whatsapp"><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>
        : <span className="text-xs text-[#6b6a7c]" title={patient ? "El paciente no tiene un celular chileno válido en su ficha." : "No se reconoce la ficha de esta cita."}>{patient ? "Sin celular" : "Sin ficha"}</span>}
      <button type="button" onClick={() => void toggleConfirmed(event.id)} aria-pressed={done} data-testid="today-confirm" className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${done ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-[#d2d4df] bg-white text-[#4f4e62] hover:bg-[#f1f0f5]"}`}><Check className="size-4" aria-hidden="true" />{done ? "Confirmada" : "Marcar confirmada"}</button>
    </div>;
  };

  return <section aria-label="Tu día" data-testid="today-panel" className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] [&>*]:min-w-0">
    <div className="surface fx-rise">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Tu día</h2>
        <p className="text-sm first-letter:uppercase text-[#6b6a7c]">{longDate()}</p>
      </div>
      {focus
        ? <div className="mt-4 rounded-xl bg-gradient-to-r from-[#f4f3f8] to-[#fbeee8] p-4" data-testid="today-focus">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">{focus.state === "ahora" ? "En curso" : "Siguiente paciente"} · {hour(focus.event.startAt)}</p>
          <p className="mt-1 text-xl font-semibold text-[#35343f]">{focus.patient?.name ?? focus.event.title}</p>
          {focus.patient && focus.event.title && !focus.event.title.toLowerCase().includes(focus.patient.name.toLowerCase().split(" ")[0]) && <p className="text-sm text-[#615f73]">{focus.event.title}</p>}
          {focus.patient
            ? <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => onOpenPatient(focus.patient!.id)} className="rounded-lg bg-[#473a6d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#3a2f5a]" data-testid="today-open-ficha">Abrir ficha</button>{focus.state === "siguiente" && confirmRow(focus.event, focus.patient)}</div>
            : <p className="mt-2 text-xs text-[#6b6a7c]">No se reconoce una ficha para esta cita; búscala abajo.</p>}
        </div>
        : <p className="mt-4 rounded-xl bg-[#f4f3f8] p-4 text-sm text-[#615f73]" data-testid="today-empty">{items.length > 0 ? "Ya no quedan citas por atender hoy." : "No hay citas en tu calendario para hoy."}</p>}
      {pending.length > 1 && <ul className="mt-4 divide-y divide-[#ebeaf1]">{pending.filter(item => item !== focus).map(item => <li key={item.event.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        <span className="min-w-0 truncate"><strong className="mr-2 tabular-nums">{hour(item.event.startAt)}</strong>{item.patient?.name ?? item.event.title}</span>
        <span className="flex shrink-0 items-center gap-3">{item.patient && <button type="button" onClick={() => onOpenPatient(item.patient!.id)} className="text-sm font-medium text-[#473a6d] hover:underline">Abrir ficha</button>}{confirmRow(item.event, item.patient)}</span>
      </li>)}</ul>}
      {items.some(item => item.state === "pasada") && <p className="mt-3 text-xs text-[#6b6a7c]">{items.filter(item => item.state === "pasada").length} {items.filter(item => item.state === "pasada").length === 1 ? "cita ya pasó" : "citas ya pasaron"} hoy.</p>}
      {tomorrow.length > 0 && <div className="mt-5 border-t border-[#ebeaf1] pt-4" data-testid="today-tomorrow">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Mañana · confirmar citas</h3><p className="text-xs text-[#6b6a7c]">{tomorrow.filter(item => confirmed[item.event.id]).length} de {tomorrow.length} confirmadas</p></div>
        <ul className="mt-2 divide-y divide-[#ebeaf1]">{tomorrow.map(item => <li key={item.event.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate"><strong className="mr-2 tabular-nums">{hour(item.event.startAt)}</strong>{item.patient?.name ?? item.event.title}</span>{confirmRow(item.event, item.patient)}</li>)}</ul>
        {confirmError && <p role="alert" className="mt-2 text-xs text-[#a43542]">{confirmError}</p>}
      </div>}
      <button type="button" onClick={onOpenAgenda} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#473a6d] hover:underline"><CalendarClock className="size-4" aria-hidden="true" />Ver agenda completa</button>
    </div>

    <div className="space-y-5">
      <div className="surface fx-rise" style={{ animationDelay: "70ms" }}>
        <label htmlFor="today-search" className="flex items-center gap-2 text-sm font-semibold"><Search className="size-4" aria-hidden="true" />Buscar paciente</label>
        <input id="today-search" data-testid="today-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o RUT" autoComplete="off" className="mt-2 w-full rounded-lg border border-[#d2d4df] bg-white px-3 py-2.5 text-base outline-none focus:border-[#473a6d] focus:ring-2 focus:ring-[#473a6d]/20" />
        {query.trim().length >= 2 && (results.length > 0
          ? <ul className="mt-2 space-y-1" data-testid="today-search-results">{results.map(patient => <li key={patient.id}><button type="button" onClick={() => onOpenPatient(patient.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[#f1f0f5]"><span className="truncate font-medium">{patient.name}</span><span className="shrink-0 text-xs text-[#6b6a7c]">{patient.rut}</span></button></li>)}</ul>
          : <p className="mt-2 text-sm text-[#6b6a7c]">Sin coincidencias.</p>)}
      </div>
      {balances.length > 0 && <div className="surface fx-rise" style={{ animationDelay: "140ms" }} data-testid="today-balances">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" aria-hidden="true" />Saldos por cobrar</h3>
        <p className="text-xs text-[#6b6a7c]">Presupuestos menos abonos registrados.</p>
        <ul className="mt-2 divide-y divide-[#ebeaf1]">{balances.map(({ patient, owed }) => <li key={patient.id}><button type="button" onClick={() => onOpenPatient(patient.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-[#473a6d]"><span className="truncate">{patient.name}</span><strong className="shrink-0 tabular-nums">{money(owed)}</strong></button></li>)}</ul>
      </div>}
    </div>
  </section>;
}
