"use client";

import { useState } from "react";
import { PRICE_UNIT_LABEL, parseZone, priceUnitFromName, suggestedZoneKind, zoneFixesTeeth, zoneOptions, zoneTeeth, zoneValue, type Dentition, type ZoneGroup } from "@/lib/treatment-zones";
import { formatFdiTooth, fdiToChile, parseTeethInput, teethHintsFromLabel, type ToothNumbering } from "@/lib/tooth-numbering";
import { itemWhereText, type BudgetItem } from "@/lib/budget-plans";

type Kind = "piezas" | "boca" | "parcial" | "arc-sup" | "arc-inf" | "cuadrante" | "sextante" | "grupo";
const KINDS: Array<{ kind: Kind; text: string }> = [
  { kind: "piezas", text: "Piezas" }, { kind: "boca", text: "Boca completa" }, { kind: "parcial", text: "Boca parcial" },
  { kind: "arc-sup", text: "Arcada superior" }, { kind: "arc-inf", text: "Arcada inferior" },
  { kind: "cuadrante", text: "Cuadrante" }, { kind: "sextante", text: "Sextante" }, { kind: "grupo", text: "Grupo" },
];
const GROUP_OF: Partial<Record<Kind, ZoneGroup>> = { cuadrante: "cuadrante", sextante: "sextante", grupo: "grupo" };
const chip = (active: boolean) => "min-h-9 rounded-full border px-3 text-sm " + (active ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#dddbe6] bg-white text-[#35343f] hover:bg-[#efeef4]");

function kindOf(zone: string | undefined): Kind {
  const parsed = parseZone(zone);
  if (!parsed) return "piezas";
  const key = parsed.option.key;
  if (key === "boca" || key === "parcial" || key === "arc-sup" || key === "arc-inf") return key;
  return parsed.option.group === "cuadrante" ? "cuadrante" : parsed.option.group === "sextante" ? "sextante" : "grupo";
}

/**
 * «¿Dónde se trabaja?» de una prestación, siempre visible: piezas sueltas (FDI o chilena), boca completa o parcial,
 * arcada, cuadrante, sextante o grupo de piezas, y un detalle libre. Muestra la línea tal como saldrá en el plan y el PDF.
 */
export function WherePicker({ item, onChange }: { item: BudgetItem; onChange: (patch: Partial<BudgetItem>) => void }) {
  const current = parseZone(item.zone);
  const [dentition, setDentition] = useState<Dentition>(current?.dentition ?? "perm");
  const [kind, setKind] = useState<Kind>(kindOf(item.zone));
  const [numbering, setNumbering] = useState<ToothNumbering>("fdi");
  const [draft, setDraft] = useState<string | null>(null);
  const unit = priceUnitFromName(item.label);
  const suggested = suggestedZoneKind(unit);
  const teeth = item.teeth ?? [];
  const showTeeth = kind === "piezas" || kind === "parcial";
  const hints = !teeth.length && showTeeth ? teethHintsFromLabel(item.label) : { fdi: [], chile: [] };
  const typed = teeth.map(t => numbering === "fdi" ? formatFdiTooth(t) : fdiToChile(t)).join(", ");

  const setZone = (key: string | undefined, d: Dentition = dentition) => {
    if (!key) { onChange({ zone: undefined, teeth: kind === "piezas" ? item.teeth : undefined }); return; }
    const zone = zoneValue(d, key);
    onChange(zoneFixesTeeth(zone) ? { zone, teeth: zoneTeeth(zone) } : { zone, teeth: item.zone && zoneFixesTeeth(item.zone) ? undefined : item.teeth });
  };
  const pickKind = (next: Kind) => {
    setKind(next); setDraft(null);
    if (next === "piezas") onChange({ zone: undefined, teeth: item.zone && zoneFixesTeeth(item.zone) ? undefined : item.teeth });
    else if (!GROUP_OF[next]) setZone(next);
    else if (current?.option.group !== GROUP_OF[next]) onChange({ zone: undefined, teeth: undefined });
  };
  const commitTeeth = (text: string) => {
    setDraft(null);
    const parsed = parseTeethInput(text, numbering);
    if (parsed.join() !== teeth.join()) onChange({ teeth: parsed.length ? parsed : undefined });
  };
  const options = zoneOptions(dentition).filter(o => GROUP_OF[kind] && o.group === GROUP_OF[kind]);
  const summary = itemWhereText(item);

  return <div className="space-y-2 rounded-lg border border-[#e6e4ee] bg-white p-3 text-sm sm:col-span-2" data-testid="where-picker">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium text-[#35343f]">¿Dónde se trabaja?</span>
      <div role="group" aria-label="Dentición" className="flex gap-1 rounded-lg bg-[#efeef4] p-1 text-xs font-semibold">
        {([["perm", "Permanente"], ["temp", "Temporal"]] as const).map(([key, text]) => <button key={key} type="button" aria-pressed={dentition === key} onClick={() => { setDentition(key); if (current && !current.option.usesTeeth) { const same = zoneOptions(key).find(o => o.key === current.option.key); setZone(same?.key, key); } }} className={"rounded-md px-2 py-1 " + (dentition === key ? "bg-white text-[#473a6d] shadow-sm" : "text-[#6b6a7c]")}>{text}</button>)}
      </div>
    </div>
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de zona">
      {KINDS.map(({ kind: k, text }) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => pickKind(k)} className={chip(kind === k) + (suggested && GROUP_OF[k] === suggested && kind !== k ? " ring-2 ring-[#ef895f]/50" : "")}>{text}</button>)}
    </div>
    {unit && <p className="text-xs text-[#6b6a7c]">Tu arancel se cobra {PRICE_UNIT_LABEL[unit].toLowerCase()}.</p>}
    {options.length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="Zona">
      {options.map(o => { const active = current?.option.key === o.key && current.dentition === dentition; return <button key={o.key} type="button" aria-pressed={active} onClick={() => setZone(active ? undefined : o.key)} className={chip(active)} title={o.range}>{o.label}<span className={"ml-1 text-xs " + (active ? "text-white/80" : "text-[#6b6a7c]")}>{o.range}</span></button>; })}
    </div>}
    {showTeeth && <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#4f4e62]">Escribo en</span>
        <div role="group" aria-label="Numeración" className="flex gap-1 rounded-lg bg-[#efeef4] p-1 text-xs font-semibold">
          {([["fdi", "FDI (1.4)"], ["chile", "Chilena (5)"]] as const).map(([key, text]) => <button key={key} type="button" aria-pressed={numbering === key} onClick={() => { setNumbering(key); setDraft(null); }} className={"rounded-md px-2 py-1 " + (numbering === key ? "bg-white text-[#473a6d] shadow-sm" : "text-[#6b6a7c]")} data-testid={`numbering-${key}`}>{text}</button>)}
        </div>
      </div>
      <input aria-label="Piezas" inputMode="text" maxLength={120} value={draft ?? typed} onChange={e => setDraft(e.target.value)} onBlur={e => commitTeeth(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitTeeth((e.target as HTMLInputElement).value); } }} placeholder={numbering === "fdi" ? "Ej.: 1.4, 1.5, 3.6" : "Ej.: 5, 4, 30 · temporales con letra: C, H"} className="block min-h-10 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base sm:text-sm" data-testid="teeth-input"/>
      {teeth.length > 0 && <div className="flex flex-wrap gap-1">{teeth.map(t => <span key={t} className="rounded bg-[#efeef4] px-1.5 py-0.5 text-[11px] font-semibold text-[#3a2f5a]">{formatFdiTooth(t)} <span className="font-normal text-[#6b6a7c]">· Ch. {fdiToChile(t)}</span></span>)}</div>}
      {(hints.fdi.length > 0 || hints.chile.length > 0) && <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#fff7ed] p-2 text-xs text-[#7c3a16]" data-testid="teeth-hints">
        <span>El nombre menciona piezas. ¿Cuáles son?</span>
        {hints.fdi.length > 0 && <button type="button" className="rounded-full border border-[#f0b49a] bg-white px-2 py-1 font-semibold" onClick={() => onChange({ teeth: hints.fdi })}>FDI {hints.fdi.map(formatFdiTooth).join(", ")}</button>}
        {hints.chile.length > 0 && hints.chile.join() !== hints.fdi.join() && <button type="button" className="rounded-full border border-[#f0b49a] bg-white px-2 py-1 font-semibold" onClick={() => onChange({ teeth: hints.chile })}>Chile {hints.chile.map(fdiToChile).join(", ")} = FDI {hints.chile.map(formatFdiTooth).join(", ")}</button>}
      </div>}
    </div>}
    <label className="block space-y-1 text-xs font-semibold text-[#4f4e62]">Detalle (opcional)
      <input maxLength={160} value={item.area ?? ""} onChange={e => onChange({ area: e.target.value || undefined })} placeholder="Ej.: sitios con sacos > 4 mm · zona edéntula 3.5–3.7 · todas las piezas presentes" className="block min-h-10 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base font-normal sm:text-sm" data-testid="where-detail"/>
    </label>
    <p className="text-xs text-[#6b6a7c]" data-testid="where-summary">En el plan y el PDF: <strong className="text-[#3a2f5a]">{summary || "sin indicar"}</strong>{item.teeth?.length ? " · se marca en el odontograma" : ""}</p>
  </div>;
}
