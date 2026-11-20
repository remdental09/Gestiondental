"use client";
/**
 * Bloque compacto «Piezas de esta evolución»: una línea por pieza o zona al pie de la evolución, sin tarjetas grandes.
 * Verde = resuelta sola; ámbar = con duda. Al tocar una línea se abre la pieza en grande y «Corregir» en línea.
 * «Presupuestar» solo aparece en diagnósticos o planes sin ítem (y, a pedido, en lo realizado sin presupuesto).
 */
import { useState } from "react";
import { formatTooth, lineText, matchText, perioText, refreshLine, surfacesText, whereText, type EvolutionLine, type OpenBudget } from "@/lib/evolution-lines";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@/lib/budget-plans";
import { zoneOptions, zoneValue } from "@/lib/treatment-zones";

const SURFACES = ["M", "O", "D", "V", "P"] as const;
const KIND_FILL: Record<EvolutionLine["kind"], string> = { realizado: "#6fc1e2", diagnostico: "#ef8b83", plan: "#f3d36b" };
const SEXTANTS = zoneOptions("perm").filter(z => z.group === "sextante");
const ARCH_SUP = zoneValue("perm", "arc-sup"), ARCH_INF = zoneValue("perm", "arc-inf"), MOUTH = zoneValue("perm", "boca");

/** Pieza vista desde oclusal: centro O, arriba V, abajo P/L, izquierda M, derecha D (como en la ficha en papel). */
export function ToothGlyph({ surfaces, kind, size = 22, whole = false }: { surfaces: string[]; kind: EvolutionLine["kind"]; size?: number; whole?: boolean }) {
  const fill = (s: string) => whole || surfaces.includes(s) ? KIND_FILL[kind] : "#fff";
  const stroke = "#6b6880";
  const dash = kind === "plan" ? "2 1.5" : undefined;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <polygon points="1,1 23,1 17,7 7,7" fill={fill("V")} stroke={stroke} strokeWidth="1" strokeDasharray={dash} />
    <polygon points="1,23 23,23 17,17 7,17" fill={fill("P")} stroke={stroke} strokeWidth="1" strokeDasharray={dash} />
    <polygon points="1,1 7,7 7,17 1,23" fill={fill("M")} stroke={stroke} strokeWidth="1" strokeDasharray={dash} />
    <polygon points="23,1 17,7 17,17 23,23" fill={fill("D")} stroke={stroke} strokeWidth="1" strokeDasharray={dash} />
    <rect x="7" y="7" width="10" height="10" fill={fill("O")} stroke={stroke} strokeWidth="1" strokeDasharray={dash} />
  </svg>;
}

function ZoneGlyph({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0"><path d="M3 9c0-4 4-6 9-6s9 2 9 6M3 15c0 4 4 6 9 6s9-2 9-6" fill="none" stroke="#6b6880" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

type Props = {
  lines: EvolutionLine[];
  onChange: (lines: EvolutionLine[]) => void;
  budgets: OpenBudget[];
  /** Ids de líneas que se presupuestarán al guardar. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Presupuesto destino («new» = nuevo). */
  target: string;
  onTarget: (value: string) => void;
  /** Ítems que el profesional fijó en otro estado (Iniciada/Terminada) al corregir. */
  disabled?: boolean;
  onRetooth?: (from: number, to: number) => void;
};

export function EvolutionLinesBlock({ lines, onChange, budgets, selected, onToggle, target, onTarget, disabled = false, onRetooth }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!lines.length) return null;
  const update = (id: string, patch: Partial<EvolutionLine>, recalc = true) => onChange(lines.map(line => {
    if (line.id !== id) return line;
    const next = { ...line, ...patch };
    return recalc ? refreshLine(next, budgets) : next;
  }));
  const anySelected = lines.some(line => selected.has(line.id));
  return <section className="rounded-xl border border-[#dddbe6] bg-white p-3" data-testid="evolution-lines" aria-label="Piezas de esta evolución">
    <p className="text-xs font-semibold uppercase tracking-wide text-[#615f73]">Piezas de esta evolución</p>
    <ul className="mt-2 divide-y divide-[#efedf4]">
      {lines.map(line => {
        const open = openId === line.id;
        const tone = line.state === "ok" ? "border-l-emerald-500" : "border-l-amber-400 bg-amber-50/60";
        const match = matchText(line);
        return <li key={line.id} className={`border-l-4 ${tone}`} data-testid="evolution-line" data-state={line.state}>
          <div className="flex min-h-11 items-center gap-2 px-2 py-1.5">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenId(open ? null : line.id)} aria-expanded={open}>
              {line.tooth !== null ? <ToothGlyph surfaces={line.surfaces} kind={line.kind} whole={!line.surfaces.length && line.category !== "perio"} /> : <ZoneGlyph />}
              <span className="min-w-0">
                <span className="block truncate text-sm text-[#2c2640]">{lineText(line)}</span>
                {(match || line.reason || (line.perio && line.category !== "perio")) && <span className={`block truncate text-[11px] ${line.state === "duda" ? "text-amber-800" : "text-[#615f73]"}`}>
                  {[line.perio && line.category !== "perio" ? perioText(line.perio) : "", match, line.reason ?? ""].filter(Boolean).join(" · ")}
                </span>}
              </span>
            </button>
            {line.canBudget && <button type="button" disabled={disabled} onClick={() => onToggle(line.id)} aria-pressed={selected.has(line.id)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${selected.has(line.id) ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#cfcbe0] text-[#473a6d]"}`} data-testid="line-budget">{selected.has(line.id) ? "✓ Presupuestar" : "Presupuestar"}</button>}
          </div>
          {open && <div className="space-y-3 border-t border-[#efedf4] bg-[#faf9fd] px-3 py-3" data-testid="line-detail">
            <div className="flex items-center gap-4">
              {line.tooth !== null ? <ToothGlyph surfaces={line.surfaces} kind={line.kind} size={88} whole={!line.surfaces.length && line.category !== "perio"} /> : <ZoneGlyph size={64} />}
              <div className="text-sm text-[#2c2640]">
                <p className="text-lg font-semibold">{line.tooth !== null ? `Pieza ${formatTooth(line.tooth)}` : whereText(line)}</p>
                <p>{line.prestacion}{line.code ? <span className="text-xs text-[#615f73]"> · {line.code}</span> : null}</p>
                {line.tooth !== null && line.surfaces.length > 0 && <p className="text-xs text-[#615f73]">Caras {surfacesText(line.tooth, line.surfaces)}</p>}
                {line.perio && <p className="text-xs text-[#615f73]">{perioText(line.perio)}</p>}
              </div>
            </div>
            {line.category !== "perio" && <fieldset disabled={disabled} className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <legend className="col-span-full mb-1 font-semibold text-[#473a6d]">Corregir</legend>
              {line.tooth !== null && <label className="space-y-1">Pieza<input inputMode="decimal" className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" defaultValue={formatTooth(line.tooth)} onBlur={e => {
                const m = /^([1-8])\.?([1-8])$/.exec(e.target.value.trim());
                if (!m) { e.target.value = formatTooth(line.tooth!); return; }
                const tooth = Number(m[1]) * 10 + Number(m[2]);
                if (tooth !== line.tooth) { onRetooth?.(line.tooth!, tooth); update(line.id, { tooth }); }
              }} /></label>}
              <label className="space-y-1">Tipo<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={line.kind} onChange={e => update(line.id, { kind: e.target.value as EvolutionLine["kind"] })}>
                <option value="diagnostico">Diagnóstico</option><option value="plan">Plan</option><option value="realizado">Realizado</option>
              </select></label>
              <label className="col-span-2 space-y-1">Procedimiento / diagnóstico<input className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" defaultValue={line.what} onBlur={e => { const what = e.target.value.trim(); if (what && what !== line.what) update(line.id, { what }); }} /></label>
              {line.tooth !== null && <div className="col-span-full space-y-1"><span>Caras</span><div className="flex gap-1.5">{SURFACES.map(s => {
                const on = line.surfaces.includes(s);
                const label = surfacesText(line.tooth, [s]);
                return <button key={s} type="button" aria-pressed={on} className={`size-10 rounded-md border text-sm font-semibold sm:size-9 ${on ? "border-[#473a6d] bg-[#473a6d] text-white" : "bg-white text-[#473a6d]"}`} onClick={() => update(line.id, { surfaces: on ? line.surfaces.filter(x => x !== s) : [...line.surfaces, s] })}>{label}</button>;
              })}</div></div>}
              {line.tooth === null && <div className="col-span-full space-y-1"><span>Zona</span><div className="flex flex-wrap gap-1.5">
                {[...SEXTANTS.map(z => ({ value: zoneValue("perm", z.key), label: `S${z.key.slice(-1)}` })), { value: ARCH_SUP, label: "Arc. sup" }, { value: ARCH_INF, label: "Arc. inf" }, { value: MOUTH, label: "Boca" }].map(z => {
                  const on = line.zones.includes(z.value);
                  return <button key={z.value} type="button" aria-pressed={on} className={`h-10 rounded-md border px-2.5 text-sm font-semibold sm:h-9 ${on ? "border-[#473a6d] bg-[#473a6d] text-white" : "bg-white text-[#473a6d]"}`} onClick={() => update(line.id, { zones: on ? line.zones.filter(x => x !== z.value) : [...line.zones, z.value] })}>{z.label}</button>;
                })}
              </div></div>}
              {line.kind === "realizado" && line.options && line.options.length > 1 && <label className="col-span-full space-y-1">Avanza el ítem<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={line.match ? `${line.match.budgetId}:${line.match.index}` : ""} onChange={e => {
                const pick = line.options!.find(o => `${o.budgetId}:${o.index}` === e.target.value);
                update(line.id, { match: pick, state: "ok", reason: undefined }, false);
              }}>{line.options.map(o => <option key={`${o.budgetId}:${o.index}`} value={`${o.budgetId}:${o.index}`}>{o.label} · {o.budgetTitle} ({ITEM_STATUS_LABEL[o.from]})</option>)}</select></label>}
              {line.kind === "realizado" && line.match && <label className="col-span-2 space-y-1">Queda<select className="h-10 w-full rounded-md border px-2 text-base sm:h-9 sm:text-sm" value={line.match.to} onChange={e => update(line.id, { match: { ...line.match!, to: e.target.value as ItemStatus }, manualStatus: true }, false)}>
                <option value="iniciada">Iniciada</option><option value="terminada">Terminada</option>
              </select></label>}
            </fieldset>}
          </div>}
        </li>;
      })}
    </ul>
    {anySelected && <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#615f73]">Presupuestar en
      <select disabled={disabled} className="h-10 rounded-md border px-2 text-base sm:h-8 sm:text-sm" value={target} onChange={e => onTarget(e.target.value)} data-testid="line-budget-target">
        {budgets.filter(b => b.editable !== false).map(b => <option key={b.id} value={String(b.id)}>{b.title}</option>)}
        <option value="new">Presupuesto nuevo</option>
      </select>
    </label>}
  </section>;
}
