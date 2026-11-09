"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { normalizePrice, type PriceMap } from "@/lib/aranceles";
import { PRESTACIONES, PRESTACION_GROUPS, prestacionLabel } from "@/lib/prestaciones-catalog";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const GROUPS = PRESTACION_GROUPS.map(group => ({
  name: group.name,
  label: prestacionLabel(group.name),
  items: PRESTACIONES.filter(item => item.group === group.name).map(item => ({ code: item.code, label: prestacionLabel(item.name), text: fold(item.name) })),
}));

/** Aranceles: cada profesional fija el precio de las prestaciones que realiza. Se guarda al salir del campo. */
export function ArancelesPanel() {
  const [prices, setPrices] = useState<PriceMap>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyPriced, setOnlyPriced] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/aranceles").then(async response => {
      const result = await response.json() as { prices?: PriceMap; error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo leer el arancel.");
      if (!cancelled) { setPrices(result.prices ?? {}); setLoaded(true); }
    }).catch(error => { if (!cancelled) { setLoadError(error instanceof Error ? error.message : "No se pudo leer el arancel."); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const words = useMemo(() => fold(query).trim().split(/\s+/).filter(Boolean), [query]);
  const searching = words.length > 0;
  const visible = useMemo(() => GROUPS.map(group => ({
    ...group,
    shown: group.items.filter(item => (!onlyPriced || prices[item.code] !== undefined) && (!searching || words.every(word => item.text.includes(word) || item.code.startsWith(word)))),
    priced: group.items.filter(item => prices[item.code] !== undefined).length,
  })).filter(group => group.shown.length > 0), [onlyPriced, prices, searching, words]);
  const totalPriced = Object.keys(prices).length;

  const commit = async (code: string, label: string) => {
    const draft = drafts[code];
    if (draft === undefined) return;
    const current = prices[code];
    const clear = () => setDrafts(previous => { const next = { ...previous }; delete next[code]; return next; });
    setMessage("");
    let price: number | null;
    if (draft.trim() === "") {
      if (current === undefined) { clear(); return; }
      if (!window.confirm(`¿Quitar el precio de «${label}»? Dejará de completarse solo en los presupuestos.`)) { clear(); return; }
      price = null;
    } else {
      price = normalizePrice(draft);
      if (price === null) { setMessage(`El precio de «${label}» debe ser un número entero en pesos, mayor que 0.`); return; }
      if (price === current) { clear(); return; }
    }
    setSaving(previous => ({ ...previous, [code]: true }));
    try {
      const response = await fetch("/api/aranceles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, price }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el precio.");
      setPrices(previous => { const next = { ...previous }; if (price === null) delete next[code]; else next[code] = price; return next; });
      clear();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el precio."); }
    finally { setSaving(previous => ({ ...previous, [code]: false })); }
  };

  return <div className="surface space-y-5" data-testid="aranceles">
    <div>
      <h2 className="text-xl font-semibold">Aranceles de las prestaciones</h2>
      <p className="mt-1 text-sm text-[#625e82]">Abre cada grupo y escribe el precio (CLP) solo de las prestaciones que tú realizas. Las demás quedan sin precio. Estos valores son tuyos: ningún otro profesional los ve, y se usan para completar el valor al armar un presupuesto.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-[240px] flex-1"><span className="sr-only">Buscar prestación</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6e6a8c]"/><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar prestación o código…" className="pl-9" data-testid="aranceles-search"/></label>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={onlyPriced} onChange={event => setOnlyPriced(event.target.checked)} data-testid="aranceles-only-priced"/>Solo con precio</label>
      <span className="text-sm text-[#625e82]" data-testid="aranceles-count">{totalPriced} de {PRESTACIONES.length} con precio</span>
    </div>
    {loadError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError}</p>}
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950" data-testid="aranceles-message">{message}</p>}
    {!loaded && <p role="status" className="text-sm text-[#6e6a8c]">Cargando tu arancel…</p>}
    <div className="space-y-2">
      {visible.map(group => {
        const open = searching || onlyPriced || openGroups[group.name];
        return <section key={group.name} className="overflow-hidden rounded-xl border border-[#ddd6f0] bg-white">
          <button type="button" aria-expanded={!!open} onClick={() => setOpenGroups(previous => ({ ...previous, [group.name]: !previous[group.name] }))} className="flex w-full items-center justify-between gap-3 bg-[#f8f5ff] px-4 py-3 text-left hover:bg-[#f0eafc]" data-testid={`arancel-group-${group.name}`}>
            <span className="flex items-center gap-2 font-semibold text-[#1f1b3a]">{open ? <ChevronDown className="size-4 text-[#6a3fc8]"/> : <ChevronRight className="size-4 text-[#6a3fc8]"/>}{group.label}</span>
            <span className="shrink-0 text-xs font-medium text-[#6a3fc8]">{group.priced} con precio · {group.items.length} prestaciones</span>
          </button>
          {open && <ul className="divide-y divide-[#eee9fa]">
            {group.shown.map(item => {
              const value = drafts[item.code] ?? (prices[item.code] !== undefined ? String(prices[item.code]) : "");
              return <li key={item.code} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3 px-4 py-2 text-sm sm:grid-cols-[84px_minmax(0,1fr)_170px]">
                <span className="hidden font-mono text-xs text-[#6e6a8c] sm:block">{item.code}</span>
                <span className={prices[item.code] !== undefined ? "font-medium text-[#1f1b3a]" : "text-[#4f4a74]"}>{item.label}</span>
                <span className="flex items-center gap-1">
                  <span className="text-[#6e6a8c]">$</span>
                  <Input type="text" inputMode="numeric" aria-label={`Precio de ${item.label}`} placeholder="Sin precio" value={value} disabled={!!saving[item.code]} data-testid={`arancel-price-${item.code}`}
                    onChange={event => setDrafts(previous => ({ ...previous, [item.code]: event.target.value }))}
                    onBlur={() => commit(item.code, item.label)}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="h-9 text-right"/>
                  {prices[item.code] !== undefined && drafts[item.code] === undefined && <span className="sr-only">{money(prices[item.code])}</span>}
                </span>
              </li>;
            })}
          </ul>}
        </section>;
      })}
      {loaded && visible.length === 0 && <p className="rounded-lg bg-[#f8f5ff] p-4 text-sm text-[#625e82]">{onlyPriced && !searching ? "Aún no has fijado ningún precio." : "No hay prestaciones que coincidan con la búsqueda."}</p>}
    </div>
  </div>;
}
