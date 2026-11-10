"use client";
/* eslint-disable @next/next/no-img-element -- Las rutas de imágenes clínicas son autenticadas y se cargan con la sesión del navegador. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClinicalImage } from "@/app/clinical-data";
import {
  APPLIANCES, ARCH_WIRES, DIAGNOSIS_FIELDS, ELASTICS, FACIAL_SLOTS, HYGIENE, INTRAORAL_SLOTS, XRAY_TYPES,
  controlEvolutionText, emptyOrtho, orthoActive, summarizeOrtho, type DiagnosisKey, type OrthoControl, type OrthoData, type OrthoPlan, type PhotoTemplate,
} from "@/lib/orthodontics";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fdate = (iso: string) => iso ? iso.split("-").reverse().join("-") : "—";
const uid = () => crypto.randomUUID().slice(0, 12);
const SECTIONS = ["Resumen", "Fotos", "Diagnóstico", "Plan técnico", "Controles", "RX y CF"] as const;
type Section = typeof SECTIONS[number];
const RX_TYPES = ["Panorámica", "Telerradiografía lateral", "Cefalometría", "Captura CBCT", "Otra"];
const statusStyle: Record<string, string> = { "Sin plan": "bg-slate-100 text-slate-700", "En tratamiento": "bg-[#efeef4] text-[#3a2f5a]", "Atrasado": "bg-rose-50 text-rose-800", "Sin próximo control": "bg-amber-50 text-amber-800", "Finalizado": "bg-emerald-50 text-emerald-800" };
const field = "mt-1 block h-10 w-full rounded-lg border border-[#dddbe6] bg-white px-3 text-base sm:text-sm";

function Bar({ value, label }: { value: number; label: string }) {
  return <div className="h-2.5 overflow-hidden rounded-full bg-[#e6e4ee]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}><div className="h-full rounded-full bg-[linear-gradient(90deg,#473a6d,#9d93c4)]" style={{ width: `${value}%` }} /></div>;
}

export function OrthodonticsPanel({ patientId, patientName, images, onUploadImage, onRemoveImage, onAddNote, onSummaryChange }: {
  patientId: number;
  patientName: string;
  /** Fotos y radiografías de ortodoncia de este paciente. */
  images: ClinicalImage[];
  onUploadImage: (file: File, kind: "Foto ortodoncia" | "RX ortodoncia", note: string) => Promise<ClinicalImage>;
  onRemoveImage: (id: number) => Promise<void>;
  /** Registra una evolución en la historia clínica; devuelve cuando quedó guardada. */
  onAddNote: (title: string, body: string, clinicalDate: string) => Promise<void>;
  onSummaryChange?: () => void;
}) {
  const [data, setData] = useState<OrthoData>(emptyOrtho());
  const [finished, setFinished] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [section, setSection] = useState<Section>("Resumen");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<OrthoControl & { nextControlDate: string; toChart: boolean }>({ id: "", date: today(), upperArch: "", lowerArch: "", aligner: "", elastics: "", hygiene: "", notes: "", nextControlDate: "", toChart: true });
  const [rxType, setRxType] = useState(RX_TYPES[0]);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let active = true;
    setLoaded(false); setDirty(false); setError(""); setMessage("");
    void (async () => {
      try {
        const response = await fetch(`/api/orthodontics?patientId=${patientId}`, { cache: "no-store" });
        const result = await response.json() as { data?: OrthoData; finished?: boolean; error?: string };
        if (!response.ok || !result.data) throw new Error(result.error || "No se pudo leer el plan.");
        if (active) { setData(result.data); setFinished(Boolean(result.finished)); setLoaded(true); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "No se pudo leer el plan."); }
    })();
    return () => { active = false; };
  }, [patientId]);

  const persist = useCallback(async (next: OrthoData, nextFinished = finished, note = "Guardado.") => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/orthodontics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, data: next, finished: nextFinished }) });
      const result = await response.json() as { data?: OrthoData; finished?: boolean; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "No se pudo guardar.");
      setData(result.data); setFinished(Boolean(result.finished)); setDirty(false); setMessage(note);
      onSummaryChange?.();
      return result.data;
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); throw e; }
    finally { setSaving(false); }
  }, [patientId, finished, onSummaryChange]);

  const edit = (update: (current: OrthoData) => OrthoData) => { setData(update); setDirty(true); setMessage(""); };
  const summary = useMemo(() => summarizeOrtho(data, today(), finished), [data, finished]);
  const imageById = useMemo(() => new Map(images.map(image => [image.id, image])), [images]);

  if (!loaded) return <div className="surface" role="status">{error ? <p role="alert" className="text-[#a43542]">{error}</p> : "Cargando plan de ortodoncia…"}</div>;

  /* ───────── Resumen ───────── */
  const renderSummary = () => <div className="space-y-4" data-testid="ortho-summary">
    {!orthoActive(data) ? <div className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center"><p className="font-medium">Este paciente aún no tiene un plan de ortodoncia.</p><p className="mt-1 text-sm text-[#615f73]">Registra el diagnóstico y el plan técnico para activar el seguimiento de controles.</p><Button className="mt-4 bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => setSection("Plan técnico")}>Iniciar plan de ortodoncia</Button></div> : <>
      <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusStyle[summary.status]}`}>{summary.status}</span>
        {summary.status === "Atrasado" && <span className="text-sm font-medium text-rose-800">El control previsto era el {fdate(summary.nextControlDate)} ({summary.daysLate} {summary.daysLate === 1 ? "día" : "días"} de atraso).</span>}
        {summary.status === "Sin próximo control" && <span className="text-sm text-amber-800">Registra la fecha del próximo control para que el seguimiento funcione.</span>}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[#e6e4ee] p-4"><p className="text-sm font-semibold">Controles realizados</p><p className="mt-1 text-2xl font-semibold">{summary.controlsDone}{summary.plannedControls ? <span className="text-base font-normal text-[#6b6a7c]"> de {summary.plannedControls} previstos</span> : null}</p>{summary.plannedControls > 0 && <div className="mt-2"><Bar value={summary.controlsPercent} label="Controles realizados" /></div>}</div>
        <div className="rounded-xl border border-[#e6e4ee] p-4"><p className="text-sm font-semibold">Tiempo de tratamiento</p><p className="mt-1 text-2xl font-semibold">{summary.elapsedMonths}{summary.estimatedMonths ? <span className="text-base font-normal text-[#6b6a7c]"> de {summary.estimatedMonths} meses</span> : <span className="text-base font-normal text-[#6b6a7c]"> meses</span>}</p>{summary.estimatedMonths > 0 && data.plan.startDate && <div className="mt-2"><Bar value={summary.timePercent} label="Tiempo transcurrido" /></div>}</div>
      </div>
      {summary.behindSchedule && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Los controles van más lentos que el calendario previsto ({summary.controlsPercent} % de controles frente a {summary.timePercent} % del tiempo). Conviene reevaluar la planificación.</p>}
      <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-[#6b6a7c]">Inicio</dt><dd className="font-medium">{fdate(data.plan.startDate)}</dd></div><div><dt className="text-[#6b6a7c]">Término estimado</dt><dd className="font-medium">{fdate(summary.expectedEnd)}</dd></div><div><dt className="text-[#6b6a7c]">Próximo control (reevaluación)</dt><dd className="font-medium">{fdate(data.plan.nextControlDate)}</dd></div></dl>
      {data.plan.objective && <p className="text-sm"><span className="text-[#6b6a7c]">Objetivo: </span>{data.plan.objective}</p>}
      <Button variant="outline" size="sm" disabled={saving} onClick={() => void persist(data, !finished, finished ? "Tratamiento reabierto." : "Tratamiento marcado como finalizado.")}>{finished ? "Reabrir tratamiento" : "Marcar tratamiento como finalizado"}</Button>
    </>}
  </div>;

  /* ───────── Plantilla fotográfica ───────── */
  const addTemplate = () => {
    const label = data.templates.length === 0 ? "Inicial" : `Control ${data.templates.length}`;
    const template: PhotoTemplate = { id: uid(), date: today(), label, photos: {} };
    void persist({ ...data, templates: [template, ...data.templates] }, finished, "Plantilla creada.").catch(() => undefined);
  };
  const uploadPhoto = async (template: PhotoTemplate, slotKey: string, slotLabel: string, file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Usa una foto JPG, PNG o WebP."); return; }
    if (file.size > 12 * 1024 * 1024) { setError("Cada foto debe pesar menos de 12 MB."); return; }
    setError(""); setSaving(true);
    try {
      const image = await onUploadImage(file, "Foto ortodoncia", `${template.label} · ${slotLabel}`);
      const previous = template.photos[slotKey];
      const base = dataRef.current;
      await persist({ ...base, templates: base.templates.map(t => t.id === template.id ? { ...t, photos: { ...t.photos, [slotKey]: image.id } } : t) }, finished, "Foto guardada.");
      if (previous) await onRemoveImage(previous).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la foto."); setSaving(false); }
  };
  const removePhoto = async (template: PhotoTemplate, slotKey: string) => {
    const id = template.photos[slotKey];
    if (!id || !window.confirm("¿Quitar esta foto?")) return;
    const base = dataRef.current;
    const photos = { ...template.photos }; delete photos[slotKey];
    try { await persist({ ...base, templates: base.templates.map(t => t.id === template.id ? { ...t, photos } : t) }, finished, "Foto quitada."); await onRemoveImage(id); } catch { /* el error ya se muestra */ }
  };
  const removeTemplate = async (template: PhotoTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla «${template.label}» y sus ${Object.keys(template.photos).length} fotos?`)) return;
    try {
      await persist({ ...data, templates: data.templates.filter(t => t.id !== template.id) }, finished, "Plantilla eliminada.");
      for (const id of Object.values(template.photos)) await onRemoveImage(id).catch(() => undefined);
    } catch { /* el error ya se muestra */ }
  };
  const renderSlot = (template: PhotoTemplate, slot: { key: string; label: string }) => {
    const image = imageById.get(template.photos[slot.key] ?? -1);
    return <div key={slot.key} className="space-y-1" data-testid={`ortho-slot-${slot.key}`}>
      <p className="text-xs font-medium text-[#57566a]">{slot.label}</p>
      {image ? <div className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-[#dddbe6] bg-[#f7f6fa]"><a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={`${template.label} · ${slot.label}`} className="size-full object-cover" /></a><button type="button" aria-label={`Quitar foto ${slot.label}`} onClick={() => void removePhoto(template, slot.key)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-[#a43542] shadow"><Trash2 className="size-3.5" /></button></div>
        : <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#d0cadd] bg-[#f9f9fb] text-xs text-[#473a6d] hover:bg-[#efeef4]"><Camera className="size-5" aria-hidden="true" />Subir foto<input type="file" accept="image/jpeg,image/png,image/webp" capture={undefined} className="sr-only" disabled={saving} aria-label={`Subir foto ${slot.label}`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void uploadPhoto(template, slot.key, slot.label, file); }} /></label>}
    </div>;
  };
  const renderPhotos = () => <div className="space-y-5" data-testid="ortho-photos">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#615f73]">Cada plantilla tiene 10 fotos: 4 faciales y 6 intraorales. Crea una por control para comparar el avance.</p><Button size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving} onClick={addTemplate}><Plus className="mr-1 size-4" />Nueva plantilla</Button></div>
    {data.templates.length === 0 && <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Aún no hay plantillas fotográficas.</p>}
    {data.templates.map(template => <section key={template.id} className="rounded-xl border border-[#e6e4ee] p-4" aria-label={`Plantilla ${template.label}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong>{template.label}</strong><span className="text-xs text-[#6b6a7c]">{fdate(template.date)} · {Object.keys(template.photos).length}/10 fotos</span></div><button type="button" className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" aria-label={`Eliminar plantilla ${template.label}`} onClick={() => void removeTemplate(template)}><Trash2 className="size-4" /></button></div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#4f4e62]">Faciales</h4><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{FACIAL_SLOTS.map(slot => renderSlot(template, slot))}</div>
      <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[#4f4e62]">Intraorales</h4><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{INTRAORAL_SLOTS.map(slot => renderSlot(template, slot))}</div>
    </section>)}
  </div>;

  /* ───────── Diagnóstico ───────── */
  const setDiag = (key: DiagnosisKey, patch: Partial<{ value: string; notes: string }>) => edit(current => ({ ...current, diagnosis: { ...current.diagnosis, [key]: { ...current.diagnosis[key], ...patch } } }));
  const renderDiagnosis = () => <div className="space-y-4" data-testid="ortho-diagnosis">
    <p className="text-sm text-[#615f73]">Elige una opción de la lista o escribe la tuya; las listas son sugerencias.</p>
    <div className="grid gap-4 md:grid-cols-2">{DIAGNOSIS_FIELDS.map(item => <div key={item.key} className="rounded-xl border border-[#e6e4ee] p-3">
      <label className="text-sm font-medium">{item.label}<input list={`ortho-${item.key}`} maxLength={200} className={field} value={data.diagnosis[item.key].value} onChange={event => setDiag(item.key, { value: event.target.value })} placeholder="Elige o escribe" /></label>
      <datalist id={`ortho-${item.key}`}>{item.options.map(option => <option key={option} value={option} />)}</datalist>
      <Textarea rows={2} className="mt-2 text-base sm:text-sm" maxLength={2000} aria-label={`Notas de ${item.label}`} placeholder="Notas" value={data.diagnosis[item.key].notes} onChange={event => setDiag(item.key, { notes: event.target.value })} />
    </div>)}</div>
    {saveBar()}
  </div>;

  /* ───────── Plan técnico ───────── */
  const setPlan = (patch: Partial<OrthoPlan>) => edit(current => ({ ...current, plan: { ...current.plan, ...patch } }));
  const renderPlan = () => <div className="space-y-4" data-testid="ortho-plan">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm font-medium">Fecha de inicio<Input type="date" className={field} value={data.plan.startDate} onChange={event => setPlan({ startDate: event.target.value })} /></label>
      <label className="text-sm font-medium">Duración estimada (meses)<Input type="number" inputMode="numeric" min="0" max="120" className={field} value={data.plan.estimatedMonths || ""} onChange={event => setPlan({ estimatedMonths: Number(event.target.value) || 0 })} placeholder="18" /></label>
      <label className="text-sm font-medium">Cantidad de controles previstos<Input type="number" inputMode="numeric" min="0" max="200" className={field} value={data.plan.plannedControls || ""} onChange={event => setPlan({ plannedControls: Number(event.target.value) || 0 })} placeholder="18" /></label>
      <label className="text-sm font-medium">Tipo de radiografía<select className={field} value={data.plan.xrayType} onChange={event => setPlan({ xrayType: event.target.value })}><option value="">Sin indicar</option>{XRAY_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <label className="text-sm font-medium">Cementación superior<Input type="date" className={field} value={data.plan.cementationUpper} onChange={event => setPlan({ cementationUpper: event.target.value })} /></label>
      <label className="text-sm font-medium">Cementación inferior<Input type="date" className={field} value={data.plan.cementationLower} onChange={event => setPlan({ cementationLower: event.target.value })} /></label>
      <label className="text-sm font-medium">Próximo control<Input type="date" className={field} value={data.plan.nextControlDate} onChange={event => setPlan({ nextControlDate: event.target.value })} /></label>
    </div>
    <fieldset><legend className="text-sm font-medium">Aparatología</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{APPLIANCES.map(name => <label key={name} className="flex items-center gap-2 rounded-lg border border-[#e6e4ee] px-3 py-2 text-sm"><input type="checkbox" className="size-4 accent-[#473a6d]" checked={data.plan.appliances.includes(name)} onChange={event => setPlan({ appliances: event.target.checked ? [...data.plan.appliances, name] : data.plan.appliances.filter(item => item !== name) })} />{name}</label>)}</div>
      <label className="mt-3 block text-sm font-medium">Otra aparatología<Input maxLength={120} className={field} value={data.plan.otherAppliance} onChange={event => setPlan({ otherAppliance: event.target.value })} /></label></fieldset>
    <label className="block text-sm font-medium">Objetivo del tratamiento<Textarea rows={3} maxLength={2000} className="mt-1 text-base sm:text-sm" value={data.plan.objective} onChange={event => setPlan({ objective: event.target.value })} /></label>
    {saveBar()}
  </div>;

  /* ───────── Controles ───────── */
  const saveControl = async () => {
    if (!draft.date || draft.date > today()) { setError("Indica la fecha del control; no puede ser futura."); return; }
    const control: OrthoControl = { id: uid(), date: draft.date, upperArch: draft.upperArch, lowerArch: draft.lowerArch, aligner: draft.aligner, elastics: draft.elastics, hygiene: draft.hygiene, notes: draft.notes };
    const next: OrthoData = { ...dataRef.current, controls: [control, ...dataRef.current.controls].sort((a, b) => b.date.localeCompare(a.date)), plan: { ...dataRef.current.plan, nextControlDate: draft.nextControlDate || "" } };
    try {
      await persist(next, finished, "Control guardado.");
      if (draft.toChart) await onAddNote(`Control de ortodoncia · ${patientName.split(" ")[0]}`, controlEvolutionText(control, draft.nextControlDate), control.date);
      setMessage(draft.toChart ? "Control guardado y registrado en la historia clínica." : "Control guardado.");
      setDraft({ ...draft, upperArch: "", lowerArch: "", aligner: "", elastics: "", hygiene: "", notes: "", nextControlDate: "" });
    } catch (e) { if (e instanceof Error && !error) setError(e.message); }
  };
  const removeControl = (control: OrthoControl) => {
    if (!window.confirm(`¿Eliminar el control del ${fdate(control.date)}? La evolución ya registrada en la historia clínica no se modifica.`)) return;
    void persist({ ...data, controls: data.controls.filter(item => item.id !== control.id) }, finished, "Control eliminado.").catch(() => undefined);
  };
  const renderControls = () => <div className="space-y-5" data-testid="ortho-controls">
    <div className="rounded-xl border border-[#e6e4ee] bg-[#f9f9fb] p-4">
      <h3 className="font-semibold">Nuevo control</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-medium">Fecha<Input type="date" className={field} value={draft.date} max={today()} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
        <label className="text-sm font-medium">Arco superior<input list="ortho-arcos" className={field} value={draft.upperArch} onChange={event => setDraft({ ...draft, upperArch: event.target.value })} placeholder="0.016 NiTi" /></label>
        <label className="text-sm font-medium">Arco inferior<input list="ortho-arcos" className={field} value={draft.lowerArch} onChange={event => setDraft({ ...draft, lowerArch: event.target.value })} placeholder="0.016 NiTi" /></label>
        <label className="text-sm font-medium">Alineador (n.º / total)<Input maxLength={80} className={field} value={draft.aligner} onChange={event => setDraft({ ...draft, aligner: event.target.value })} placeholder="5/24" /></label>
        <label className="text-sm font-medium">Elásticos<select className={field} value={draft.elastics} onChange={event => setDraft({ ...draft, elastics: event.target.value })}><option value="">Sin indicar</option>{ELASTICS.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm font-medium">Higiene<select className={field} value={draft.hygiene} onChange={event => setDraft({ ...draft, hygiene: event.target.value })}><option value="">Sin indicar</option>{HYGIENE.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm font-medium">Próximo control<Input type="date" className={field} value={draft.nextControlDate} onChange={event => setDraft({ ...draft, nextControlDate: event.target.value })} /></label>
      </div>
      <datalist id="ortho-arcos">{ARCH_WIRES.map(item => <option key={item} value={item} />)}</datalist>
      <label className="mt-3 block text-sm font-medium">Observaciones<Textarea rows={3} maxLength={4000} className="mt-1 text-base sm:text-sm" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Activaciones, ajustes, indicaciones…" /></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#473a6d]" checked={draft.toChart} onChange={event => setDraft({ ...draft, toChart: event.target.checked })} />Registrar también como evolución en la historia clínica</label>
      <Button className="mt-3 bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving} onClick={() => void saveControl()} data-testid="ortho-control-save">{saving ? "Guardando…" : "Guardar control"}</Button>
    </div>
    {data.controls.length === 0 ? <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Aún no hay controles registrados.</p> :
      <ul className="space-y-2">{data.controls.map((control, index) => <li key={control.id} className="rounded-xl border border-[#e6e4ee] p-3 text-sm">
        <div className="flex items-start justify-between gap-3"><div><strong>Control {data.controls.length - index}</strong><span className="ml-2 text-[#6b6a7c]">{fdate(control.date)}</span></div><button type="button" aria-label={`Eliminar control del ${fdate(control.date)}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => removeControl(control)}><Trash2 className="size-4" /></button></div>
        <p className="mt-1 text-[#57566a]">{[control.upperArch && `Sup.: ${control.upperArch}`, control.lowerArch && `Inf.: ${control.lowerArch}`, control.aligner && `Alineador ${control.aligner}`, control.elastics && control.elastics !== "Ninguno" && `Elásticos ${control.elastics}`, control.hygiene && `Higiene ${control.hygiene.toLowerCase()}`].filter(Boolean).join(" · ") || "Sin cambios de aparatología"}</p>
        {control.notes && <p className="mt-1">{control.notes}</p>}
      </li>)}</ul>}
  </div>;

  /* ───────── RX y CF ───────── */
  const rxImages = images.filter(image => image.kind === "RX ortodoncia");
  const uploadRx = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) { setError("Usa JPG, PNG, WebP o PDF."); return; }
    if (file.size > 12 * 1024 * 1024) { setError("Cada archivo debe pesar menos de 12 MB."); return; }
    setError(""); setSaving(true);
    try { await onUploadImage(file, "RX ortodoncia", rxType); setMessage("Archivo guardado."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el archivo."); } finally { setSaving(false); }
  };
  const renderRx = () => <div className="space-y-4" data-testid="ortho-rx">
    <p className="text-sm text-[#615f73]">Radiografías y cefalometrías de este tratamiento, separadas de las demás imágenes de la ficha.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Tipo<select className={field + " min-w-56"} value={rxType} onChange={event => setRxType(event.target.value)}>{RX_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <label className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a]">Subir archivo<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={saving} aria-label="Subir radiografía o cefalometría" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void uploadRx(file); }} /></label></div>
    {rxImages.length === 0 ? <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Aún no hay radiografías ni cefalometrías.</p> :
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rxImages.map(image => <div key={image.id} className="overflow-hidden rounded-xl border border-[#e6e4ee]">
        {image.contentType === "application/pdf" ? <a href={image.url} target="_blank" rel="noreferrer" className="flex aspect-[4/3] items-center justify-center bg-[#f7f6fa] text-sm font-medium text-[#473a6d]">Abrir PDF</a> : <a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={`${image.note} · ${image.name}`} className="aspect-[4/3] w-full object-cover" /></a>}
        <div className="flex items-center justify-between gap-2 p-2.5 text-sm"><span><strong>{image.note || "Radiografía"}</strong><span className="block text-xs text-[#6b6a7c]">{image.addedAt}</span></span><button type="button" aria-label={`Quitar ${image.note || "archivo"}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => { if (window.confirm("¿Quitar este archivo?")) void onRemoveImage(image.id).catch(e => setError(e instanceof Error ? e.message : "No se pudo quitar.")); }}><Trash2 className="size-4" /></button></div>
      </div>)}</div>}
  </div>;

  function saveBar() {
    return <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-xl border border-[#e6e4ee] bg-white/95 p-3 shadow-sm backdrop-blur">
      <Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving || !dirty} onClick={() => void persist(data).catch(() => undefined)} data-testid="ortho-save">{saving ? "Guardando…" : "Guardar cambios"}</Button>
      {dirty && <span className="text-sm text-amber-800">Hay cambios sin guardar.</span>}
    </div>;
  }

  return <div className="surface space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Ortodoncia</h3><p className="mt-1 text-sm text-[#615f73]">Diagnóstico, plan técnico, fotos y controles del tratamiento.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[summary.status]}`}>{summary.status}</span></div>
    <div role="tablist" aria-label="Secciones de ortodoncia" className="flex gap-1 overflow-x-auto rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-1">{SECTIONS.map(name => <button key={name} type="button" role="tab" aria-selected={section === name} onClick={() => setSection(name)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${section === name ? "bg-white text-[#473a6d] shadow-sm" : "text-[#615f73]"}`}>{name}</button>)}</div>
    {error && <p role="alert" className="text-sm font-medium text-[#a43542]">{error}</p>}
    {message && !error && <p role="status" className="text-sm font-medium text-[#3a2f5a]">{message}</p>}
    {section === "Resumen" && renderSummary()}
    {section === "Fotos" && renderPhotos()}
    {section === "Diagnóstico" && renderDiagnosis()}
    {section === "Plan técnico" && renderPlan()}
    {section === "Controles" && renderControls()}
    {section === "RX y CF" && renderRx()}
  </div>;
}
