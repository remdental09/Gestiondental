"use client";

import { useState } from "react";
import { PRICE_UNIT_LABEL, parseZone, priceUnitFromName, zoneOptions, zoneValue, type Dentition, type ZoneGroup } from "@/lib/treatment-zones";

/** Zona de aplicación de una prestación: pieza suelta (por defecto), arcada/boca, cuadrante o sextante. */
export function ZonePicker({ value, label, onChange }: { value?: string; label: string; onChange: (zone: string | undefined) => void }) {
  const current = parseZone(value);
  const [dentition, setDentition] = useState<Dentition>(current?.dentition ?? "perm");
  const [open, setOpen] = useState(Boolean(current));
  const options = zoneOptions(dentition);
  const unit = priceUnitFromName(label);
  const groups: Array<{ group: ZoneGroup; title: string }> = [
    { group: "general", title: "Áreas generales" }, { group: "cuadrante", title: "Cuadrantes" }, { group: "sextante", title: "Sextantes" },
  ];
  const pick = (key: string) => onChange(current?.option.key === key && current.dentition === dentition ? undefined : zoneValue(dentition, key));
  return <div className="space-y-2 text-sm sm:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-medium text-[#473a6d] underline-offset-2 hover:underline">
        {current ? `Zona: ${current.option.label}${current.dentition === "temp" ? " (temporal)" : ""}` : "¿Se aplica a una zona (boca, arcada, cuadrante, sextante)?"}
      </button>
      {unit && <span className="text-xs text-[#6b6a7c]">Arancel: {PRICE_UNIT_LABEL[unit].toLowerCase()}</span>}
    </div>
    {open && <div className="rounded-lg border border-[#e6e4ee] bg-white p-3">
      <div role="group" aria-label="Dentición" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-[#efeef4] p-1 text-xs font-semibold">
        {([["perm", "Permanente"], ["temp", "Temporal"]] as const).map(([key, text]) => <button key={key} type="button" aria-pressed={dentition === key} onClick={() => { setDentition(key); if (current) onChange(zoneValue(key, current.option.key)); }} className={"rounded-md py-1.5 " + (dentition === key ? "bg-white text-[#473a6d] shadow-sm" : "text-[#6b6a7c]")}>{text}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(({ group, title }) => <fieldset key={group} className={group === "sextante" ? "sm:row-span-2" : ""}>
          <legend className="mb-1 text-xs font-semibold text-[#4f4e62]">{title}</legend>
          <div className="space-y-1">{options.filter(option => option.group === group).map(option => {
            const active = current?.dentition === dentition && current.option.key === option.key;
            return <button key={option.key} type="button" aria-pressed={active} onClick={() => pick(option.key)} className={"flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm " + (active ? "border-[#473a6d] bg-[#efeef4] font-semibold text-[#3a2f5a]" : "border-[#e6e4ee] hover:bg-[#f9f9fb]")}>
              <span>{option.label}</span><span className="text-xs font-normal text-[#6b6a7c]">{option.range}</span>
            </button>;
          })}</div>
        </fieldset>)}
      </div>
      {current && <button type="button" onClick={() => onChange(undefined)} className="mt-3 text-xs text-[#8c4a51] underline">Quitar zona (volver a piezas sueltas)</button>}
    </div>}
  </div>;
}
