"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Search, Wallet } from "lucide-react";
import { pendingBalances, quickSearch, todayAgenda, type TodayBudget, type TodayEvent, type TodayPatient, type TodayPayment } from "@/lib/today-agenda";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const hour = (iso: string) => new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(new Date(iso));
const longDate = () => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).format(new Date());
const stateLabel = { pasada: "Atendida", ahora: "En curso", siguiente: "Siguiente", luego: "" } as const;

/** Panel del día: lo que importa ahora (próximo paciente, citas, saldos) y un buscador que abre la ficha con 3 letras. */
export function TodayPanel({ patients, events, budgets, payments, onOpenPatient, onOpenAgenda }: {
  patients: Array<TodayPatient>;
  events: Array<TodayEvent>;
  budgets: TodayBudget[];
  payments: TodayPayment[];
  onOpenPatient: (id: number) => void;
  onOpenAgenda: () => void;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => todayAgenda(events, patients), [events, patients]);
  const balances = useMemo(() => pendingBalances(patients, budgets, payments), [patients, budgets, payments]);
  const results = useMemo(() => quickSearch(patients, query), [patients, query]);
  const focus = items.find(item => item.state === "ahora") ?? items.find(item => item.state === "siguiente");
  const pending = items.filter(item => item.state !== "pasada");

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
            ? <button type="button" onClick={() => onOpenPatient(focus.patient!.id)} className="mt-3 rounded-lg bg-[#473a6d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#3a2f5a]" data-testid="today-open-ficha">Abrir ficha</button>
            : <p className="mt-2 text-xs text-[#6b6a7c]">No se reconoce una ficha para esta cita; búscala abajo.</p>}
        </div>
        : <p className="mt-4 rounded-xl bg-[#f4f3f8] p-4 text-sm text-[#615f73]" data-testid="today-empty">{items.length > 0 ? "Ya no quedan citas por atender hoy." : "No hay citas en tu calendario para hoy."}</p>}
      {pending.length > 1 && <ul className="mt-4 divide-y divide-[#ebeaf1]">{pending.filter(item => item !== focus).map(item => <li key={item.event.id} className="flex items-center justify-between gap-3 py-2 text-sm">
        <span className="min-w-0 truncate"><strong className="mr-2 tabular-nums">{hour(item.event.startAt)}</strong>{item.patient?.name ?? item.event.title}</span>
        {item.patient && <button type="button" onClick={() => onOpenPatient(item.patient!.id)} className="shrink-0 text-sm font-medium text-[#473a6d] hover:underline">Abrir ficha</button>}
      </li>)}</ul>}
      {items.some(item => item.state === "pasada") && <p className="mt-3 text-xs text-[#6b6a7c]">{items.filter(item => item.state === "pasada").length} {items.filter(item => item.state === "pasada").length === 1 ? "cita ya pasó" : "citas ya pasaron"} hoy.</p>}
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
