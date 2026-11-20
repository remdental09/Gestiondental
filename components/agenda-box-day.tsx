"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle, Palette, Rows3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AGENDA_SYNCED } from "@/components/next-controls";
import {
  BLOCK_COLOR, DURATIONS, LEGEND, QUICK_STATUS, STATUS_COLOR, WEEKDAY_SHORT, addDays, blocksOn, cardBox, clockAt, columnOf, columnsFor, dayRange,
  freeSlots, textOn, toClock, toMinutes, weekOf, weekdayOf, whatsappNumber, type AgendaBlock, type BoxSchedule, type FreeSlot,
} from "@/lib/agenda-box";
import { ATTENDANCE_LABEL, type AttendanceStatus } from "@/lib/dashboard";

type Box = { id: number; name: string; enabled: boolean; color?: string | null };
type Appt = { key: string; source: "app" | "cal"; id: number; patientId: number | null; patientName: string; phone: string; day: string; start: string; minutes: number; reason: string; boxId: number | null; professional: string; status: AttendanceStatus; google: boolean; needsPatient: boolean };
type PatientLite = { id: number; name: string; rut: string | null; phone: string };
type Data = { boxes: Box[]; schedules: BoxSchedule[]; blocks: AgendaBlock[]; appointments: Appt[]; patients: PatientLite[]; professional: string };
type Draft = { boxId: number | null; day: string; time: string; minutes: number; professional: string };

const chileToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const chileNowMinutes = () => { const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number); return h * 60 + m; };
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const longDay = (day: string) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const fieldCls = "h-11 w-full rounded-md border border-[#d9d5e4] bg-white px-2 text-base sm:h-9 sm:text-sm";
const BLOCKED = "bloqueado";

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/agenda-box", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo guardar.");
  return data;
}

/** Hoja inferior en iPhone, ventana centrada en escritorio. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
    <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={event => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-lg font-semibold">{title}</h4><button type="button" aria-label="Cerrar" className="grid size-11 place-items-center rounded-full hover:bg-[#efeef4]" onClick={onClose}><X className="size-5" /></button></div>
      {children}
    </div>
  </div>;
}

/** Agenda «Día por box» (como Dentalsoft): una columna por box, filas de 15 minutos, tarjetas del color de su estado. */
export function AgendaBoxDay({ onOpenPatient, onChanged }: { onOpenPatient?: (id: number) => void; onChanged?: () => void }) {
  const [day, setDay] = useState(chileToday);
  const week = useMemo(() => weekOf(day), [day]);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [boxIndex, setBoxIndex] = useState(0);
  const [selected, setSelected] = useState<Appt | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<AgendaBlock | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nowMin, setNowMin] = useState(chileNowMinutes);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => { setReloadKey(key => key + 1); }, []);
  useEffect(() => {
    let live = true;
    fetch(`/api/agenda-box?from=${week[0]}&to=${week[6]}`, { cache: "no-store" })
      .then(async response => { const next = await response.json() as Data & { error?: string }; if (!response.ok) throw new Error(next.error || "No se pudo cargar la agenda."); return next; })
      .then(next => { if (live) { setData(next); setError(""); } })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "No se pudo cargar la agenda."); });
    return () => { live = false; };
  }, [week, reloadKey]);
  useEffect(() => {
    const onSynced = () => void load();
    window.addEventListener(AGENDA_SYNCED, onSynced);
    const timer = window.setInterval(() => setNowMin(chileNowMinutes()), 60000);
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setMobile(query.matches);
    apply();
    query.addEventListener?.("change", apply);
    return () => { window.removeEventListener(AGENDA_SYNCED, onSynced); window.clearInterval(timer); query.removeEventListener?.("change", apply); };
  }, [load]);

  const changed = useCallback(async (message?: string) => {
    if (message) setNotice(message);
    await load();
    window.dispatchEvent(new Event(AGENDA_SYNCED));
    onChanged?.();
  }, [load, onChanged]);

  const boxes = useMemo(() => data?.boxes ?? [], [data]);
  const boxIds = useMemo(() => new Set(boxes.filter(b => b.enabled).map(b => b.id)), [boxes]);
  const todays = useMemo(() => (data?.appointments ?? []).filter(a => a.day === day), [data, day]);
  const visibleAppts = todays.filter(a => !hidden.has(a.status));
  const dayBlocks = useMemo(() => blocksOn(data?.blocks ?? [], day), [data, day]);
  const columns = columnsFor(boxes, todays);
  const range = dayRange(data?.schedules ?? [], day, [...todays, ...dayBlocks.map(b => ({ start: b.start, minutes: toMinutes(b.end) - toMinutes(b.start) }))]);
  const row = compact ? 16 : 26;
  const height = ((range.to - range.from) / 15) * row;
  const scheduled = todays.filter(a => a.status !== "cancelada").length;
  const shownColumns = mobile ? columns.slice(Math.min(boxIndex, Math.max(0, columns.length - 1)), Math.min(boxIndex, Math.max(0, columns.length - 1)) + 1) : columns;
  const boxName = (id: number | null) => id === null ? "Sin box" : boxes.find(b => b.id === id)?.name ?? "Box";
  const today = chileToday();

  const setStatus = async (appt: Appt, status: AttendanceStatus) => {
    setError("");
    const previous = data;
    setData(current => current && { ...current, appointments: current.appointments.map(a => a.key === appt.key ? { ...a, status } : a) });
    setSelected(current => current && current.key === appt.key ? { ...current, status } : current);
    try { await post({ action: "estado", source: appt.source, id: appt.id, status }); await changed(); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado."); }
  };

  const onTouchStart = (event: React.TouchEvent) => { const t = event.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touch.current; touch.current = null;
    if (!start || !mobile) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return;
    setBoxIndex(index => Math.max(0, Math.min(columns.length - 1, index + (dx < 0 ? 1 : -1))));
  };

  const openSlot = (boxId: number | null, time: string, minutes = 30, professional?: string) => setDraft({ boxId, day, time, minutes, professional: professional || data?.professional || "" });

  return <div data-testid="agenda-box-day">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-label="Semana anterior" className="grid size-11 place-items-center rounded-lg border border-[#dddbe6] hover:bg-[#efeef4]" onClick={() => setDay(addDays(day, -7))}><ChevronLeft className="size-5" /></button>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Días de la semana">
        {week.map(d => <button key={d} type="button" role="tab" aria-selected={d === day} onClick={() => setDay(d)} className={"min-h-11 min-w-[3.25rem] flex-1 rounded-lg border px-1 text-center text-xs font-medium " + (d === day ? "border-[#473a6d] bg-[#473a6d] text-white" : d === today ? "border-[#473a6d] text-[#473a6d]" : "border-[#dddbe6] bg-white text-[#3b3355]")}>
          <span className="block">{WEEKDAY_SHORT[weekdayOf(d)]}</span><span className="block text-sm font-semibold">{Number(d.slice(8))}</span>
        </button>)}
      </div>
      <button type="button" aria-label="Semana siguiente" className="grid size-11 place-items-center rounded-lg border border-[#dddbe6] hover:bg-[#efeef4]" onClick={() => setDay(addDays(day, 7))}><ChevronRight className="size-5" /></button>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setDay(chileToday())}>Hoy</Button>
      <label className="flex items-center gap-1 text-sm"><span className="sr-only">Fecha</span><input type="date" aria-label="Fecha" className="h-11 rounded-md border border-[#d9d5e4] px-2 text-base sm:h-9 sm:text-sm" value={day} onChange={event => { if (event.target.value) setDay(event.target.value); }} /></label>
      <p className="text-sm font-medium capitalize text-[#3b3355]">{longDay(day)}</p>
      <p className="text-sm text-[#615f73]" data-testid="box-day-count">{scheduled} {scheduled === 1 ? "cita agendada" : "citas agendadas"}</p>
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-expanded={legendOpen} onClick={() => setLegendOpen(open => !open)}><Palette className="mr-1 size-4" />Colores{hidden.size ? ` (${hidden.size} ocultos)` : ""}</Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-pressed={compact} onClick={() => setCompact(value => !value)}><Rows3 className="mr-1 size-4" />{compact ? "Expandir" : "Compactar"}</Button>
      </div>
    </div>
    {legendOpen && <div className="mt-2 rounded-xl border border-[#dddbe6] bg-white p-3" data-testid="box-legend">
      <p className="text-xs text-[#615f73]">Toca un estado para mostrarlo u ocultarlo.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[...LEGEND, { status: BLOCKED, label: "Bloqueado", color: BLOCK_COLOR }].map(item => { const off = hidden.has(item.status); return <button key={item.status} type="button" aria-pressed={!off} onClick={() => setHidden(current => { const next = new Set(current); if (off) next.delete(item.status); else next.add(item.status); return next; })} className={"inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm sm:min-h-8 " + (off ? "border-dashed border-[#c9c5d6] text-[#9b98ab] line-through" : "border-[#dddbe6]")}>
          <span className="size-3.5 rounded-full" style={{ background: item.color }} aria-hidden="true" />{item.label}
        </button>; })}
      </div>
      {hidden.size > 0 && <button type="button" className="mt-2 text-sm font-medium text-[#473a6d] underline" onClick={() => setHidden(new Set())}>Mostrar todos</button>}
    </div>}
    {mobile && columns.length > 1 && <div className="mt-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Box">
      {columns.map((c, index) => <button key={c.id ?? "sin"} type="button" role="tab" aria-selected={index === boxIndex} onClick={() => setBoxIndex(index)} className={"min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium " + (index === boxIndex ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#dddbe6] bg-white")}>{boxName(c.id)}</button>)}
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">{notice}</p>}
    {!data && !error && <p role="status" className="mt-4 text-sm text-[#6b6a7c]">Cargando agenda por box…</p>}
    {data && <div className="mt-3 overflow-x-auto rounded-xl border border-[#e6e4ee] bg-[#fbfbfd]" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex" style={{ minWidth: mobile ? undefined : 48 + shownColumns.length * 170 }}>
        <div className="w-12 shrink-0 border-r border-[#ebeaf1]">
          <div className="h-10 border-b border-[#ebeaf1]" />
          <div className="relative" style={{ height }}>{Array.from({ length: (range.to - range.from) / 60 }, (_, i) => <span key={i} className="absolute right-1 -translate-y-1/2 text-[11px] text-[#6b6a7c]" style={{ top: i * 4 * row || 6 }}>{toClock(range.from + i * 60)}</span>)}</div>
        </div>
        {shownColumns.map(column => {
          const items = visibleAppts.filter(a => columnOf(boxIds, a.boxId) === column.id);
          const blocks = hidden.has(BLOCKED) ? [] : dayBlocks.filter(b => b.boxId === null ? column.id !== null : b.boxId === column.id);
          const slots: FreeSlot[] = column.id === null ? [] : freeSlots(data.schedules, column.id, day, todays.filter(a => a.status !== "cancelada").map(a => ({ boxId: columnOf(boxIds, a.boxId), start: a.start, minutes: a.minutes })), data.blocks);
          const box = boxes.find(b => b.id === column.id);
          return <div key={column.id ?? "sin"} className="min-w-0 flex-1 border-r border-[#ebeaf1] last:border-r-0" data-testid="box-column">
            <div className="sticky top-0 z-10 flex h-10 items-center justify-center gap-2 border-b border-[#ebeaf1] bg-white px-2 text-sm font-semibold">
              <span className="size-2.5 rounded-full" style={{ background: box?.color || (column.id === null ? "#c9c5d6" : "#473a6d") }} aria-hidden="true" />{boxName(column.id)}
            </div>
            <div className="relative cursor-pointer" style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, #ebeaf1 0 1px, transparent 1px ${row}px)` }}
              onClick={event => { if (event.target !== event.currentTarget) return; const y = event.clientY - event.currentTarget.getBoundingClientRect().top; openSlot(column.id, clockAt(y, range.from, row)); }}
              aria-label={`Columna ${boxName(column.id)}: toca una hora libre para agendar`}>
              {day === today && nowMin >= range.from && nowMin <= range.to && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-rose-500" style={{ top: ((nowMin - range.from) / 15) * row }} aria-hidden="true"><span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-rose-500" /></div>}
              {slots.map(slot => { const pos = cardBox(slot.start, slot.minutes, range.from, row); return <button key={"s" + slot.start} type="button" className="absolute inset-x-1 overflow-hidden rounded-md border border-dashed border-[#c9c5d6] bg-white px-1.5 text-left text-[11px] text-[#615f73] hover:border-[#473a6d]" style={{ top: pos.top + 1, height: pos.height - 2 }} onClick={() => openSlot(column.id, slot.start, slot.minutes, slot.professional)} data-testid="free-slot">
                <span className="font-medium">{slot.start}</span>{!compact && <span className="ml-1">Libre · {slot.professional}</span>}
              </button>; })}
              {blocks.map(block => { const minutes = toMinutes(block.end) - toMinutes(block.start); const pos = cardBox(block.start, minutes, range.from, row); return <button key={"b" + block.id} type="button" className="absolute inset-x-1 z-[5] overflow-hidden rounded-md px-1.5 text-left text-[11px] text-white" style={{ top: pos.top + 1, height: pos.height - 2, background: `repeating-linear-gradient(135deg, ${BLOCK_COLOR} 0 8px, #c62828 8px 16px)` }} onClick={() => setSelectedBlock(block)} data-testid="agenda-block">
                <span className="font-semibold">{block.start}–{block.end}</span> {block.reason}
              </button>; })}
              {items.map(appt => { const pos = cardBox(appt.start, appt.minutes, range.from, row); const color = STATUS_COLOR[appt.status]; const wa = whatsappNumber(appt.phone); return <div key={appt.key} role="button" tabIndex={0} className="absolute inset-x-1 z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[12px] leading-tight shadow-sm ring-1 ring-black/5" style={{ top: pos.top + 1, height: pos.height - 2, background: color, color: textOn(color) }} onClick={() => setSelected(appt)} onKeyDown={event => { if (event.key === "Enter") setSelected(appt); }} data-testid="box-appointment" data-status={appt.status}>
                <p className="truncate"><span className="font-medium">{appt.start}–{toClock(toMinutes(appt.start) + appt.minutes)}</span> <b>{appt.patientName}</b></p>
                {!compact && pos.height > 2 * row && <>
                  {appt.professional && <p className="mt-0.5"><span className="rounded bg-white/30 px-1 text-[10px]">{appt.professional}</span></p>}
                  {appt.phone && <p className="mt-0.5 flex items-center gap-1 truncate">{appt.phone}{wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${appt.patientName}`} onClick={event => event.stopPropagation()} className="inline-grid size-6 place-items-center rounded-full bg-white/80 text-[#128c7e]"><MessageCircle className="size-3.5" /></a>}</p>}
                </>}
              </div>; })}
            </div>
          </div>;
        })}
      </div>
    </div>}
    {data && !(data.schedules.length) && <p className="mt-2 text-xs text-[#6b6a7c]">Tip: en Configuración → Box puedes definir horarios por box para ver los cupos libres. Mientras tanto, toca cualquier hora de una columna para agendar o bloquear.</p>}
    {mobile && columns.length > 1 && <p className="mt-2 text-center text-xs text-[#6b6a7c]">Desliza a los lados para cambiar de box.</p>}

    {selected && <AppointmentSheet appt={selected} boxes={boxes.filter(b => b.enabled)} boxName={boxName} onClose={() => setSelected(null)} onStatus={status => void setStatus(selected, status)} onOpenPatient={onOpenPatient}
      onMove={async change => { try { await post({ action: "mover", id: selected.id, ...change }); setSelected(null); await changed("Cita actualizada."); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo mover la cita."); } }} />}
    {selectedBlock && <Sheet title="Bloqueo" onClose={() => setSelectedBlock(null)}>
      <p className="font-medium">{selectedBlock.reason} · {selectedBlock.start}–{selectedBlock.end}</p>
      <p className="mt-1 text-sm text-[#615f73]">{boxName(selectedBlock.boxId === null ? null : selectedBlock.boxId)}{selectedBlock.boxId === null ? " (todos los box)" : ""} · {selectedBlock.repeat === "none" ? "Solo " + selectedBlock.day.split("-").reverse().join("-") : (selectedBlock.repeat === "daily" ? "Todos los días" : "Cada " + WEEKDAY_SHORT[weekdayOf(selectedBlock.day)]) + (selectedBlock.until ? " hasta " + selectedBlock.until.split("-").reverse().join("-") : "")}</p>
      {selectedBlock.note && <p className="mt-2 text-sm">{selectedBlock.note}</p>}
      <Button type="button" className="mt-4 w-full bg-[#a43542] hover:bg-[#8c2c38]" onClick={async () => { try { await post({ action: "quitarBloqueo", id: selectedBlock.id }); setSelectedBlock(null); await changed("Bloqueo quitado."); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo quitar."); } }}>{selectedBlock.repeat === "none" ? "Quitar bloqueo" : "Quitar bloqueo (toda la repetición)"}</Button>
    </Sheet>}
    {draft && <SlotSheet draft={draft} boxes={boxes.filter(b => b.enabled)} patients={data?.patients ?? []} onClose={() => setDraft(null)}
      onSaved={async message => { setDraft(null); await changed(message); }} />}
  </div>;
}

function AppointmentSheet({ appt, boxes, boxName, onClose, onStatus, onMove, onOpenPatient }: { appt: Appt; boxes: Box[]; boxName: (id: number | null) => string; onClose: () => void; onStatus: (status: AttendanceStatus) => void; onMove: (change: Record<string, unknown>) => Promise<void>; onOpenPatient?: (id: number) => void }) {
  const wa = whatsappNumber(appt.phone);
  const [busy, setBusy] = useState(false);
  const move = async (change: Record<string, unknown>) => { setBusy(true); try { await onMove(change); } finally { setBusy(false); } };
  return <Sheet title={appt.patientName} onClose={onClose}>
    <div className="flex items-center gap-2 text-sm"><span className="size-3 rounded-full" style={{ background: STATUS_COLOR[appt.status] }} aria-hidden="true" /><span className="font-medium">{ATTENDANCE_LABEL[appt.status]}</span></div>
    <p className="mt-1 text-sm">{appt.start}–{toClock(toMinutes(appt.start) + appt.minutes)} · {boxName(appt.boxId)}{appt.professional ? ` · ${appt.professional}` : ""}</p>
    {appt.reason && <p className="mt-1 text-sm"><span className="text-[#615f73]">Tratamiento: </span>{appt.reason}</p>}
    {appt.phone && <p className="mt-1 flex items-center gap-2 text-sm">{appt.phone}{wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-full bg-[#25d366] px-3 text-xs font-semibold text-white"><MessageCircle className="size-4" />WhatsApp</a>}</p>}
    {appt.needsPatient && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950">Evento de Google sin paciente: asígnalo desde la vista «Semana».</p>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="quick-status">
      {QUICK_STATUS.map(q => <button key={q.status} type="button" aria-pressed={appt.status === q.status} onClick={() => onStatus(q.status)} className="min-h-12 rounded-lg border-2 px-2 text-sm font-semibold" style={{ borderColor: STATUS_COLOR[q.status], background: appt.status === q.status ? STATUS_COLOR[q.status] : "white", color: appt.status === q.status ? textOn(STATUS_COLOR[q.status]) : "#1f2430" }}><span aria-hidden="true">{q.icon}</span> {q.label}</button>)}
    </div>
    <label className="mt-3 block space-y-1 text-sm font-medium">Estado
      <select className={fieldCls} value={appt.status} onChange={event => onStatus(event.target.value as AttendanceStatus)}>{LEGEND.map(item => <option key={item.status} value={item.status}>{item.label}</option>)}</select>
    </label>
    {appt.source === "app" && <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="space-y-1 text-sm font-medium">Box
        <select className={fieldCls} disabled={busy} value={appt.boxId ?? ""} onChange={event => void move({ boxId: event.target.value === "" ? null : Number(event.target.value) })}><option value="">Sin box</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </label>
      <label className="space-y-1 text-sm font-medium">Duración
        <select className={fieldCls} disabled={busy} value={appt.minutes} onChange={event => void move({ minutes: Number(event.target.value) })}>{DURATIONS.map(m => <option key={m} value={m}>{m} min ({m / 15} {m === 15 ? "módulo" : "módulos"})</option>)}</select>
      </label>
    </div>}
    {appt.patientId && onOpenPatient && <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => { onClose(); onOpenPatient(appt.patientId!); }}>Abrir ficha</Button>}
  </Sheet>;
}

function SlotSheet({ draft, boxes, patients, onClose, onSaved }: { draft: Draft; boxes: Box[]; patients: PatientLite[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [tab, setTab] = useState<"cita" | "bloqueo">("cita");
  const [boxId, setBoxId] = useState<number | null>(draft.boxId);
  const [time, setTime] = useState(draft.time);
  const [minutes, setMinutes] = useState(draft.minutes);
  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<PatientLite | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [reason, setReason] = useState("");
  const [professional, setProfessional] = useState(draft.professional);
  const [end, setEnd] = useState(toClock(Math.min(24 * 60 - 1, toMinutes(draft.time) + draft.minutes)));
  const [repeat, setRepeat] = useState<"none" | "weekly" | "daily">("none");
  const [until, setUntil] = useState(addDays(draft.day, 28));
  const [blockReason, setBlockReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    const digits = q.replace(/[^0-9k]/g, "");
    return patients.filter(p => fold(p.name).includes(q) || (digits.length >= 3 && (p.rut ?? "").toLowerCase().replace(/[^0-9k]/g, "").includes(digits)) || String(p.id) === q.replace(/^#/, "")).slice(0, 8);
  }, [patients, query]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      if (tab === "cita") {
        const result = await post({ action: "cita", day: draft.day, time, minutes, boxId, reason, professional, ...(isNew ? { newPatient: { name: newName, phone: newPhone } } : { patientId: patient?.id }) });
        const calendar = result.calendar;
        await onSaved("Cita agendada" + (calendar === "ok" ? " y escrita en Google Calendar." : calendar === "solo-lectura" ? ". Google Calendar está en solo lectura: reconéctalo para escribir citas." : "."));
      } else {
        await post({ action: "bloquear", boxId, day: draft.day, start: time, end, repeat, until: repeat === "none" ? null : until, reason: blockReason, note });
        await onSaved("Bloqueo guardado.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  };
  const boxSelect = (allOption: boolean) => <label className="space-y-1 text-sm font-medium">Box
    <select className={fieldCls} value={boxId ?? ""} onChange={event => setBoxId(event.target.value === "" ? null : Number(event.target.value))}>{allOption ? <option value="">Todos los box</option> : <option value="">Sin box</option>}{boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
  </label>;

  return <Sheet title="Detalle cita" onClose={onClose}>
    <p className="text-sm capitalize text-[#615f73]">{longDay(draft.day)}</p>
    <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-[#efeef4] p-1" role="tablist">
      {(["cita", "bloqueo"] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={"min-h-11 rounded-md text-sm font-semibold " + (tab === t ? "bg-white shadow" : "text-[#615f73]")}>{t === "cita" ? "Cita" : "Bloqueos"}</button>)}
    </div>
    {tab === "cita" ? <div className="mt-3 space-y-3">
      {!isNew ? <div>
        <label className="block space-y-1 text-sm font-medium">Paciente (nombre, RUT o N° de ficha)
          <input className={fieldCls} value={patient ? patient.name : query} onChange={event => { setPatient(null); setQuery(event.target.value); }} placeholder="Buscar paciente" autoComplete="off" />
        </label>
        {!patient && matches.length > 0 && <ul className="mt-1 max-h-56 divide-y overflow-auto rounded-lg border border-[#e6e4ee]" role="listbox" aria-label="Pacientes">
          {matches.map(p => <li key={p.id}><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-[#f7f6fa]" onClick={() => { setPatient(p); setQuery(""); }}><span className="font-medium">{p.name}</span><span className="text-xs text-[#6b6a7c]">{p.rut || `Ficha ${p.id}`}</span></button></li>)}
        </ul>}
        <button type="button" className="mt-2 min-h-11 text-sm font-medium text-[#473a6d] underline" onClick={() => { setIsNew(true); setNewName(query); }}>+ Paciente nuevo</button>
      </div> : <div className="grid gap-2 rounded-lg bg-[#f7f6fa] p-3">
        <p className="text-sm font-semibold">Paciente nuevo</p>
        <label className="space-y-1 text-sm font-medium">Nombre completo<input className={fieldCls} value={newName} maxLength={120} onChange={event => setNewName(event.target.value)} /></label>
        <label className="space-y-1 text-sm font-medium">Teléfono<input className={fieldCls} type="tel" inputMode="tel" value={newPhone} maxLength={30} placeholder="+56 9 …" onChange={event => setNewPhone(event.target.value)} /></label>
        <button type="button" className="min-h-11 text-left text-sm font-medium text-[#473a6d] underline" onClick={() => setIsNew(false)}>Buscar paciente existente</button>
      </div>}
      <div className="grid grid-cols-2 gap-2">
        {boxSelect(false)}
        <label className="space-y-1 text-sm font-medium">Hora<input type="time" step={900} className={fieldCls} value={time} onChange={event => setTime(event.target.value)} /></label>
        <label className="space-y-1 text-sm font-medium">Duración<select className={fieldCls} value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{DURATIONS.map(m => <option key={m} value={m}>{m} min ({m / 15} {m === 15 ? "módulo" : "módulos"})</option>)}</select></label>
        <label className="space-y-1 text-sm font-medium">Profesional<input className={fieldCls} value={professional} maxLength={80} onChange={event => setProfessional(event.target.value)} /></label>
      </div>
      <label className="block space-y-1 text-sm font-medium">Tratamiento / motivo<input className={fieldCls} value={reason} maxLength={500} placeholder="Ej: Control, Destartraje, Evaluación" onChange={event => setReason(event.target.value)} /></label>
    </div> : <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="col-span-2">{boxSelect(true)}</div>
      <label className="space-y-1 text-sm font-medium">Desde<input type="time" step={900} className={fieldCls} value={time} onChange={event => setTime(event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium">Hasta<input type="time" step={900} className={fieldCls} value={end} onChange={event => setEnd(event.target.value)} /></label>
      <label className="col-span-2 space-y-1 text-sm font-medium">Repetir
        <select className={fieldCls} value={repeat} onChange={event => setRepeat(event.target.value as typeof repeat)}><option value="none">Solo ese día</option><option value="weekly">Cada {WEEKDAY_SHORT[weekdayOf(draft.day)].toLowerCase()}</option><option value="daily">Todos los días</option></select>
      </label>
      {repeat !== "none" && <label className="col-span-2 space-y-1 text-sm font-medium">Hasta la fecha<input type="date" className={fieldCls} value={until} min={draft.day} onChange={event => setUntil(event.target.value)} /></label>}
      <label className="col-span-2 space-y-1 text-sm font-medium">Motivo<input className={fieldCls} value={blockReason} maxLength={120} placeholder="Ej: Almuerzo, Congreso, Mantención" onChange={event => setBlockReason(event.target.value)} /></label>
      <label className="col-span-2 space-y-1 text-sm font-medium">Observación<textarea className="min-h-20 w-full rounded-md border border-[#d9d5e4] p-2 text-base sm:text-sm" value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></label>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    <div className="mt-4 flex gap-2">
      <Button type="button" className={"min-h-11 flex-1 " + (tab === "cita" ? "bg-[#473a6d] hover:bg-[#3a2f5a]" : "bg-[#c62828] hover:bg-[#a51f1f]")} disabled={busy || (tab === "cita" && !(isNew ? newName.trim().length >= 3 : patient))} onClick={() => void save()}>{busy ? "Guardando…" : tab === "cita" ? "Agendar cita" : "Guardar bloqueo"}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button>
    </div>
  </Sheet>;
}
