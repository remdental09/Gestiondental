"use client";

import { useEffect, useState } from "react";
import { DoorOpen, Pencil, Plus, Power, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Box = { id: number; name: string; enabled: boolean };

/** Configuración → «Box»: los box (sillones o sedes) de la clínica; se pueden agregar, renombrar y deshabilitar. */
export function BoxPanel() {
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [hideDisabled, setHideDisabled] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/box", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ boxes: Box[] }> : Promise.reject(new Error("box")))
      .then(data => { if (live) setBoxes(data.boxes); }).catch(() => { if (live) setError("No se pudieron cargar los box."); });
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

  const visible = (boxes ?? []).filter(box => box.enabled || !hideDisabled);
  const save = async () => {
    if (!editing) return;
    const ok = await send(editing.id === null ? { action: "crear", name: editing.name } : { action: "guardar", id: editing.id, name: editing.name });
    if (ok) setEditing(null);
  };

  return <section className="surface" aria-label="Box de la clínica" data-testid="box-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Box</h3><p className="mt-1 text-sm text-[#615f73]">Gestiona los box disponibles en tu clínica.</p></div>
      <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => { setError(""); setEditing({ id: null, name: "" }); }}><Plus className="mr-1 size-4" />Agregar box</Button>
    </div>
    <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" className="size-4 accent-[#473a6d]" checked={hideDisabled} onChange={event => setHideDisabled(event.target.checked)} />Ocultar deshabilitados
    </label>
    {editing && <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-3">
      <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">{editing.id === null ? "Nombre del nuevo box" : "Nombre del box"}
        <Input autoFocus value={editing.name} maxLength={60} placeholder="Box 3" onChange={event => setEditing({ ...editing, name: event.target.value })} onKeyDown={event => { if (event.key === "Enter") void save(); }} />
      </label>
      <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy || !editing.name.trim()} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{error}</p>}
    {boxes === null && !error && <p role="status" className="mt-4 text-sm text-[#6b6a7c]">Cargando box…</p>}
    <ul className="mt-4 space-y-2">
      {visible.map(box => <li key={box.id} className={"flex items-center gap-3 rounded-xl border border-[#dddbe6] bg-white p-3 " + (box.enabled ? "" : "opacity-60")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#efeef4] text-[#473a6d]"><DoorOpen className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{box.name}{!box.enabled && <span className="ml-2 text-xs font-normal text-[#6b6a7c]">Deshabilitado</span>}</p>
          <p className="flex items-center gap-1 text-xs text-[#615f73]"><Users className="size-3.5" aria-hidden="true" />Todos los usuarios</p></div>
        <button type="button" aria-label={`Editar nombre de ${box.name}`} title="Editar nombre" className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-2 text-xs font-medium text-[#473a6d] hover:bg-[#efeef4]" disabled={busy} onClick={() => { setError(""); setEditing({ id: box.id, name: box.name }); }}><Pencil className="size-4" /><span>Editar nombre</span></button>
        <button type="button" aria-label={box.enabled ? `Deshabilitar ${box.name}` : `Habilitar ${box.name}`} className={"rounded p-2 hover:bg-[#efeef4] " + (box.enabled ? "text-[#a43542]" : "text-emerald-700")} disabled={busy} onClick={() => void send({ action: "guardar", id: box.id, enabled: !box.enabled })}><Power className="size-4" /></button>
      </li>)}
      {boxes !== null && !visible.length && <li className="rounded-xl border border-dashed border-[#dddbe6] p-4 text-center text-sm text-[#6b6a7c]">No hay box para mostrar.</li>}
    </ul>
  </section>;
}
