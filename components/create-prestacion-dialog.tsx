"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { PRESTACION_SPECIALTIES, MAX_CREATE_AT_ONCE, variantName, type CustomPrestacion } from "@/lib/custom-prestaciones";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-[#d3cbe8] bg-white px-3 text-base text-[#1f1b3a] focus-visible:outline-2 focus-visible:outline-[#6a3fc8]";
const NONE = "", OWN = "__own";

/** «Crear prestación»: una prestación propia, o una familia de variantes (1–5 caras, 1–4 conductos…) cada una con su precio. */
export function CreatePrestacionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (items: CustomPrestacion[], created: number) => void }) {
  const [specialty, setSpecialty] = useState("");
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState(NONE);
  const [ownText, setOwnText] = useState("");
  const [single, setSingle] = useState("");
  const [rows, setRows] = useState<Record<string, { on: boolean; price: string }>>({});
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const spec = PRESTACION_SPECIALTIES.find(item => item.key === specialty);
  const options = useMemo(() => {
    if (dimension === OWN) return [...new Set(ownText.split(/[,\n;]/).map(part => part.trim()).filter(Boolean))].slice(0, MAX_CREATE_AT_ONCE);
    return spec?.dimensions.find(item => item.id === dimension)?.options ?? [];
  }, [dimension, ownText, spec]);
  const chosen = options.filter(option => rows[option]?.on !== false);
  const total = dimension === NONE ? 1 : chosen.length;
  const setRow = (option: string, patch: Partial<{ on: boolean; price: string }>) => setRows(previous => ({ ...previous, [option]: { ...(previous[option] ?? { on: true, price: "" }), ...patch } }));
  const dirty = !!(name.trim() || single || ownText || Object.values(rows).some(row => row.price));
  const close = () => { if (!dirty || window.confirm("¿Cerrar sin crear la prestación? Se perderá lo escrito.")) onClose(); };

  const submit = async () => {
    setError("");
    if (!spec) return setError("Elige una especialidad.");
    if (name.trim().length < 3) return setError("Escribe el nombre de la prestación (mínimo 3 letras).");
    if (dimension !== NONE && chosen.length === 0) return setError("Marca al menos una variante.");
    const items = dimension === NONE ? [{ name: name.trim(), price: single }] : chosen.map(option => ({ name: variantName(name, option), price: rows[option]?.price ?? "" }));
    setSaving(true);
    try {
      const response = await fetch("/api/aranceles/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specialty, items }) });
      const result = await response.json() as { error?: string; items?: CustomPrestacion[]; created?: number };
      if (!response.ok) throw new Error(result.error || "No se pudo crear la prestación.");
      onCreated(result.items ?? [], result.created ?? 0);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo crear la prestación."); }
    finally { setSaving(false); }
  };

  return <div role="dialog" aria-modal="true" aria-labelledby="crear-prestacion-titulo" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1b1245]/70 p-4 sm:items-center" data-testid="create-prestacion-dialog">
    <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="crear-prestacion-titulo" className="text-xl font-semibold text-[#1f1b3a]">Crear prestación</h2><p className="mt-1 text-sm text-[#625e82]">Para lo que no está en el catálogo. Queda solo en tu cuenta y se ofrece al armar presupuestos.</p></div>
        <button type="button" aria-label="Cerrar" onClick={close} className="rounded p-1 text-[#4f4a74] hover:bg-[#f3effd]"><X className="size-5"/></button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Especialidad
          <select className={field} value={specialty} onChange={event => { setSpecialty(event.target.value); setDimension(NONE); setRows({}); }} data-testid="cp-specialty">
            <option value="">Elige…</option>
            {PRESTACION_SPECIALTIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Nombre de la prestación
          <input ref={nameRef} className={field} maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Ej.: Obturación de resina" data-testid="cp-name"/>
        </label>
      </div>
      {spec && <div className="mt-4 rounded-xl border border-[#e4def3] bg-[#fbf9ff] p-4">
        <label className="text-sm font-medium">¿Cambia el precio según…?
          <select className={field} value={dimension} onChange={event => { setDimension(event.target.value); setRows({}); }} data-testid="cp-dimension">
            <option value={NONE}>No, un solo precio</option>
            {spec.dimensions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            <option value={OWN}>Otra cosa (la escribo yo)</option>
          </select>
        </label>
        {dimension === NONE && <label className="mt-3 block text-sm font-medium">Precio (CLP, opcional)
          <input className={field} inputMode="numeric" value={single} onChange={event => setSingle(event.target.value)} placeholder="Sin precio" data-testid="cp-single-price"/>
        </label>}
        {dimension === OWN && <label className="mt-3 block text-sm font-medium">Variantes, separadas por coma
          <input className={field} value={ownText} onChange={event => setOwnText(event.target.value)} placeholder="Ej.: Niño, Adulto, Adulto mayor" data-testid="cp-own"/>
        </label>}
        {dimension !== NONE && options.length > 0 && <ul className="mt-3 divide-y divide-[#eee9fa] rounded-lg border border-[#e4def3] bg-white" data-testid="cp-variants">
          {options.map(option => {
            const row = rows[option] ?? { on: true, price: "" };
            return <li key={option} className="grid grid-cols-[auto_minmax(0,1fr)_140px] items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" className="size-4" checked={row.on} aria-label={`Incluir ${option}`} onChange={event => setRow(option, { on: event.target.checked })}/>
              <span className={row.on ? "text-[#1f1b3a]" : "text-[#9a96b5]"}>{name.trim() ? variantName(name, option) : option}</span>
              <span className="flex items-center gap-1"><span className="text-[#6e6a8c]">$</span><input className="h-9 w-full rounded-lg border border-[#d3cbe8] px-2 text-right disabled:bg-[#f4f2fa]" inputMode="numeric" placeholder="Sin precio" disabled={!row.on} value={row.price} onChange={event => setRow(option, { price: event.target.value })} aria-label={`Precio de ${option}`}/></span>
            </li>;
          })}
        </ul>}
        {dimension !== NONE && <p className="mt-2 text-xs text-[#6e6a8c]">Se crea una prestación por cada variante marcada; puedes dejar precios vacíos y completarlos después. Desmarca las que no haces.</p>}
      </div>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" data-testid="cp-error">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-sm text-[#625e82]">{spec ? `Se ${total === 1 ? "creará 1 prestación" : `crearán ${total} prestaciones`}` : ""}</span>
        <button type="button" onClick={close} className="min-h-11 rounded-lg border border-[#d3cbe8] px-4 text-sm font-semibold text-[#4f4a74] hover:bg-[#f3effd]">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} className="min-h-11 rounded-lg bg-[#6a3fc8] px-5 text-sm font-semibold text-white hover:bg-[#5a33b0] disabled:opacity-60" data-testid="cp-submit">{saving ? "Creando…" : "Crear"}</button>
      </div>
    </div>
  </div>;
}
