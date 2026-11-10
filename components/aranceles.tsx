"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
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

export type CartItem = { key: number; label: string; code?: string; amount: number };
/** Cuando el panel se abre dentro de la ficha de un paciente: permite llevar prestaciones a su presupuesto. */
export type ArancelPatient = { name: string; budgets: Array<{ id: number; title: string }>; cart: CartItem[]; onCartChange: (items: CartItem[]) => void; onSend: (items: CartItem[], targetBudgetId: number | null) => void };

/** Aranceles: cada profesional fija el precio de las prestaciones que realiza. Se guarda al salir del campo. */
export function ArancelesPanel({ patient }: { patient?: ArancelPatient }) {
  const [target, setTarget] = useState("new");
  const [prices, setPrices] = useState<PriceMap>({});
  const [hidden, setHiddenCodes] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [renamingCode, setRenamingCode] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [showHidden, setShowHidden] = useState(false);
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
      const result = await response.json() as { prices?: PriceMap; hidden?: string[]; names?: Record<string, string>; error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo leer el arancel.");
      if (!cancelled) { setPrices(result.prices ?? {}); setHiddenCodes(result.hidden ?? []); setNames(result.names ?? {}); setLoaded(true); }
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
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visible = useMemo(() => GROUPS.map(group => {
    const own = customVisible.filter(item => groupOfSpecialty(item.specialty) === group.name);
    const ownAll = customs.filter(item => groupOfSpecialty(item.specialty) === group.name);
    return {
      ...group,
      own,
      shown: group.items.filter(item => !hiddenSet.has(item.code) && (!onlyPriced || prices[item.code] !== undefined) && (!searching || words.every(word => item.text.includes(word) || item.code.startsWith(word) || (names[item.code] !== undefined && fold(names[item.code]).includes(word))))),
      priced: group.items.filter(item => !hiddenSet.has(item.code) && prices[item.code] !== undefined).length + ownAll.filter(item => item.price !== null).length,
      total: group.items.filter(item => !hiddenSet.has(item.code)).length + ownAll.length,
    };
  }).filter(group => group.shown.length > 0 || group.own.length > 0), [customs, customVisible, hiddenSet, names, onlyPriced, prices, searching, words]);
  const totalPriced = Object.keys(prices).filter(code => !hiddenSet.has(code)).length;

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
    if (!window.confirm(`¿Quieres borrar esta prestación?\n\n«${item.name}»\n\nLos presupuestos ya hechos no cambian.`)) return;
    setMessage("");
    try { await customRequest("DELETE", { id: item.id }, "No se pudo eliminar la prestación."); setCustoms(previous => previous.filter(entry => entry.id !== item.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar la prestación."); }
  };

  const commitCatalogName = async (code: string, original: string) => {
    const draft = codeDraft.replace(/\s+/g, " ").trim();
    const current = names[code] ?? original;
    setRenamingCode(null);
    if (draft === current) return;
    const reset = draft === "" || draft === original;
    if (!reset && draft.length < 3) { setMessage("El nombre debe tener al menos 3 letras."); return; }
    setMessage("");
    try {
      const response = await fetch("/api/aranceles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: reset ? null : draft }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo cambiar el nombre.");
      setNames(previous => { const next = { ...previous }; if (reset) delete next[code]; else next[code] = draft; return next; });
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cambiar el nombre."); }
  };
  const setCatalogHidden = async (code: string, label: string, value: boolean) => {
    if (value && !window.confirm(`¿Quieres borrar esta prestación?\n\n«${label}»\n\nDejará de aparecer en tu lista y en tus presupuestos. Puedes recuperarla en «Prestaciones borradas».`)) return;
    setMessage("");
    try {
      await (async () => {
        const response = await fetch("/api/aranceles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, hidden: value }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo actualizar la prestación.");
      })();
      setHiddenCodes(previous => value ? [...new Set([...previous, code])] : previous.filter(entry => entry !== code));
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar la prestación."); }
  };

  const addToCart = (label: string, code: string | undefined, amount: number | null | undefined) => {
    if (!patient) return;
    patient.onCartChange([...patient.cart, { key: Date.now() + Math.random(), label, ...(code ? { code } : {}), amount: amount ?? 0 }]);
  };
  const addButton = (label: string, code: string | undefined, amount: number | null | undefined, testId: string) => patient
    ? <button type="button" aria-label={`Agregar ${label} al presupuesto de ${patient.name}`} title="Agregar al presupuesto del paciente" onClick={() => addToCart(label, code, amount)} className="inline-flex items-center gap-1 rounded-lg bg-[#e6e4ee] px-2 py-1.5 text-xs font-semibold text-[#473a6d] hover:bg-[#e2dfea]" data-testid={testId}><Plus className="size-3.5"/>Agregar</button>
    : null;
  const customRow = (item: CustomPrestacion, scope: "mine" | "group") => {
    const value = customDrafts[item.id] ?? (item.price !== null ? String(item.price) : "");
    return <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_150px]" data-testid={`${scope}-row-${item.id}`}>
      {renaming === item.id
        ? <Input autoFocus maxLength={120} value={renameDraft} onChange={event => setRenameDraft(event.target.value)} onBlur={() => commitRename(item)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} aria-label="Nombre de la prestación" className="h-9"/>
        : <span className={item.price !== null ? "font-medium text-[#35343f]" : "text-[#4f4e62]"}>{item.name}{scope === "group" && <span className="ml-2 rounded-full bg-[#e6e4ee] px-2 py-0.5 text-[11px] font-semibold text-[#473a6d]" data-testid={`own-badge-${item.id}`}>Mis prestaciones</span>}</span>}
      <span className="flex items-center gap-1"><span className="text-[#6b6a7c]">$</span><Input type="text" inputMode="numeric" aria-label={`Precio de ${item.name}`} placeholder="Sin precio" value={value} data-testid={`${scope}-price-${item.id}`}
        onChange={event => setCustomDrafts(previous => ({ ...previous, [item.id]: event.target.value }))} onBlur={() => commitCustom(item)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-9 text-right"/></span>
      <span className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
        {addButton(item.name, undefined, item.price, `${scope}-add-${item.id}`)}
        <button type="button" aria-label={`Cambiar nombre de ${item.name}`} onClick={() => { setRenameDraft(item.name); setRenaming(item.id); }} className="rounded p-2 text-[#4f4e62] hover:bg-[#efeef4]"><Pencil className="size-4"/></button>
        <button type="button" aria-label={`Eliminar ${item.name}`} onClick={() => removeCustom(item)} className="rounded p-2 text-[#8c4a51] hover:bg-rose-50" data-testid={`${scope}-delete-${item.id}`}><Trash2 className="size-4"/></button>
      </span>
    </li>;
  };

  return <div className="surface space-y-5" data-testid="aranceles">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Aranceles de las prestaciones</h2>
        <button type="button" onClick={() => { setNotice(""); setCreating(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#654f94]" data-testid="open-create-prestacion"><Plus className="size-4"/>Crear prestación</button></div>
      <p className="mt-1 text-sm text-[#615f73]">Abre cada grupo y escribe el precio (CLP) solo de las prestaciones que tú realizas. Las demás quedan sin precio. Estos valores son tuyos: ningún otro profesional los ve, y se usan para completar el valor al armar un presupuesto.</p>
      <p className="mt-1 text-xs text-[#8a86a8]">El rango en gris es solo una sugerencia orientativa: entre el 60% y el 110% del valor referencial 2026 de un arancel de aseguradoras de salud (la fuente de este catálogo), pensado para precios de consulta privada. No es un precio oficial ni de mercado verificado; decide tú.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-[240px] flex-1"><span className="sr-only">Buscar prestación</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b6a7c]"/><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar prestación o código…" className="pl-9" data-testid="aranceles-search"/></label>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={onlyPriced} onChange={event => setOnlyPriced(event.target.checked)} data-testid="aranceles-only-priced"/>Solo con precio</label>
      <span className="text-sm text-[#615f73]" data-testid="aranceles-count">{totalPriced} de {PRESTACIONES.length - hidden.length} con precio</span>
    </div>
    {loadError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError}</p>}
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950" data-testid="aranceles-message">{message}</p>}
    {hidden.length > 0 && <div className="rounded-xl border border-[#e6e4ee] bg-[#f9f9fb] p-3 text-sm" data-testid="hidden-panel">
      <button type="button" aria-expanded={showHidden} onClick={() => setShowHidden(open => !open)} className="font-semibold text-[#473a6d] hover:underline" data-testid="toggle-hidden">Prestaciones borradas ({hidden.length}) {showHidden ? "▲" : "▼"}</button>
      {showHidden && <ul className="mt-2 divide-y divide-[#efeef4]">
        {hidden.map(code => ({ code, item: PRESTACIONES.find(entry => entry.code === code) })).filter(entry => entry.item).map(({ code, item }) => <li key={code} className="flex items-center justify-between gap-3 py-2"><span className="text-[#4f4e62]"><span className="mr-2 font-mono text-xs text-[#6b6a7c]">{code}</span>{prestacionLabel(item!.name)}</span><button type="button" onClick={() => setCatalogHidden(code, prestacionLabel(item!.name), false)} className="shrink-0 rounded-lg border border-[#d2d4df] px-3 py-1 text-xs font-semibold text-[#4f4e62] hover:bg-[#efeef4]" data-testid={`restore-${code}`}>Recuperar</button></li>)}
      </ul>}
    </div>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="aranceles-notice">{notice}</p>}
    {!loaded && <p role="status" className="text-sm text-[#6b6a7c]">Cargando tu arancel…</p>}
    <div className="space-y-2">
      {customs.length > 0 && customVisible.length > 0 && <section className="overflow-hidden rounded-xl border border-[#c0b8d2] bg-white" data-testid="custom-section">
        <button type="button" aria-expanded={customOpen || searching} onClick={() => setCustomOpen(open => !open)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#e6e4ee] px-4 py-3 text-left hover:bg-[#e7e4ed]">
          <span className="flex items-center gap-2 font-semibold text-[#35343f]">{customOpen || searching ? <ChevronDown className="size-4 text-[#473a6d]"/> : <ChevronRight className="size-4 text-[#473a6d]"/>}Mis prestaciones</span>
          <span className="text-xs font-medium text-[#473a6d]">{customs.filter(item => item.price !== null).length} con precio · {customs.length} creadas por ti</span>
        </button>
        {(customOpen || searching) && <div>
          {PRESTACION_SPECIALTIES.filter(spec => customVisible.some(item => item.specialty === spec.key)).map(spec => <div key={spec.key}>
            <p className="bg-[#f9f9fb] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">{spec.label}</p>
            <ul className="divide-y divide-[#efeef4]">
              {customVisible.filter(item => item.specialty === spec.key).map(item => {
                return customRow(item, "mine");
              })}
            </ul>
          </div>)}
        </div>}
      </section>}
      {visible.map(group => {
        const open = searching || onlyPriced || openGroups[group.name];
        return <section key={group.name} className="overflow-hidden rounded-xl border border-[#dddbe6] bg-white">
          <button type="button" aria-expanded={!!open} onClick={() => setOpenGroups(previous => ({ ...previous, [group.name]: !previous[group.name] }))} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#f7f6fa] px-4 py-3 text-left hover:bg-[#f2f0f6]" data-testid={`arancel-group-${group.name}`}>
            <span className="flex min-w-0 items-center gap-2 font-semibold text-[#35343f]">{open ? <ChevronDown className="size-4 shrink-0 text-[#473a6d]"/> : <ChevronRight className="size-4 shrink-0 text-[#473a6d]"/>}{group.label}</span>
            <span className="pl-6 text-xs font-medium text-[#473a6d] sm:pl-0">{group.priced} con precio · {group.total} prestaciones</span>
          </button>
          {open && <ul className="divide-y divide-[#efeef4]">
            {group.own.map(item => customRow(item, "group"))}
            {group.shown.map(item => {
              const range = suggestedRange(item.code);
              const value = drafts[item.code] ?? (prices[item.code] !== undefined ? String(prices[item.code]) : "");
              return <li key={item.code} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[84px_minmax(0,1fr)_170px_330px]">
                <span className="hidden font-mono text-xs text-[#6b6a7c] sm:block">{item.code}</span>
                {renamingCode === item.code
                  ? <Input autoFocus maxLength={120} value={codeDraft} onChange={event => setCodeDraft(event.target.value)} onBlur={() => commitCatalogName(item.code, item.label)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenamingCode(null); }} aria-label="Nombre de la prestación" className="order-1 h-9 sm:order-none" data-testid={`arancel-name-input-${item.code}`}/>
                  : <span className={`order-1 sm:order-none ${prices[item.code] !== undefined ? "font-medium text-[#35343f]" : "text-[#4f4e62]"}`}>{names[item.code] ?? item.label}{names[item.code] && <span className="ml-2 text-[11px] font-normal text-[#9a96b5]" title={`Nombre original: ${item.label}`}>(editada)</span>}</span>}
                {range ? <span className="order-3 col-span-2 text-xs text-[#9a96b5] sm:order-none sm:col-span-1 sm:text-right" title={`Sugerencia orientativa: 60%–110% del valor referencial 2026 del arancel (${money(range.reference)}). No es un precio oficial.`} data-testid={`arancel-range-${item.code}`}>{money(range.low)} – {money(range.high)}</span> : <span className="order-3 hidden sm:block"/>}
                <span className="order-2 flex items-center gap-1 sm:order-none">
                  <span className="text-[#6b6a7c]">$</span>
                  <Input type="text" inputMode="numeric" aria-label={`Precio de ${item.label}`} placeholder="Sin precio" value={value} disabled={!!saving[item.code]} data-testid={`arancel-price-${item.code}`}
                    onChange={event => setDrafts(previous => ({ ...previous, [item.code]: event.target.value }))}
                    onBlur={() => commit(item.code, item.label)}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="h-9 text-right"/>
                  {prices[item.code] !== undefined && drafts[item.code] === undefined && <span className="sr-only">{money(prices[item.code])}</span>}
                  {addButton(names[item.code] ?? item.label, item.code, prices[item.code], `arancel-add-${item.code}`)}
                  <button type="button" aria-label={`Cambiar nombre de ${names[item.code] ?? item.label}`} onClick={() => { setCodeDraft(names[item.code] ?? item.label); setRenamingCode(item.code); }} className="rounded p-2 text-[#4f4e62] hover:bg-[#efeef4]" data-testid={`arancel-rename-${item.code}`}><Pencil className="size-4"/></button>
                  <button type="button" aria-label={`Borrar ${names[item.code] ?? item.label}`} onClick={() => setCatalogHidden(item.code, names[item.code] ?? item.label, true)} className="rounded p-2 text-[#8c4a51] hover:bg-rose-50" data-testid={`arancel-delete-${item.code}`}><Trash2 className="size-4"/></button>
                </span>
              </li>;
            })}
          </ul>}
        </section>;
      })}
      {loaded && visible.length === 0 && <p className="rounded-lg bg-[#f7f6fa] p-4 text-sm text-[#615f73]">{onlyPriced && !searching ? "Aún no has fijado ningún precio." : "No hay prestaciones que coincidan con la búsqueda."}</p>}
    </div>
    {patient && patient.cart.length > 0 && <div className="sticky bottom-3 z-10 rounded-xl border border-[#473a6d] bg-white p-3 shadow-xl" data-testid="cart-bar">
      <p className="text-sm font-semibold text-[#35343f]">Para el presupuesto de {patient.name} ({patient.cart.length})</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {patient.cart.map(entry => <li key={entry.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#e6e4ee] py-1 pl-3 pr-1 text-xs text-[#423360]"><span className="truncate">{entry.label}{entry.amount ? ` · ${money(entry.amount)}` : " · sin precio"}</span><button type="button" aria-label={`Quitar ${entry.label}`} onClick={() => patient.onCartChange(patient.cart.filter(other => other.key !== entry.key))} className="rounded-full p-1 hover:bg-[#dfdbe8]"><X className="size-3"/></button></li>)}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">Agregar a
          <select className="min-h-10 rounded-lg border border-[#d2d4df] bg-white px-2 text-sm" value={target} onChange={event => setTarget(event.target.value)} data-testid="cart-target">
            <option value="new">Un presupuesto nuevo</option>
            {patient.budgets.map(budget => <option key={budget.id} value={String(budget.id)}>{budget.title || `Presupuesto ${budget.id}`}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { patient.onSend(patient.cart, target === "new" ? null : Number(target)); setTarget("new"); }} className="min-h-10 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#654f94]" data-testid="cart-send">Llevar al presupuesto</button>
        <button type="button" onClick={() => { if (window.confirm("¿Vaciar la selección?")) patient.onCartChange([]); }} className="min-h-10 rounded-lg border border-[#d2d4df] px-3 text-sm font-semibold text-[#4f4e62] hover:bg-[#efeef4]">Vaciar</button>
      </div>
    </div>}
    {creating && <CreatePrestacionDialog onClose={() => setCreating(false)} onCreated={(items, created) => { setCustoms(items); setCreating(false); setCustomOpen(true); setNotice(created === 1 ? "Se creó 1 prestación. La encuentras en «Mis prestaciones»." : `Se crearon ${created} prestaciones. Las encuentras en «Mis prestaciones».`); }}/>}
  </div>;
}
