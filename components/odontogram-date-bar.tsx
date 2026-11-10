"use client";

import { CalendarClock, History } from "lucide-react";

const label = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Selector «Ver el odontograma al…»: Hoy (editable) o una fecha con cambios (solo lectura, reconstruida desde el historial). */
export function OdontogramDateBar({ dates, value, onChange, what = "Odontograma" }: { dates: string[]; value: string | null; onChange: (date: string | null) => void; what?: string }) {
  if (!dates.length) return null;
  const chip = (active: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#dddbe6] bg-white text-[#3b3355] hover:bg-[#efeef4]"}`;
  return <div className="mb-3 space-y-2" data-testid={`date-bar-${what.toLowerCase()}`}>
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]"><History className="size-4" />Ver al</span>
      <button type="button" className={chip(value === null)} onClick={() => onChange(null)} aria-pressed={value === null}>Hoy</button>
      {dates.map(date => <button key={date} type="button" className={chip(value === date)} onClick={() => onChange(date)} aria-pressed={value === date} data-testid={`odontogram-date-${date}`}>{label(date)}</button>)}
    </div>
    {value && <p role="status" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><CalendarClock className="size-4 shrink-0" />{what} al {label(value)}, como quedó registrado ese día. Solo lectura: vuelve a «Hoy» para editar.</p>}
  </div>;
}
