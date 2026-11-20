"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Power, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignatureEditor } from "@/components/signature-editor";
import { PrestadorPanel } from "@/components/prestador-card";
import { PROFESSIONAL_COLORS, type Professional } from "@/lib/professionals";

export const PROFESSIONALS_CHANGED = "gd-professionals-changed";
type Editing = { id: number | null; name: string; specialty: string; rut: string; color: string };
const fieldCls = "h-11 w-full rounded-md border border-[#d9d5e4] bg-white px-2 text-base sm:h-9 sm:text-sm";

/** Configuración → «Profesionales»: los dentistas de la clínica (al comienzo solo el dueño). Se agregan, editan y desactivan. */
export function ProfessionalsPanel() {
  const [list, setList] = useState<Professional[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/profesionales", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ professionals: Professional[] }> : Promise.reject(new Error("pro")))
      .then(data => { if (live) setList(data.professionals); }).catch(() => { if (live) setError("No se pudieron cargar los profesionales."); });
    return () => { live = false; };
  }, []);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profesionales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { professionals?: Professional[]; error?: string };
      if (!response.ok || !data.professionals) throw new Error(data.error || "No se pudo guardar.");
      setList(data.professionals);
      window.dispatchEvent(new Event(PROFESSIONALS_CHANGED));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); return false; }
    finally { setBusy(false); }
  }
  const save = async () => {
    if (!editing) return;
    const fields = { name: editing.name, specialty: editing.specialty, rut: editing.rut, color: editing.color };
    if (await send(editing.id === null ? { action: "crear", ...fields } : { action: "guardar", id: editing.id, ...fields })) setEditing(null);
  };
  const visible = (list ?? []).filter(p => p.active || showInactive);
  const inactive = (list ?? []).filter(p => !p.active).length;

  return <section className="surface" aria-label="Profesionales de la clínica" data-testid="professionals-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Profesionales</h3><p className="mt-1 text-sm text-[#615f73]">Los dentistas que atienden. Cada horario de box y cada cita indica quién atiende; su color aparece en la agenda.</p></div>
      <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => { setError(""); setEditing({ id: null, name: "", specialty: "", rut: "", color: PROFESSIONAL_COLORS.find(c => !(list ?? []).some(p => p.color === c)) ?? PROFESSIONAL_COLORS[0] }); }}><Plus className="mr-1 size-4" />Agregar profesional</Button>
    </div>
    {editing && <div className="mt-3 grid gap-3 rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-3 sm:grid-cols-3" data-testid="professional-edit">
      <label className="space-y-1 text-sm font-medium sm:col-span-3">Nombre<input autoFocus className={fieldCls} maxLength={80} value={editing.name} placeholder="Dra. Camila Soto" onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label className="space-y-1 text-sm font-medium">Especialidad (opcional)<input className={fieldCls} maxLength={80} value={editing.specialty} placeholder="Endodoncia" onChange={e => setEditing({ ...editing, specialty: e.target.value })} /></label>
      <label className="space-y-1 text-sm font-medium">RUT (opcional)<input className={fieldCls} maxLength={14} value={editing.rut} placeholder="12.345.678-9" onChange={e => setEditing({ ...editing, rut: e.target.value })} /></label>
      <fieldset><legend className="text-sm font-medium">Color</legend>
        <div className="mt-1 flex flex-wrap gap-2">{PROFESSIONAL_COLORS.map(color => <button key={color} type="button" aria-label={`Color ${color}`} aria-pressed={editing.color === color} onClick={() => setEditing({ ...editing, color })} className={"size-9 rounded-full border-2 " + (editing.color === color ? "border-[#1f2430] ring-2 ring-offset-1" : "border-white")} style={{ background: color }} />)}</div>
      </fieldset>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy || editing.name.trim().length < 3} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    {list === null && !error && <p role="status" className="mt-4 text-sm text-[#6b6a7c]">Cargando profesionales…</p>}
    <ul className="mt-4 space-y-2">
      {visible.map(p => <li key={p.id} className={"flex items-center gap-3 rounded-xl border border-[#dddbe6] bg-white p-3 " + (p.active ? "" : "opacity-60")} data-testid="professional-row">
        <span className="grid size-10 shrink-0 place-items-center rounded-full text-white" style={{ background: p.color }}><Stethoscope className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{p.name}{p.isOwner && <span className="ml-2 rounded bg-[#efeef4] px-1.5 text-xs font-normal text-[#473a6d]">Principal</span>}{!p.active && <span className="ml-2 text-xs font-normal text-[#6b6a7c]">Inactivo</span>}</p>
          <p className="truncate text-xs text-[#615f73]">{[p.specialty, p.rut].filter(Boolean).join(" · ") || "Sin especialidad ni RUT"}</p>
        </div>
        <button type="button" aria-label={`Editar ${p.name}`} className="inline-flex items-center gap-1 rounded px-2 py-2 text-xs font-medium text-[#473a6d] hover:bg-[#efeef4]" disabled={busy} onClick={() => { setError(""); setEditing({ id: p.id, name: p.name, specialty: p.specialty, rut: p.rut, color: p.color }); }}><Pencil className="size-4" /><span>Editar</span></button>
        <button type="button" aria-label={p.active ? `Desactivar ${p.name}` : `Activar ${p.name}`} title={p.active ? "Desactivar" : "Activar"} className={"rounded p-2 hover:bg-[#efeef4] " + (p.active ? "text-[#a43542]" : "text-emerald-700")} disabled={busy} onClick={() => void send({ action: "guardar", id: p.id, active: !p.active })}><Power className="size-4" /></button>
        {!p.isOwner && <button type="button" aria-label={`Borrar ${p.name}`} title="Borrar (solo si nunca tuvo horarios ni citas)" className="rounded p-2 text-[#a43542] hover:bg-rose-50" disabled={busy} onClick={() => { if (window.confirm(`¿Borrar a ${p.name}? Solo se puede si nunca tuvo horarios ni citas; si no, desactívalo.`)) void send({ action: "borrar", id: p.id }); }}><Trash2 className="size-4" /></button>}
      </li>)}
    </ul>
    {inactive > 0 && <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-[#473a6d]" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />Mostrar inactivos ({inactive})</label>}
    <div className="mt-5 border-t border-[#e6e4ee] pt-4" data-testid="professional-signature">
      <p className="mb-2 text-sm text-[#615f73]">Tu identificación profesional: la firma que dibujes o subas aquí se pone sola en tus certificados, recetas, consentimientos y presupuestos. Cada dentista con su propia cuenta guarda la suya.</p>
      <SignatureEditor/>
    </div>
    <div className="mt-5 border-t border-[#e6e4ee] pt-4" data-testid="professional-habilitacion"><PrestadorPanel/></div>
  </section>;
}
