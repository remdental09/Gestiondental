"use client";

import { useEffect, useState } from "react";
import { Eye, FileText, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_FORMAT, PALETTES, checkBudgetFormat, type BudgetFormat, type NamePosition, type PaletteKey } from "@/lib/budget-format";

const POSITIONS: Array<{ key: NamePosition; label: string; hint: string }> = [
  { key: "ambos", label: "Arriba y en la firma", hint: "Cabecera y bloque de firma" },
  { key: "cabecera", label: "Solo arriba", hint: "En la cabecera, junto a la clínica" },
  { key: "firma", label: "Solo en la firma", hint: "Al pie, sobre la línea de firma" },
];

/** Configuración → «Mi presupuesto»: cómo se ve el PDF que arma este profesional. Vista previa con datos de ejemplo. */
export function BudgetFormatPanel() {
  const [format, setFormat] = useState<BudgetFormat | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [logo, setLogo] = useState({ has: false, embeddable: false });
  const [busy, setBusy] = useState<"" | "guardar" | "vista">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/presupuesto/formato").then(r => r.ok ? r.json() as Promise<{ format: BudgetFormat; hasLogo: boolean; logoEmbeddable: boolean }> : null)
      .then(data => { if (!live) return; if (!data) setLoadFailed(true); setFormat(data?.format ?? { ...DEFAULT_FORMAT }); if (data) setLogo({ has: data.hasLogo, embeddable: data.logoEmbeddable }); })
      .catch(() => { if (live) { setLoadFailed(true); setFormat({ ...DEFAULT_FORMAT }); } });
    return () => { live = false; };
  }, []);

  if (!format) return <section className="surface text-sm text-[#6b6a7c]" role="status">Cargando formato del presupuesto…</section>;
  const set = (patch: Partial<BudgetFormat>) => { setFormat({ ...format, ...patch }); setMessage(null); };
  const pickPalette = (palette: PaletteKey) => set(palette === "propio" ? { palette } : { palette, primary: PALETTES[palette].primary, accent: PALETTES[palette].accent });

  async function send(action: "guardar" | "vista") {
    if (action === "guardar" && loadFailed) { setMessage({ ok: false, text: "No se pudo cargar tu formato guardado; recarga la página antes de guardar para no pisarlo." }); return; }
    const checked = checkBudgetFormat(format);
    if (!checked.ok) { setMessage({ ok: false, text: checked.error }); return; }
    // La pestaña se abre antes de esperar al servidor: así el navegador no la bloquea como ventana emergente.
    const preview = action === "vista" ? window.open("", "_blank") : null;
    setBusy(action); setMessage(null);
    try {
      const response = await fetch("/api/presupuesto/formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, format: checked.format }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || "No se pudo completar."); }
      if (action === "vista") {
        const url = URL.createObjectURL(await response.blob());
        if (preview) preview.location.href = url; else window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const saved = await response.json().catch(() => null) as { format?: BudgetFormat } | null;
        if (saved?.format) setFormat(saved.format);
        setMessage({ ok: true, text: "Formato guardado. Tus próximos presupuestos en PDF saldrán así." });
      }
    } catch (error) {
      preview?.close();
      setMessage({ ok: false, text: error instanceof Error ? error.message : "No se pudo completar." });
    } finally { setBusy(""); }
  }

  const check = (key: "showRut" | "showSpecialty" | "showTitles" | "showLogo" | "showChile" | "keepDefaultNotes", label: string, disabled = false) =>
    <label className={"flex items-center gap-2 text-sm " + (disabled ? "text-[#a3a1b3]" : "text-[#35343f]")}><input type="checkbox" className="size-4 accent-[#473a6d]" checked={format[key] && !disabled} disabled={disabled} onChange={e => set({ [key]: e.target.checked })}/>{label}</label>;

  return <section className="surface space-y-5" aria-labelledby="formato-presupuesto" data-testid="budget-format-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="formato-presupuesto" className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-[#473a6d]"/>Mi presupuesto (PDF)</h2>
        <p className="text-sm text-[#6b6a7c]">Cómo se ve el PDF de los presupuestos que armas. En una clínica, cada colega usa el suyo.</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void send("vista")} data-testid="format-preview"><Eye className="mr-2 size-4"/>{busy === "vista" ? "Generando…" : "Vista previa"}</Button>
        <Button type="button" disabled={Boolean(busy)} onClick={() => void send("guardar")} className="bg-[#473a6d] text-white hover:bg-[#3a2f5a]" data-testid="format-save"><Save className="mr-2 size-4"/>{busy === "guardar" ? "Guardando…" : "Guardar"}</Button>
      </div>
    </div>

    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-[#35343f]">Colores</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PALETTES) as Array<Exclude<PaletteKey, "propio">>).map(key => <button key={key} type="button" aria-pressed={format.palette === key} onClick={() => pickPalette(key)} className={"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm " + (format.palette === key ? "border-[#473a6d] ring-2 ring-[#473a6d]/30" : "border-[#dddbe6] hover:bg-[#f7f6fa]")}>
          <span className="flex"><span className="size-5 rounded-l" style={{ background: PALETTES[key].primary }}/><span className="size-5 rounded-r" style={{ background: PALETTES[key].accent }}/></span>{PALETTES[key].label}
        </button>)}
        <button type="button" aria-pressed={format.palette === "propio"} onClick={() => pickPalette("propio")} className={"rounded-lg border px-3 py-2 text-sm " + (format.palette === "propio" ? "border-[#473a6d] ring-2 ring-[#473a6d]/30" : "border-[#dddbe6] hover:bg-[#f7f6fa]")}>Colores propios</button>
      </div>
      {format.palette === "propio" && <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">Principal (cabecera)<input type="color" value={format.primary} onChange={e => set({ primary: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-[#dddbe6]"/></label>
        <label className="flex items-center gap-2">Acento (líneas)<input type="color" value={format.accent} onChange={e => set({ accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-[#dddbe6]"/></label>
        <span className="text-xs text-[#6b6a7c]">El principal debe ser oscuro: lleva texto blanco encima.</span>
      </div>}
      <div className="overflow-hidden rounded-lg border border-[#dddbe6]" aria-hidden="true">
        <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: format.primary }}><span className="font-semibold">Tu clínica</span><span className="text-xs opacity-80">PRESUPUESTO DE TRATAMIENTO</span></div>
        <div className="h-1" style={{ background: format.accent }}/>
      </div>
    </fieldset>

    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-[#35343f]">Dónde va tu nombre</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {POSITIONS.map(p => <label key={p.key} className={"cursor-pointer rounded-lg border p-3 text-sm " + (format.namePosition === p.key ? "border-[#473a6d] bg-[#efedf7]" : "border-[#dddbe6]")}>
          <input type="radio" name="name-position" className="sr-only" checked={format.namePosition === p.key} onChange={() => set({ namePosition: p.key })}/>
          <span className="block font-medium text-[#35343f]">{p.label}</span><span className="text-xs text-[#6b6a7c]">{p.hint}</span>
        </label>)}
      </div>
    </fieldset>

    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-[#35343f]">Qué datos mostrar</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {check("showSpecialty", "Especialidad")}
        {check("showTitles", "Otros títulos (de tu perfil)")}
        {check("showRut", "RUT")}
        {check("showChile", "Numeración chilena junto a la FDI")}
        {check("showLogo", logo.has ? (logo.embeddable ? "Logo de la clínica" : "Logo de la clínica (súbelo en PNG o JPG para que salga en el PDF)") : "Logo de la clínica (agrégalo en el perfil de la clínica)", !logo.embeddable)}
      </div>
      <label className="block text-sm text-[#35343f]">N° de registro de prestador (opcional)
        <input maxLength={60} value={format.registry} onChange={e => set({ registry: e.target.value })} placeholder="Ej.: 123456 (Superintendencia de Salud)" className="mt-1 block min-h-10 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base sm:text-sm"/>
      </label>
    </fieldset>

    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-[#35343f]">Condiciones al pie</legend>
      {check("keepDefaultNotes", "Incluir las condiciones generales (valores en CLP, presupuesto informativo, plan modificable)")}
      <textarea rows={4} maxLength={600} value={format.note} onChange={e => set({ note: e.target.value })} placeholder={"Una por línea. Ej.:\nPresupuesto válido por 30 días.\nFormas de pago: efectivo, transferencia o tarjeta.\nImplantes con garantía de 5 años."} className="block w-full rounded-lg border border-[#d2d4df] bg-white p-3 text-base sm:text-sm" data-testid="format-note"/>
    </fieldset>

    {message && <p role={message.ok ? "status" : "alert"} className={"rounded-lg p-3 text-sm " + (message.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800")}>{message.text}</p>}
  </section>;
}
