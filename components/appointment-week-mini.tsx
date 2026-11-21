"use client";
import { useMemo, useState } from "react";
import { addDays, blocksByDay, conflictsWith, formatSpan, formatTime, freeSummary, gridHours, proposedBlock, timeAtOffset, weekMonday, type WeekEvent } from "@/lib/appointment-week";

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Semana en miniatura para «Agendar cita»: muestra cómo está cubierta la semana mientras se elige día, hora y duración. */
export function AppointmentWeekMini({ events, day, time, minutes, onPick }: { events: WeekEvent[]; day: string; time: string; minutes: number; onPick: (day: string, time: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [nav, setNav] = useState({ anchor: day, offset: 0 });
  // Al cambiar el día elegido (toque o campo de fecha) la vista vuelve a la semana de ese día.
  const offset = nav.anchor === day ? nav.offset : 0;
  const setOffset = (value: number) => setNav({ anchor: day, offset: value });
  const weekStart = addDays(weekMonday(day || new Date().toISOString().slice(0, 10)), offset * 7);
  const days = useMemo(() => blocksByDay(events, weekStart), [events, weekStart]);
  const proposed = proposedBlock(day, time, minutes);
  const { startHour, endHour } = gridHours(days, proposed);
  const hourHeight = expanded ? 72 : 30;
  const height = (endHour - startHour) * hourHeight;
  const top = (minute: number) => ((minute - startHour * 60) / 60) * hourHeight;
  const dayKeys = Object.keys(days);
  const visibleKeys = dayKeys.filter((key, index) => index < 6 || days[key]!.length > 0 || key === day);
  const conflicts = proposed ? conflictsWith(days[proposed.day] ?? [], proposed) : [];
  const summary = freeSummary(days[day] ?? []);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rangeLabel = `${Number(weekStart.slice(8))}–${Number(addDays(weekStart, 6).slice(8))} ${new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("es-CL", { month: "short", timeZone: "UTC" })}`;

  return (
    <section aria-label="Semana en miniatura" data-testid="appt-week-mini" className="space-y-1.5 rounded-lg border border-[#dddbe6] bg-white p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Semana anterior" className="h-8 w-8 rounded-md border text-base" onClick={() => setOffset(offset - 1)}>‹</button>
          <span className="min-w-[5.5rem] text-center font-medium text-[#473a6d]">{rangeLabel}</span>
          <button type="button" aria-label="Semana siguiente" className="h-8 w-8 rounded-md border text-base" onClick={() => setOffset(offset + 1)}>›</button>
        </div>
        <button type="button" className="min-h-8 px-2 font-medium text-[#473a6d] underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Reducir" : "Ampliar"}</button>
      </div>
      <div className="flex" style={{ height: height + 18 }}>
        <div className="w-7 shrink-0 pt-[18px] text-[9px] leading-none text-[#6b6a7c]" aria-hidden="true">
          {hours.map(hour => <div key={hour} style={{ height: hourHeight }}>{expanded || hour % 2 === 0 ? hour : ""}</div>)}
        </div>
        <div className="grid min-w-0 flex-1 gap-px" style={{ gridTemplateColumns: `repeat(${visibleKeys.length}, minmax(0, 1fr))` }}>
          {visibleKeys.map(key => {
            const index = dayKeys.indexOf(key);
            const selected = key === day;
            return (
              <div key={key} className="min-w-0">
                <div className={`h-[18px] truncate text-center text-[10px] font-medium ${selected ? "text-[#473a6d]" : "text-[#6b6a7c]"}`}>{DAY_NAMES[index]} {Number(key.slice(8))}</div>
                <button
                  type="button"
                  aria-label={`Elegir hora el ${DAY_NAMES[index]} ${Number(key.slice(8))}`}
                  className={`relative block w-full overflow-hidden rounded-sm border text-left ${selected ? "border-[#b8b1d6] bg-[#f7f5fc]" : "border-[#eceaf2] bg-[#fafafc]"}`}
                  style={{ height }}
                  onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onPick(key, timeAtOffset(event.clientY - rect.top, hourHeight, startHour, endHour));
                  }}
                >
                  {days[key]!.map(block => (
                    <span key={block.id} className="absolute inset-x-0 overflow-hidden break-words border-y border-white bg-[#cfd8e8] px-0.5 py-px text-[10px] font-medium leading-[1.15] text-[#1f2a44]" style={{ top: top(block.start), height: Math.max(12, top(block.end) - top(block.start)) }}>{expanded ? `${formatTime(block.start)} ` : ""}{block.title}</span>
                  ))}
                  {proposed && proposed.day === key && (
                    <span data-testid="appt-week-proposed" className={`absolute inset-x-0 border-2 ${conflicts.length ? "border-[#a43542] bg-[#a43542]/40" : "border-[#473a6d] bg-[#b8a4f0]/70"}`} style={{ top: top(proposed.start), height: Math.max(3, top(proposed.end) - top(proposed.start)) }} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {(days[day] ?? []).length > 0 && (
        <ul aria-label="Citas de ese día" className="space-y-0.5 rounded-md bg-[#f7f5fc] p-2 text-[13px] text-[#1f2a44]">
          {(days[day] ?? []).map(block => <li key={block.id} className="flex gap-2"><span className="shrink-0 font-semibold tabular-nums">{formatTime(block.start)}–{formatTime(block.end)}</span><span className="min-w-0 break-words">{block.title}</span></li>)}
        </ul>
      )}
      <p className="text-[13px] text-[#4a4960]" aria-live="polite">
        {conflicts.length ? <span role="alert" className="font-medium text-[#a43542]">Se cruza con {conflicts.map(block => `${block.title} (${formatTime(block.start)})`).join(", ")}.</span> : null}
        {conflicts.length ? " " : ""}
        {summary.freeMinutes > 0 ? `Ese día quedan ${formatSpan(summary.freeMinutes)} libres${summary.largest ? `; el mayor hueco es de ${formatTime(summary.largest.start)} a ${formatTime(summary.largest.end)}` : ""}.` : "Ese día no quedan horas libres."}
      </p>
    </section>
  );
}
