"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CalendarClock, MessageCircle, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chileTodayIso } from "@/lib/dictation/voice-command";
import { scrollBelowHeader } from "@/lib/scroll-below-header";
import { addDays, addMonths, CONTROL_STATUSES, controlBucket, controlMatches, DEFAULT_CONTROL_TIME, weekendName, whatsappLink, type ControlStatus } from "@/lib/next-control";
import { useSpaceRole } from "@/components/space-role";
import { isStaffRole } from "@/lib/role-policy";

export type ControlView = { id: number; patientId: number; dueOn: string; reason: string; note: string; status: ControlStatus; evolutionId: number | null; createdBy: string; createdAt: string; updatedAt: string; appointmentId?: number | null; appointmentTime?: string; patientName?: string; patientPhone?: string };
/** Resultado de escribir la cita del control: en Google Calendar, solo en la agenda de la app, o sin cita. */
export type ControlCalendarStatus = "ok" | "sin-conexion" | "solo-lectura" | "error" | "sin-cita";
export const CONTROLS_CHANGED = "gd-controls-changed";
export const AGENDA_CHANGED = "gd-agenda-changed";
/** Llegaron cambios desde Google Calendar (citas movidas o borradas allá): la agenda se recarga. */
export const AGENDA_SYNCED = "gd-agenda-synced";
export const announceControlsChanged = () => window.dispatchEvent(new Event(CONTROLS_CHANGED));

const longDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const STATUS_STYLE: Record<ControlStatus, string> = {
  pendiente: "bg-amber-50 text-amber-900 border-amber-200", contactado: "bg-sky-50 text-sky-900 border-sky-200", agendado: "bg-[#efeef4] text-[#3a2f5a] border-[#cfc9e3]",
  realizado: "bg-emerald-50 text-emerald-800 border-emerald-200", descartado: "bg-slate-100 text-slate-600 border-slate-200",
};
const isOpen = (status: ControlStatus) => status !== "realizado" && status !== "descartado";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo guardar el control.");
  return data;
}
/** Guarda el control; el servidor lo agenda solo (cita en la agenda y, si hay permiso, en Google Calendar). */
export const scheduleNewControl = (body: { patientId: number; dueOn: string; reason: string; note?: string; evolutionId?: number | null; time?: string }) =>
  call<{ control: ControlView; calendar?: ControlCalendarStatus }>("/api/controles", { method: "POST", body: JSON.stringify(body) }).then(data => { announceControlsChanged(); return { control: data.control, calendar: data.calendar ?? "sin-cita" as ControlCalendarStatus }; });
export const saveControl = (body: { patientId: number; dueOn: string; reason: string; note?: string; evolutionId?: number | null; time?: string }) => scheduleNewControl(body).then(data => data.control);
const patchControl = (body: { id: number; status?: ControlStatus; note?: string; dueOn?: string; time?: string }) =>
  call<{ control: ControlView; calendar?: ControlCalendarStatus }>("/api/controles", { method: "PATCH", body: JSON.stringify(body) }).then(data => { announceControlsChanged(); return data; });

export const CONNECT_CALENDAR_WRITE_URL = "/api/drive/connect?calendar=1";
/** Aviso ámbar cuando la fecha del control cae en fin de semana (la fecha se respeta). */
export function WeekendHint({ day, className = "" }: { day: string; className?: string }) {
  const name = weekendName(day);
  return name ? <span className={`inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ${className}`} data-testid="control-weekend">cae {name}</span> : null;
}
/** Qué pasó con la cita del control en la agenda y en Google Calendar; si falta permiso, ofrece reconectar. */
export function ControlCalendarNotice({ status, onClose }: { status: ControlCalendarStatus; onClose?: () => void }) {
  // Conectar Google Calendar es configuración del dueño: el personal (Recepción / Asistente) no ve el botón.
  const staff = isStaffRole(useSpaceRole());
  if (status === "sin-cita") return null;
  const tone = status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900";
  const text = status === "ok" ? "Control agendado en la agenda y en Google Calendar."
    : status === "solo-lectura" ? "Control agendado en la agenda de la app. Tu Google Calendar está conectado solo para lectura, así que no se escribió allá."
    : status === "sin-conexion" ? "Control agendado en la agenda de la app (no hay Google Calendar conectado)."
    : "Control agendado en la agenda de la app; no se pudo escribir en Google Calendar.";
  return <div role="status" className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs ${tone}`} data-testid="control-calendar-notice">
    <span className="min-w-0 flex-1">{text}</span>
    {!staff && (status === "solo-lectura" || status === "sin-conexion") && <a href={CONNECT_CALENDAR_WRITE_URL} className="inline-flex min-h-9 items-center rounded-lg bg-[#473a6d] px-3 font-semibold text-white" data-testid="connect-calendar-write">Conectar Google Calendar para escribir controles</a>}
    {onClose && <button type="button" onClick={onClose} className="min-h-9 px-2 underline">Cerrar</button>}
  </div>;
}

/** Lee los controles (del espacio o de un paciente) y se actualiza cuando otro componente guarda uno. */
export function useControls(patientId?: number) {
  const [state, setState] = useState<{ key: string; controls: ControlView[]; error: string } | null>(null);
  const key = String(patientId ?? "all");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(patientId ? `/api/controles?patientId=${patientId}` : "/api/controles", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ controls: ControlView[]; agendaSynced?: number }>; })
      .then(data => { if (active) setState({ key, controls: data.controls, error: "" }); if (data.agendaSynced) window.dispatchEvent(new Event(AGENDA_SYNCED)); })
      .catch(() => { if (active && !controller.signal.aborted) setState(previous => ({ key, controls: previous?.key === key ? previous.controls : [], error: "No se pudieron leer los controles." })); });
    return () => { active = false; controller.abort(); };
  }, [patientId, key, tick]);
  useEffect(() => {
    const refresh = () => setTick(value => value + 1);
    window.addEventListener(CONTROLS_CHANGED, refresh);
    // Si se mueve o borra la cita de un control en la agenda, el control cambia en el servidor.
    window.addEventListener(AGENDA_CHANGED, refresh);
    return () => { window.removeEventListener(CONTROLS_CHANGED, refresh); window.removeEventListener(AGENDA_CHANGED, refresh); };
  }, []);
  const current = state?.key === key ? state : null;
  return { controls: current?.controls ?? null, error: current?.error ?? "", refresh: useCallback(() => setTick(value => value + 1), []) };
}

/** Formulario corto para programar un control: atajos (+2 semanas … +1 año), motivo y nota. */
export function ScheduleControlForm({ patientId, evolutions = [], defaultEvolutionId, onDone, onCancel }: {
  patientId: number;
  evolutions?: Array<{ id: number; title: string; date: string }>;
  defaultEvolutionId?: number | null;
  onDone?: (control: ControlView, calendar: ControlCalendarStatus) => void;
  onCancel?: () => void;
}) {
  const today = chileTodayIso();
  const [dueOn, setDueOn] = useState(addMonths(today, 6));
  const [reason, setReason] = useState("Control");
  const [time, setTime] = useState(DEFAULT_CONTROL_TIME);
  const [note, setNote] = useState("");
  const [evolutionId, setEvolutionId] = useState<number | null>(defaultEvolutionId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shortcuts: Array<[string, string]> = [["2 semanas", addDays(today, 14)], ["1 mes", addMonths(today, 1)], ["3 meses", addMonths(today, 3)], ["6 meses", addMonths(today, 6)], ["1 año", addMonths(today, 12)]];
  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) { setError("Elige la fecha del control."); return; }
    setBusy(true); setError("");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError("Elige la hora de la cita."); return; }
    try { const saved = await scheduleNewControl({ patientId, dueOn, reason: reason.trim() || "Control", note, evolutionId, time }); onDone?.(saved.control, saved.calendar); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el control."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-xl border border-[#dddbe6] bg-[#faf9fc] p-3 text-sm" data-testid="schedule-control-form">
    <div className="flex flex-wrap gap-1.5">{shortcuts.map(([label, day]) => <button key={label} type="button" onClick={() => setDueOn(day)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${dueOn === day ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#dddbe6] bg-white text-[#3a2f5a]"}`}>En {label}</button>)}</div>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="space-y-1"><span className="text-xs font-semibold text-[#6b6a7c]">Fecha</span><input type="date" min={today} value={dueOn} onChange={event => setDueOn(event.target.value)} className="h-10 w-full rounded-md border border-[#dddbe6] bg-white px-2 text-base sm:text-sm" data-testid="control-date"/><WeekendHint day={dueOn}/></label>
      <label className="space-y-1"><span className="text-xs font-semibold text-[#6b6a7c]">Hora en la agenda</span><input type="time" step={300} value={time} onChange={event => setTime(event.target.value)} className="h-10 w-full rounded-md border border-[#dddbe6] bg-white px-2 text-base sm:text-sm" data-testid="control-time"/></label>
      <label className="space-y-1"><span className="text-xs font-semibold text-[#6b6a7c]">Motivo</span><input value={reason} maxLength={140} onChange={event => setReason(event.target.value)} className="h-10 w-full rounded-md border border-[#dddbe6] bg-white px-2 text-base sm:text-sm" data-testid="control-reason"/></label>
    </div>
    {evolutions.length > 0 && <label className="block space-y-1"><span className="text-xs font-semibold text-[#6b6a7c]">Desde la evolución</span><select value={evolutionId ?? ""} onChange={event => setEvolutionId(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-md border border-[#dddbe6] bg-white px-2 text-base sm:text-sm"><option value="">Sin vincular</option>{evolutions.slice(0, 15).map(evolution => <option key={evolution.id} value={evolution.id}>{evolution.date} · {evolution.title.slice(0, 60)}</option>)}</select></label>}
    <label className="block space-y-1"><span className="text-xs font-semibold text-[#6b6a7c]">Nota</span><textarea value={note} maxLength={600} onChange={event => setNote(event.target.value)} className="min-h-14 w-full rounded-md border border-[#dddbe6] bg-white p-2 text-base sm:text-sm" placeholder="Ej. Revisar cicatrización y sondaje del 3.6"/></label>
    <p className="text-xs text-[#6b6a7c]">Se agenda solo: queda como cita de 30 min en la agenda (y en Google Calendar si diste permiso para escribir).</p>
    {error && <p role="alert" className="text-xs text-rose-800">{error}</p>}
    <div className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void submit()} data-testid="control-save">Guardar y agendar control</Button>{onCancel && <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>}</div>
  </div>;
}

/** En la cabecera de la ficha: el próximo control abierto y un botón para programar otro. */
export function PatientNextControl({ patientId, evolutions }: { patientId: number; evolutions: Array<{ id: number; title: string; date: string }> }) {
  const { controls } = useControls(patientId);
  const [formFor, setFormFor] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ patientId: number; status: ControlCalendarStatus } | null>(null);
  const showForm = formFor === patientId;
  const next = (controls ?? []).filter(control => isOpen(control.status)).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const overdue = next ? controlBucket(next.dueOn, chileTodayIso()) === "vencido" : false;
  return <div className="mt-4 space-y-2 border-t border-[#ebeaf1] pt-4" data-testid="patient-next-control">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex min-w-0 items-center gap-2 text-sm"><CalendarClock className={`size-4 shrink-0 ${overdue ? "text-rose-700" : "text-[#473a6d]"}`}/>
        <span className="text-xs font-medium uppercase tracking-wide text-[#8b8ca3]">Próximo control</span>
        {controls === null ? <span className="text-[#6b6a7c]">…</span> : next
          ? <span className={`font-semibold ${overdue ? "text-rose-800" : "text-[#26243a]"}`}>{longDate(next.dueOn)}{next.appointmentTime ? ` ${next.appointmentTime}` : ""} · {next.reason}{overdue ? " (vencido)" : ""} <WeekendHint day={next.dueOn} className="ml-1"/> <span className={`ml-1 rounded-full border px-1.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[next.status]}`}>{next.status}</span></span>
          : <span className="text-[#6b6a7c]">Sin control programado</span>}
      </p>
      {!showForm && <Button type="button" size="sm" variant="outline" onClick={() => setFormFor(patientId)} data-testid="schedule-control"><Plus className="mr-1 size-4"/>Programar control</Button>}
    </div>
    {showForm && <ScheduleControlForm patientId={patientId} evolutions={evolutions} defaultEvolutionId={evolutions[0]?.id ?? null} onDone={(_, status) => { setFormFor(null); setNotice({ patientId, status }); }} onCancel={() => setFormFor(null)}/>}
    {notice?.patientId === patientId && <ControlCalendarNotice status={notice.status} onClose={() => setNotice(null)}/>}
  </div>;
}

type Filter = "vencidos" | "semana" | "mes" | "todos";
const FILTERS: Array<[Filter, string]> = [["vencidos", "Vencidos"], ["semana", "Esta semana"], ["mes", "Este mes"], ["todos", "Todos"]];

/** Inicio: resumen de controles vencidos y de esta semana, con acceso a la lista. */
export function ControlsHomeCard({ onOpen }: { onOpen: () => void }) {
  const { controls } = useControls();
  const today = chileTodayIso();
  if (!controls) return null;
  const overdue = controls.filter(control => controlMatches("vencidos", control, today)).length;
  const week = controls.filter(control => isOpen(control.status) && controlMatches("semana", control, today)).length;
  if (!overdue && !week) return null;
  return <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-[#cfc9e3] bg-[#f6f5fa] p-4 text-left" data-testid="controls-home-card">
    <span className="flex items-center gap-3"><BellRing className="size-5 text-[#473a6d]"/><span><strong className="block text-[#26243a]">Próximos controles</strong><span className="text-sm text-[#615f73]">{overdue ? `${overdue} vencido${overdue === 1 ? "" : "s"}` : ""}{overdue && week ? " · " : ""}{week ? `${week} esta semana` : ""}</span></span></span>
    <span className="text-sm font-semibold text-[#473a6d] underline">Ver lista</span>
  </button>;
}

/** Lista «Próximos controles» (como en Dentalsoft): filtros, estado, última nota y contacto por teléfono o WhatsApp. */
/** Control nuevo abierto desde el riel de una evolución: paciente y evolución ya elegidos. */
export type ControlStart = { patientId: number; patientName: string; evolutions: Array<{ id: number; title: string; date: string }>; evolutionId: number | null; nonce: number };

export function NextControlsPanel({ onOpenPatient, clinicName, start }: { onOpenPatient: (patientId: number) => void; clinicName?: string; start?: ControlStart | null }) {
  const { controls, error } = useControls();
  const [filter, setFilter] = useState<Filter>(start ? "todos" : "vencidos");
  const [startOpen, setStartOpen] = useState(Boolean(start));
  const startRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (!start) return; const timer = window.setTimeout(() => scrollBelowHeader(startRef.current), 80); return () => window.clearTimeout(timer); }, [start]);
  const [showClosed, setShowClosed] = useState(false);
  const [noteFor, setNoteFor] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<ControlCalendarStatus | null>(null);
  const today = chileTodayIso();
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, (controls ?? []).filter(control => (showClosed || isOpen(control.status) || key === "vencidos") && controlMatches(key, control, today)).length])) as Record<Filter, number>, [controls, showClosed, today]);
  const list = (controls ?? []).filter(control => controlMatches(filter, control, today) && (showClosed || isOpen(control.status)));
  const update = async (id: number, patch: { status?: ControlStatus; note?: string }) => {
    setBusy(id); setActionError("");
    try { const saved = await patchControl({ id, ...patch }); setNoteFor(null); if (patch.status === "agendado" && saved.calendar) setNotice(saved.calendar); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "No se pudo guardar."); } finally { setBusy(null); }
  };
  return <div className="surface space-y-4" data-testid="next-controls-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Próximos controles</h2><p className="mt-1 text-sm text-[#615f73]">Pacientes a citar a control. Llama o escribe por WhatsApp (se abre el chat; no se envía nada solo) y deja la nota del contacto.</p></div>
      <label className="flex items-center gap-2 text-sm text-[#615f73]"><input type="checkbox" checked={showClosed} onChange={event => setShowClosed(event.target.checked)} className="size-4"/>Mostrar realizados y descartados</label>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar controles">
      {FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${filter === key ? (key === "vencidos" ? "border-rose-700 bg-rose-700 text-white" : "border-[#473a6d] bg-[#473a6d] text-white") : "border-[#dddbe6] bg-white text-[#3a2f5a]"}`} data-testid={`controls-filter-${key}`}>{label} <span className="font-normal">({counts[key]})</span></button>)}
    </div>
    {start && startOpen && <section ref={startRef} className="rounded-xl border-2 border-[#473a6d] bg-[#faf9fc] p-3" data-testid="control-new">
      <h3 className="text-base font-semibold text-[#2c2640]">Nuevo control · <span data-testid="control-new-patient">{start.patientName}</span></h3>
      <p className="mb-2 text-sm text-[#615f73]">Desde la evolución de la ficha. Elige la fecha y guarda.</p>
      <ScheduleControlForm patientId={start.patientId} evolutions={start.evolutions} defaultEvolutionId={start.evolutionId} onDone={(_, calendar) => { setStartOpen(false); setNotice(calendar); }} onCancel={() => setStartOpen(false)}/>
    </section>}
    {notice && <ControlCalendarNotice status={notice} onClose={() => setNotice(null)}/>}
    {(error || actionError) && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900">{actionError || error}</p>}
    {controls === null ? <p role="status" className="text-sm text-[#6b6a7c]">Cargando controles…</p>
      : list.length === 0 ? <p className="rounded-lg border border-dashed border-[#dddbe6] p-4 text-sm text-[#6b6a7c]">No hay controles {filter === "vencidos" ? "vencidos" : filter === "semana" ? "para esta semana" : filter === "mes" ? "para este mes" : "registrados"}.</p>
      : <ul className="space-y-2">{list.map(control => {
        const bucket = controlBucket(control.dueOn, today);
        const phone = control.patientPhone ?? "";
        const first = (control.patientName ?? "").split(/\s+/)[0] ?? "";
        const wa = phone ? whatsappLink(phone, `Hola ${first}, te escribimos${clinicName ? ` de ${clinicName}` : ""} para agendar tu ${control.reason.toLowerCase().startsWith("control") ? control.reason.toLowerCase() : `control (${control.reason})`}. ¿Qué día te acomoda?`) : null;
        return <li key={control.id} className="rounded-xl border border-[#e6e4ee] bg-white p-3" data-testid={`control-row-${control.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2"><button type="button" className="font-semibold text-[#473a6d] underline" onClick={() => onOpenPatient(control.patientId)}>{control.patientName}</button><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[control.status]}`}>{CONTROL_STATUSES.find(status => status.key === control.status)?.label}</span></p>
              <p className={`mt-0.5 text-sm ${bucket === "vencido" && isOpen(control.status) ? "font-semibold text-rose-800" : "text-[#35343f]"}`}>{longDate(control.dueOn)}{control.appointmentTime ? ` ${control.appointmentTime}` : ""} · {control.reason}{bucket === "vencido" && isOpen(control.status) ? " · vencido" : ""} {isOpen(control.status) && <WeekendHint day={control.dueOn}/>}</p>
              {isOpen(control.status) && control.appointmentId ? <p className="mt-0.5 text-[11px] text-[#473a6d]">En la agenda</p> : null}
              {control.note && <p className="mt-1 text-xs text-[#615f73]">Última nota: {control.note}</p>}
              {control.createdBy && <p className="mt-0.5 text-[11px] text-[#8b8ca3]">Creado por {control.createdBy}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#dddbe6] px-2.5 text-sm text-[#3a2f5a]" aria-label={`Llamar a ${control.patientName}`}><Phone className="size-4"/>Llamar</a> : <span className="text-xs text-[#8b8ca3]">Sin teléfono</span>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-300 px-2.5 text-sm text-emerald-800" aria-label={`Abrir WhatsApp con ${control.patientName}`}><MessageCircle className="size-4"/>WhatsApp</a>}
              <select aria-label={`Estado del control de ${control.patientName}`} value={control.status} disabled={busy === control.id} onChange={event => void update(control.id, { status: event.target.value as ControlStatus })} className="h-9 rounded-lg border border-[#dddbe6] bg-white px-2 text-base sm:text-sm">{CONTROL_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}</select>
              <Button type="button" size="sm" variant="outline" onClick={() => setNoteFor({ id: control.id, text: control.note })}>Nota</Button>
            </div>
          </div>
          {noteFor?.id === control.id && <div className="mt-2 flex flex-col gap-2 sm:flex-row"><textarea aria-label="Nota del contacto" maxLength={600} value={noteFor.text} onChange={event => setNoteFor({ id: control.id, text: event.target.value })} className="min-h-14 flex-1 rounded-md border border-[#dddbe6] p-2 text-base sm:text-sm" placeholder="Ej. No contesta; volver a llamar el lunes"/><div className="flex gap-2 sm:flex-col"><Button type="button" size="sm" disabled={busy === control.id} onClick={() => void update(control.id, { note: noteFor.text })}>Guardar nota</Button><Button type="button" size="sm" variant="outline" onClick={() => setNoteFor(null)}>Cancelar</Button></div></div>}
        </li>;
      })}</ul>}
  </div>;
}
