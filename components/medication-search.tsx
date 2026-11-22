"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { loadCatalog, searchCatalog, controlNotice, type CatalogFile, type CatalogProduct, type MedicationSuggestion } from "@/lib/medication-catalog";

const CATALOG_URL = "/datos/medicamentos-isp.json";
let catalogPromise: Promise<CatalogProduct[]> | null = null;
/** El catálogo (≈160 KB comprimido) se descarga una sola vez, al enfocar el primer campo de medicamento. */
function fetchCatalog(): Promise<CatalogProduct[]> {
  catalogPromise ??= fetch(CATALOG_URL, { credentials: "same-origin" })
    .then(response => { if (!response.ok) throw new Error(`Catálogo ISP: ${response.status}`); return response.json() as Promise<CatalogFile>; })
    .then(loadCatalog)
    .catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}

/** Campo «Medicamento» con autocompletado desde el catálogo de productos registrados en el ISP. Se puede escribir libremente: el catálogo solo sugiere. */
export function MedicationNameInput({ value, onChange, onPick, className }: { value: string; onChange: (text: string) => void; onPick: (suggestion: MedicationSuggestion) => void; className: string }) {
  const listId = useId();
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);
  const load = () => { if (!catalog) fetchCatalog().then(setCatalog).catch(() => setFailed(true)); };
  const suggestions = useMemo(() => open && catalog ? searchCatalog(catalog, value) : [], [open, catalog, value]);
  const choose = (suggestion: MedicationSuggestion) => { onPick(suggestion); setOpen(false); setActive(0); };
  return <div className="relative">
    <input className={className} value={value} placeholder="Ej. Amoxicilina 500 mg" autoComplete="off" role="combobox" aria-expanded={open && suggestions.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && suggestions.length ? `${listId}-${active}` : undefined} data-testid="medication-nombre"
      onFocus={() => { load(); setOpen(true); }}
      onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={event => {
        if (!suggestions.length) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => (i + 1) % suggestions.length); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => (i - 1 + suggestions.length) % suggestions.length); }
        else if (event.key === "Enter") { event.preventDefault(); choose(suggestions[active] ?? suggestions[0]); }
        else if (event.key === "Escape") setOpen(false);
      }}/>
    {open && value.trim().length >= 2 && !catalog && !failed && <p className="mt-1 text-xs font-normal text-[#615f73]" role="status">Cargando catálogo de medicamentos…</p>}
    {failed && open && <p className="mt-1 text-xs font-normal text-[#615f73]">No se pudo cargar el catálogo; puedes escribir el medicamento a mano.</p>}
    {suggestions.length > 0 && <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#d2d4df] bg-white p-1 shadow-lg" data-testid="medication-suggestions">
      {suggestions.map((s, i) => <li key={`${s.kind}-${s.nombre}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
        onMouseDown={event => { event.preventDefault(); choose(s); }} onMouseEnter={() => setActive(i)}
        className={`min-h-11 cursor-pointer rounded-lg px-3 py-2 text-left ${i === active ? "bg-[#efecf6]" : ""}`}>
        <p className="text-sm font-semibold text-[#35343f]">{s.label}{s.kind === "generico" && <span className="ml-2 rounded bg-[#e6e1f3] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#473a6d]">Genérico</span>}{s.control && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">{s.control}</span>}</p>
        <p className="text-xs font-normal text-[#615f73]">{s.detalle}</p>
      </li>)}
      <li className="px-3 py-1.5 text-[11px] font-normal text-[#615f73]" role="presentation">Catálogo de productos registrados en el ISP · Si no aparece, escríbelo a mano.</li>
    </ul>}
  </div>;
}

export { controlNotice };
