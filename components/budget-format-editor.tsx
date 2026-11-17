"use client";

import { PALETTES, type BudgetFormat, type NamePosition, type PaletteKey } from "@/lib/budget-format";

const POSITIONS: Array<{ key: NamePosition; label: string; hint: string }> = [
  { key: "ambos", label: "Arriba y en la firma", hint: "Cabecera y bloque de firma" },
  { key: "cabecera", label: "Solo arriba", hint: "En la cabecera, junto a la clínica" },
  { key: "firma", label: "Solo en la firma", hint: "Al pie, sobre la línea de firma" },
];

/** Controles del diseño del PDF (colores, nombre, datos, condiciones). Los usan Configuración y la vista previa del presupuesto. */
export function BudgetFormatEditor({ format, onChange, logo }: { format: BudgetFormat; onChange: (next: BudgetFormat) => void; logo: { has: boolean; embeddable: boolean } }) {
  const set = (patch: Partial<BudgetFormat>) => onChange({ ...format, ...patch });
  const pickPalette = (palette: PaletteKey) => set(palette === "propio" ? { palette } : { palette, primary: PALETTES[palette].primary, accent: PALETTES[palette].accent });
  const check = (key: "showRut" | "showSpecialty" | "showTitles" | "showLogo" | "showChile" | "keepDefaultNotes", label: string, disabled = false) =>
    <label className={"flex items-center gap-2 text-sm " + (disabled ? "text-[#a3a1b3]" : "text-[#35343f]")}><input type="checkbox" className="size-4 accent-[#473a6d]" checked={format[key] && !disabled} disabled={disabled} onChange={e => set({ [key]: e.target.checked })}/>{label}</label>;
  return <div className="space-y-5">
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
        {POSITIONS.map(p => <label key={p.key} className={"cursor-pointer rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-[#473a6d]/40 " + (format.namePosition === p.key ? "border-[#473a6d] bg-[#efedf7]" : "border-[#dddbe6]")}>
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
  </div>;
}
