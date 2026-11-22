"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APICAL_STATUSES, FRACTURE_STATUSES } from "@/lib/tooth-status";
import { CROWN_MATERIALS, EVOLVE_MATERIALS, KIND_LABEL, evolveProblem, type EvolveInput } from "@/lib/tooth-evolve";
import { faceName } from "@/lib/tooth-story";
import { formatFdi, type OdontogramSurface, type SurfaceFinding } from "@/app/clinical-data";

const FACES: OdontogramSurface[] = ["V", "P", "M", "D", "O"];
const fieldClass = "mt-1 block h-10 w-full rounded-lg border border-[#d8d3e3] bg-white px-3 text-sm";

/** Botón + formulario para evolucionar la pieza a mano (qué se hizo y cuándo). */
export function ToothEvolve({ tooth, surfaces, today, onEvolve, disabled }: {
  tooth: number; surfaces: Partial<Record<OdontogramSurface, SurfaceFinding>>; today: string; disabled?: boolean;
  onEvolve: (input: EvolveInput, date: string, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EvolveInput["kind"]>("obturacion");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [faces, setFaces] = useState<OdontogramSurface[] | null>(null);
  const [material, setMaterial] = useState("Resina compuesta");
  const [crownMaterial, setCrownMaterial] = useState("Zirconio");
  const [implantStatus, setImplantStatus] = useState<"Implante" | "Implante con pilar">("Implante");
  const [withCrown, setWithCrown] = useState(false);
  const [reason, setReason] = useState<"caries" | "other" | "unknown">("unknown");
  const [lesion, setLesion] = useState<string>(APICAL_STATUSES[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const cariesFaces = FACES.filter(face => surfaces[face]?.condition === "caries");
  const chosenFaces = faces ?? cariesFaces;

  const build = (): EvolveInput => {
    switch (kind) {
      case "obturacion": return { kind, surfaces: chosenFaces, material };
      case "corona": return { kind, material: crownMaterial };
      case "implante": return { kind, status: implantStatus, ...(withCrown ? { crownMaterial } : {}) };
      case "extraccion": return { kind, reason };
      case "lesion": return { kind, status: lesion };
      default: return { kind: "nota" };
    }
  };
  const save = async () => {
    const input = build(), problem = evolveProblem(input, note, date, today);
    if (problem) { setMessage(problem); return; }
    setSaving(true); setMessage("");
    try { await onEvolve(input, date, note); setOpen(false); setNote(""); setFaces(null); setDate(today); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo guardar la evolución."); }
    finally { setSaving(false); }
  };
  return <>
    <button type="button" data-testid="evolve-open" disabled={disabled} onClick={() => { setMessage(""); setOpen(true); }} className="h-8 rounded-lg border border-[#473a6d] bg-white px-3 text-xs font-semibold text-[#473a6d] hover:bg-[#f3f1f8] disabled:opacity-50">+ Evolucionar pieza</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto bg-white" data-testid="evolve-dialog">
        <DialogHeader><DialogTitle>Evolucionar pieza FDI {formatFdi(tooth)}</DialogTitle><DialogDescription>Registra qué se hizo y cuándo. Queda como una etapa nueva en la película de la pieza; las anteriores se conservan.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block text-xs font-medium text-[#57566a]">¿Qué se hizo?
            <select data-testid="evolve-kind" value={kind} onChange={e => setKind(e.target.value as EvolveInput["kind"])} className={fieldClass}>{(Object.keys(KIND_LABEL) as EvolveInput["kind"][]).map(item => <option key={item} value={item}>{KIND_LABEL[item]}</option>)}</select>
          </label>
          {kind === "obturacion" && <>
            <fieldset className="text-xs font-medium text-[#57566a]"><legend>Caras obturadas{cariesFaces.length ? " (marcadas las que tienen caries)" : ""}</legend><div className="mt-1 flex flex-wrap gap-2">{FACES.map(face => <label key={face} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${chosenFaces.includes(face) ? "border-[#473a6d] bg-[#efeaf8]" : "border-[#dddbe6]"}`}><input type="checkbox" checked={chosenFaces.includes(face)} onChange={e => setFaces(e.target.checked ? [...chosenFaces, face] : chosenFaces.filter(item => item !== face))} />{faceName(face, tooth)}</label>)}</div></fieldset>
            <label className="block text-xs font-medium text-[#57566a]">Material<select value={material} onChange={e => setMaterial(e.target.value)} className={fieldClass}>{EVOLVE_MATERIALS.map(item => <option key={item}>{item}</option>)}</select></label>
          </>}
          {kind === "corona" && <label className="block text-xs font-medium text-[#57566a]">Material de la corona<select value={crownMaterial} onChange={e => setCrownMaterial(e.target.value)} className={fieldClass}>{CROWN_MATERIALS.map(item => <option key={item}>{item}</option>)}</select></label>}
          {kind === "implante" && <>
            <label className="block text-xs font-medium text-[#57566a]">Etapa del implante<select value={implantStatus} onChange={e => setImplantStatus(e.target.value as "Implante" | "Implante con pilar")} className={fieldClass}><option value="Implante">Implante (sumergido o con corona)</option><option value="Implante con pilar">Implante con pilar, sin corona</option></select></label>
            <label className="flex items-center gap-2 text-xs font-medium text-[#57566a]"><input type="checkbox" checked={withCrown} onChange={e => setWithCrown(e.target.checked)} />Ya tiene corona sobre el implante</label>
            {withCrown && <label className="block text-xs font-medium text-[#57566a]">Material de la corona<select value={crownMaterial} onChange={e => setCrownMaterial(e.target.value)} className={fieldClass}>{CROWN_MATERIALS.map(item => <option key={item}>{item}</option>)}</select></label>}
          </>}
          {kind === "extraccion" && <label className="block text-xs font-medium text-[#57566a]">Causa de la pérdida<select value={reason} onChange={e => setReason(e.target.value as typeof reason)} className={fieldClass}><option value="unknown">Sin registrar</option><option value="caries">Caries</option><option value="other">Otra causa</option></select></label>}
          {kind === "lesion" && <label className="block text-xs font-medium text-[#57566a]">Lesión<select value={lesion} onChange={e => setLesion(e.target.value)} className={fieldClass}><optgroup label="Lesiones apicales">{APICAL_STATUSES.map(item => <option key={item}>{item}</option>)}</optgroup><optgroup label="Fracturas">{FRACTURE_STATUSES.map(item => <option key={item}>{item}</option>)}</optgroup></select></label>}
          <label className="block text-xs font-medium text-[#57566a]">Fecha en que se hizo<input type="date" data-testid="evolve-date" value={date} max={today} onChange={e => setDate(e.target.value)} className={fieldClass} /></label>
          <label className="block text-xs font-medium text-[#57566a]">{kind === "nota" ? "Evolución" : "Nota (opcional)"}<textarea data-testid="evolve-note" value={note} maxLength={kind === "nota" ? 400 : 300} onChange={e => setNote(e.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-[#d8d3e3] bg-white px-3 py-2 text-sm" /></label>
          {message && <p role="alert" className="text-xs font-medium text-rose-700">{message}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg border border-[#d8d3e3] px-4 text-sm font-medium text-[#473a6d]">Cancelar</button><button type="button" data-testid="evolve-save" disabled={saving} onClick={() => void save()} className="h-10 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar evolución"}</button></div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
