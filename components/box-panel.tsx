"use client";

import { useEffect, useState } from "react";
import { Clock, DoorOpen, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOX_COLORS, BOX_KINDS, BOX_KIND_LABEL, DURATIONS, WEEKDAY_SHORT, type BoxKind, type BoxSchedule } from "@/lib/agenda-box";

type Box = { id: number; name: string; enabled: boolean; kind?: BoxKind; color?: string | null };
type Editing = { id: number | null; name: string; kind: BoxKind; color: string | null };
type ScheduleDraft = { id?: number; boxId: number; professional: string; weekdays: number[]; start: string; end: string; validFrom: string; validTo: string; blockMinutes: number };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const fieldCls = "h-11 w-full rounded-md border border-[#d9d5e4] bg-white px-2 text-base sm:h-9 sm:text-sm";

/** Configuración → «Box»: box (sillón, pabellón o sede) con tipo y color, y sus horarios de atención (generan los cupos libres de la agenda por box). */
export function BoxPanel() {
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [schedules, setSchedules] = useState<BoxSchedule[]>([]);
  const [professional, setProfessional] = useState("");
  const [hideDisabled, setHideDisabled] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/box", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ boxes: Box[] }> : Promise.reject(new Error("box")))
      .then(data => { if (live) setBoxes(data.boxes); }).catch(() => { if (live) setError("No se pudieron cargar los box."); });
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/agenda-box?from=${today}&to=${today}`, { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ schedules: BoxSchedule[]; professional: string }> : Promise.reject(new Error("horarios")))
      .then(data => { if (live) { setSchedules(data.schedules); setProfessional(data.professional); } }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/box", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { boxes?: Box[]; error?: string };
      if (!response.ok || !data.boxes) throw new Error(data.error || "No se pudo guardar.");
      setBoxes(data.boxes);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); return false; }
    finally { setBusy(false); }
  }
  async function sendSchedule(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agenda-box", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { schedules?: BoxSchedule[]; error?: string };
      if (!response.ok || !data.schedules) throw new Error(data.error || "No se pudo guardar el horario.");
      setSchedules(data.schedules);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el horario."); return false; }
    finally { setBusy(false); }
  }

  const visible = (boxes ?? []).filter(box => box.enabled || !hideDisabled);
  const save = async () => {
    if (!editing) return;
    const ok = await send(editing.id === null ? { action: "crear", name: editing.name, kind: editing.kind, color: editing.color } : { action: "guardar", id: editing.id, name: editing.name, kind: editing.kind, color: editing.color });
    if (ok) setEditing(null);
  };
  const saveDraft = async () => {
    if (!draft) return;
    if (await sendSchedule({ action: "horario", ...draft, validFrom: draft.validFrom || null, validTo: draft.validTo || null })) setDraft(null);
  };
  const newDraft = (boxId: number): ScheduleDraft => ({ boxId, professional, weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "19:00", validFrom: "", validTo: "", blockMinutes: 30 });

  return <section className="surface" aria-label="Box de la clínica" data-testid="box-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Box</h3><p className="mt-1 text-sm text-[#615f73]">Gestiona los box de tu clínica y sus horarios. Los horarios crean los cupos libres de la agenda «Día por box».</p></div>
      <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => { setError(""); setEditing({ id: null, name: "", kind: "odontologia", color: null }); }}><Plus className="mr-1 size-4" />Agregar box</Button>
    </div>
    <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" className="size-4 accent-[#473a6d]" checked={hideDisabled} onChange={event => setHideDisabled(event.target.checked)} />Ocultar deshabilitados
    </label>
    {editing && <div className="mt-3 grid gap-3 rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-3 sm:grid-cols-[1fr_auto]" data-testid="box-edit">
      <label className="min-w-0 space-y-1 text-sm font-medium">{editing.id === null ? "Nombre del nuevo box" : "Nombre del box"}
        <Input autoFocus value={editing.name} maxLength={60} placeholder="Box 3" className="text-base sm:text-sm" onChange={event => setEditing({ ...editing, name: event.target.value })} onKeyDown={event => { if (event.key === "Enter") void save(); }} />
      </label>
      <label className="space-y-1 text-sm font-medium">Tipo
        <select className={fieldCls} value={editing.kind} onChange={event => setEditing({ ...editing, kind: event.target.value as BoxKind })}>{BOX_KINDS.map(kind => <option key={kind} value={kind}>{BOX_KIND_LABEL[kind]}</option>)}</select>
      </label>
      <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Color</legend>
        <div className="mt-1 flex flex-wrap gap-2">{BOX_COLORS.map(color => <button key={color} type="button" aria-label={`Color ${color}`} aria-pressed={editing.color === color} onClick={() => setEditing({ ...editing, color })} className={"size-9 rounded-full border-2 " + (editing.color === color ? "border-[#1f2430] ring-2 ring-offset-1" : "border-white")} style={{ background: color }} />)}</div>
      </fieldset>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy || !editing.name.trim()} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    {boxes === null && !error && <p role="status" className="mt-4 text-sm text-[#6b6a7c]">Cargando box…</p>}
    <ul className="mt-4 space-y-2">
      {visible.map(box => {
        const own = schedules.filter(s => s.boxId === box.id);
        return <li key={box.id} className={"rounded-xl border border-[#dddbe6] bg-white p-3 " + (box.enabled ? "" : "opacity-60")}>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ background: box.color || "#473a6d" }}><DoorOpen className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{box.name}{!box.enabled && <span className="ml-2 text-xs font-normal text-[#6b6a7c]">Deshabilitado</span>}</p>
              <p className="flex items-center gap-1 text-xs text-[#615f73]"><Users className="size-3.5" aria-hidden="true" />{BOX_KIND_LABEL[box.kind ?? "odontologia"]} · Todos los usuarios</p></div>
            <button type="button" aria-label={`Editar nombre de ${box.name}`} title="Editar nombre" className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-2 text-xs font-medium text-[#473a6d] hover:bg-[#efeef4]" disabled={busy} onClick={() => { setError(""); setEditing({ id: box.id, name: box.name, kind: box.kind ?? "odontologia", color: box.color ?? null }); }}><Pencil className="size-4" /><span>Editar</span></button>
            <button type="button" aria-label={box.enabled ? `Deshabilitar ${box.name}` : `Habilitar ${box.name}`} className={"rounded p-2 hover:bg-[#efeef4] " + (box.enabled ? "text-[#a43542]" : "text-emerald-700")} disabled={busy} onClick={() => void send({ action: "guardar", id: box.id, enabled: !box.enabled })}><Power className="size-4" /></button>
          </div>
          <div className="mt-2 border-t border-[#efeef4] pt-2" data-testid="box-horarios">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#615f73]"><Clock className="size-3.5" aria-hidden="true" />Horarios</p>
            {!own.length && <p className="mt-1 text-xs text-[#6b6a7c]">Sin horarios: en la agenda igual puedes tocar cualquier hora para agendar.</p>}
            <ul className="mt-1 space-y-1">{own.map(s => <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{WEEK_ORDER.filter(d => s.weekdays.includes(d)).map(d => WEEKDAY_SHORT[d]).join(" ")}</span>
              <span>{s.start}–{s.end}</span><span className="text-[#615f73]">cada {s.blockMinutes} min · {s.professional}</span>
              {(s.validFrom || s.validTo) && <span className="text-xs text-[#6b6a7c]">{s.validFrom ? `desde ${s.validFrom.split("-").reverse().join("-")}` : ""} {s.validTo ? `hasta ${s.validTo.split("-").reverse().join("-")}` : ""}</span>}
              <button type="button" className="ml-auto rounded p-2 text-[#473a6d] hover:bg-[#efeef4]" aria-label="Editar horario" disabled={busy} onClick={() => setDraft({ id: s.id, boxId: s.boxId, professional: s.professional, weekdays: s.weekdays, start: s.start, end: s.end, validFrom: s.validFrom ?? "", validTo: s.validTo ?? "", blockMinutes: s.blockMinutes })}><Pencil className="size-4" /></button>
              <button type="button" className="rounded p-2 text-[#a43542] hover:bg-rose-50" aria-label="Quitar horario" disabled={busy} onClick={() => { if (window.confirm("¿Quitar este horario? Las citas ya agendadas no cambian.")) void sendSchedule({ action: "borrarHorario", id: s.id }); }}><Trash2 className="size-4" /></button>
            </li>)}</ul>
            {draft && draft.boxId === box.id ? <div className="mt-2 grid gap-2 rounded-lg bg-[#f7f6fa] p-3 sm:grid-cols-2" data-testid="horario-form">
              <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Días</legend>
                <div className="mt-1 flex flex-wrap gap-1">{WEEK_ORDER.map(d => { const on = draft.weekdays.includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter(x => x !== d) : [...draft.weekdays, d] })} className={"min-h-11 min-w-11 rounded-lg border px-2 text-sm font-medium " + (on ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d9d5e4] bg-white")}>{WEEKDAY_SHORT[d]}</button>; })}</div>
              </fieldset>
              <label className="space-y-1 text-sm font-medium">Desde las<input type="time" step={900} className={fieldCls} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
              <label className="space-y-1 text-sm font-medium">Hasta las<input type="time" step={900} className={fieldCls} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
              <label className="space-y-1 text-sm font-medium">Largo de cada cupo<select className={fieldCls} value={draft.blockMinutes} onChange={e => setDraft({ ...draft, blockMinutes: Number(e.target.value) })}>{DURATIONS.slice(0, 8).map(m => <option key={m} value={m}>{m} min</option>)}</select></label>
              <label className="space-y-1 text-sm font-medium">Profesional<input className={fieldCls} maxLength={80} value={draft.professional} onChange={e => setDraft({ ...draft, professional: e.target.value })} /></label>
              <label className="space-y-1 text-sm font-medium">Vigente desde (opcional)<input type="date" className={fieldCls} value={draft.validFrom} onChange={e => setDraft({ ...draft, validFrom: e.target.value })} /></label>
              <label className="space-y-1 text-sm font-medium">Vigente hasta (opcional)<input type="date" className={fieldCls} value={draft.validTo} onChange={e => setDraft({ ...draft, validTo: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-2"><Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy || !draft.weekdays.length} onClick={() => void saveDraft()}>{busy ? "Guardando…" : "Guardar horario"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancelar</Button></div>
            </div> : box.enabled && <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm font-medium text-[#473a6d] hover:bg-[#efeef4]" disabled={busy} onClick={() => { setError(""); setDraft(newDraft(box.id)); }}><Plus className="size-4" />Agregar horario</button>}
          </div>
        </li>;
      })}
      {boxes !== null && !visible.length && <li className="rounded-xl border border-dashed border-[#dddbe6] p-4 text-center text-sm text-[#6b6a7c]">No hay box para mostrar.</li>}
    </ul>
  </section>;
}
