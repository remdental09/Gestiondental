"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { normalizePrice, type PriceMap } from "@/lib/aranceles";
import { PRESTACIONES, PRESTACION_GROUPS, prestacionLabel } from "@/lib/prestaciones-catalog";
import { suggestedRange } from "@/lib/prestaciones-referencia";
import { CreatePrestacionDialog } from "@/components/create-prestacion-dialog";
import { PRESTACION_SPECIALTIES, SPECIALTY_CATALOG_GROUP, specialtyLabel, type CustomPrestacion } from "@/lib/custom-prestaciones";

const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const OWN_ONLY_GROUP = "__propias-estetica";
const GROUPS = PRESTACION_GROUPS.map(group => ({
  name: group.name,
  label: prestacionLabel(group.name),
  items: PRESTACIONES.filter(item => item.group === group.name).map(item => ({ code: item.code, label: prestacionLabel(item.name), text: fold(item.name) })),
}));

GROUPS.push({ name: OWN_ONLY_GROUP, label: "Estética y blanqueamiento (tus prestaciones)", items: [] });
const groupOfSpecialty = (specialty: string) => SPECIALTY_CATALOG_GROUP[specialty] ?? OWN_ONLY_GROUP;

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
  const [customs, setCustoms] = useState<CustomPrestacion[]>([]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [customDrafts, setCustomDrafts] = useState<Record<number, string>>({});
  const [customOpen, setCustomOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/aranceles").then(async response => {
      const result = await response.json() as { prices?: PriceMap; error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo leer el arancel.");
      if (!cancelled) { setPrices(result.prices ?? {}); setLoaded(true); }
    }).catch(error => { if (!cancelled) { setLoadError(error instanceof Error ? error.message : "No se pudo leer el arancel."); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/aranceles/custom").then(async response => {
      const result = await response.json() as { items?: CustomPrestacion[] };
      if (response.ok && !cancelled) setCustoms(result.items ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const words = useMemo(() => fold(query).trim().split(/\s+/).filter(Boolean), [query]);
  const searching = words.length > 0;
  const customVisible = useMemo(() => customs.filter(item => (!onlyPriced || item.price !== null) && (!searching || words.every(word => fold(item.name + " " + specialtyLabel(item.specialty)).includes(word)))), [customs, onlyPriced, searching, words]);
  const visible = useMemo(() => GROUPS.map(group => {
    const own = customVisible.filter(item => groupOfSpecialty(item.specialty) === group.name);
    const ownAll = customs.filter(item => groupOfSpecialty(item.specialty) === group.name);
    return {
      ...group,
      own,
      shown: group.items.filter(item => (!onlyPriced || prices[item.code] !== undefined) && (!searching || words.every(word => item.text.includes(word) || item.code.startsWith(word)))),
      priced: group.items.filter(item => prices[item.code] !== undefined).length + ownAll.filter(item => item.price !== null).length,
      total: group.items.length + ownAll.length,
    };
  }).filter(group => group.shown.length > 0 || group.own.length > 0), [customs, customVisible, onlyPriced, prices, searching, words]);
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

  const customRequest = async (method: string, body: object, failure: string) => {
    const response = await fetch("/api/aranceles/custom", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || failure);
  };
  const commitCustom = async (item: CustomPrestacion) => {
    const draft = customDrafts[item.id];
    if (draft === undefined) return;
    const clear = () => setCustomDrafts(previous => { const next = { ...previous }; delete next[item.id]; return next; });
    setMessage("");
    let price: number | null;
    if (draft.trim() === "") { if (item.price === null) { clear(); return; } price = null; }
    else {
      price = normalizePrice(draft);
      if (price === null) { setMessage(`El precio de «${item.name}» debe ser un número entero en pesos, mayor que 0.`); return; }
      if (price === item.price) { clear(); return; }
    }
    try { await customRequest("PUT", { id: item.id, price }, "No se pudo guardar el precio."); setCustoms(previous => previous.map(entry => entry.id === item.id ? { ...entry, price } : entry)); clear(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el precio."); }
  };
  const commitRename = async (item: CustomPrestacion) => {
    const name = renameDraft.replace(/\s+/g, " ").trim();
    if (name === item.name) { setRenaming(null); return; }
    setMessage("");
    try { await customRequest("PUT", { id: item.id, name }, "No se pudo cambiar el nombre."); setCustoms(previous => previous.map(entry => entry.id === item.id ? { ...entry, name } : entry)); setRenaming(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cambiar el nombre."); }
  };
  const removeCustom = async (item: CustomPrestacion) => {
    if (!window.confirm(`¿Eliminar tu prestación «${item.name}»? Los presupuestos ya hechos no cambian.`)) return;
    setMessage("");
    try { await customRequest("DELETE", { id: item.id }, "No se pudo eliminar la prestación."); setCustoms(previous => previous.filter(entry => entry.id !== item.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar la prestación."); }
  };

  const customRow = (item: CustomPrestacion, scope: "mine" | "group") => {
    const value = customDrafts[item.id] ?? (item.price !== null ? String(item.price) : "");
    return <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_72px]" data-testid={`${scope}-row-${item.id}`}>
      {renaming === item.id
        ? <Input autoFocus maxLength={120} value={renameDraft} onChange={event => setRenameDraft(event.target.value)} onBlur={() => commitRename(item)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} aria-label="Nombre de la prestación" className="h-9"/>
        : <span className={item.price !== null ? "font-medium text-[#1f1b3a]" : "text-[#4f4a74]"}>{item.name}{scope === "group" && <span className="ml-2 rounded-full bg-[#ece6fb] px-2 py-0.5 text-[11px] font-semibold text-[#6a3fc8]" data-testid={`own-badge-${item.id}`}>Mía</span>}</span>}
      <span className="flex items-center gap-1"><span className="text-[#6e6a8c]">$</span><Input type="text" inputMode="numeric" aria-label={`Precio de ${item.name}`} placeholder="Sin precio" value={value} data-testid={`${scope}-price-${item.id}`}
        onChange={event => setCustomDrafts(previous => ({ ...previous, [item.id]: event.target.value }))} onBlur={() => commitCustom(item)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-9 text-right"/></span>
      <span className="col-span-2 flex justify-end gap-1 sm:col-span-1">
        <button type="button" aria-label={`Cambiar nombre de ${item.name}`} onClick={() => { setRenameDraft(item.name); setRenaming(item.id); }} className="rounded p-2 text-[#4f4a74] hover:bg-[#f3effd]"><Pencil className="size-4"/></button>
        <button type="button" aria-label={`Eliminar ${item.name}`} onClick={() => removeCustom(item)} className="rounded p-2 text-[#8c4a51] hover:bg-rose-50" data-testid={`${scope}-delete-${item.id}`}><Trash2 className="size-4"/></button>
      </span>
    </li>;
  };

  return <div className="surface space-y-5" data-testid="aranceles">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Aranceles de las prestaciones</h2>
        <button type="button" onClick={() => { setNotice(""); setCreating(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#6a3fc8] px-4 text-sm font-semibold text-white hover:bg-[#5a33b0]" data-testid="open-create-prestacion"><Plus className="size-4"/>Crear prestación</button></div>
      <p className="mt-1 text-sm text-[#625e82]">Abre cada grupo y escribe el precio (CLP) solo de las prestaciones que tú realizas. Las demás quedan sin precio. Estos valores son tuyos: ningún otro profesional los ve, y se usan para completar el valor al armar un presupuesto.</p>
      <p className="mt-1 text-xs text-[#8a86a8]">El rango en gris es solo una sugerencia orientativa: entre el 60% y el 110% del valor referencial 2026 de un arancel de aseguradoras de salud (la fuente de este catálogo), pensado para precios de consulta privada. No es un precio oficial ni de mercado verificado; decide tú.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-[240px] flex-1"><span className="sr-only">Buscar prestación</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6e6a8c]"/><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar prestación o código…" className="pl-9" data-testid="aranceles-search"/></label>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={onlyPriced} onChange={event => setOnlyPriced(event.target.checked)} data-testid="aranceles-only-priced"/>Solo con precio</label>
      <span className="text-sm text-[#625e82]" data-testid="aranceles-count">{totalPriced} de {PRESTACIONES.length} con precio</span>
    </div>
    {loadError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError}</p>}
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950" data-testid="aranceles-message">{message}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="aranceles-notice">{notice}</p>}
    {!loaded && <p role="status" className="text-sm text-[#6e6a8c]">Cargando tu arancel…</p>}
    <div className="space-y-2">
      {customs.length > 0 && customVisible.length > 0 && <section className="overflow-hidden rounded-xl border border-[#b7a0ea] bg-white" data-testid="custom-section">
        <button type="button" aria-expanded={customOpen || searching} onClick={() => setCustomOpen(open => !open)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#ece6fb] px-4 py-3 text-left hover:bg-[#e2d9f8]">
          <span className="flex items-center gap-2 font-semibold text-[#1f1b3a]">{customOpen || searching ? <ChevronDown className="size-4 text-[#6a3fc8]"/> : <ChevronRight className="size-4 text-[#6a3fc8]"/>}Mis prestaciones</span>
          <span className="text-xs font-medium text-[#6a3fc8]">{customs.filter(item => item.price !== null).length} con precio · {customs.length} creadas por ti</span>
        </button>
        {(customOpen || searching) && <div>
          {PRESTACION_SPECIALTIES.filter(spec => customVisible.some(item => item.specialty === spec.key)).map(spec => <div key={spec.key}>
            <p className="bg-[#faf8ff] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#6e6a8c]">{spec.label}</p>
            <ul className="divide-y divide-[#eee9fa]">
              {customVisible.filter(item => item.specialty === spec.key).map(item => {
                return customRow(item, "mine");
              })}
            </ul>
          </div>)}
        </div>}
      </section>}
      {visible.map(group => {
        const open = searching || onlyPriced || openGroups[group.name];
        return <section key={group.name} className="overflow-hidden rounded-xl border border-[#ddd6f0] bg-white">
          <button type="button" aria-expanded={!!open} onClick={() => setOpenGroups(previous => ({ ...previous, [group.name]: !previous[group.name] }))} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#f8f5ff] px-4 py-3 text-left hover:bg-[#f0eafc]" data-testid={`arancel-group-${group.name}`}>
            <span className="flex min-w-0 items-center gap-2 font-semibold text-[#1f1b3a]">{open ? <ChevronDown className="size-4 shrink-0 text-[#6a3fc8]"/> : <ChevronRight className="size-4 shrink-0 text-[#6a3fc8]"/>}{group.label}</span>
            <span className="pl-6 text-xs font-medium text-[#6a3fc8] sm:pl-0">{group.priced} con precio · {group.total} prestaciones</span>
          </button>
          {open && <ul className="divide-y divide-[#eee9fa]">
            {group.own.map(item => customRow(item, "group"))}
            {group.shown.map(item => {
              const range = suggestedRange(item.code);
              const value = drafts[item.code] ?? (prices[item.code] !== undefined ? String(prices[item.code]) : "");
              return <li key={item.code} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[84px_minmax(0,1fr)_190px_170px]">
                <span className="hidden font-mono text-xs text-[#6e6a8c] sm:block">{item.code}</span>
                <span className={`order-1 sm:order-none ${prices[item.code] !== undefined ? "font-medium text-[#1f1b3a]" : "text-[#4f4a74]"}`}>{item.label}</span>
                {range ? <span className="order-3 col-span-2 text-xs text-[#9a96b5] sm:order-none sm:col-span-1 sm:text-right" title={`Sugerencia orientativa: 60%–110% del valor referencial 2026 del arancel (${money(range.reference)}). No es un precio oficial.`} data-testid={`arancel-range-${item.code}`}>{money(range.low)} – {money(range.high)}</span> : <span className="order-3 hidden sm:block"/>}
                <span className="order-2 flex items-center gap-1 sm:order-none">
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
    {creating && <CreatePrestacionDialog onClose={() => setCreating(false)} onCreated={(items, created) => { setCustoms(items); setCreating(false); setCustomOpen(true); setNotice(created === 1 ? "Se creó 1 prestación. La encuentras en «Mis prestaciones»." : `Se crearon ${created} prestaciones. Las encuentras en «Mis prestaciones».`); }}/>}
  </div>;
}
