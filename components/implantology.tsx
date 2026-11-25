"use client";
/* eslint-disable @next/next/no-img-element -- Las imágenes clínicas son rutas autenticadas que se cargan con la sesión del navegador. */
/**
 * Pestaña «Implantología»: implantograma, una ficha por implante, su etiqueta y sus cortes (pegar, arrastrar o subir).
 * La app propone fichas desde las etiquetas y el odontograma; nada se guarda sin que el profesional confirme.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Download, ImagePlus, LoaderCircle, Plus, ScanLine, Trash2, X } from "lucide-react";
import type { ClinicalImage } from "@/app/clinical-data";
import { BiomedicalProducts, type ProductTool, type ProductView } from "@/components/biomedical-products";
import { CaptureLink } from "@/components/capture-link";
import { thumbUrl } from "@/lib/image-compress";
import { IMPLANT_BRANDS } from "@/lib/dictation/implant-brands";
import {
  COMMON_DIAMETERS, COMMON_LENGTHS, IMPLANT_PHASES, IMPLANT_VIEWS, LOWER_ARCH, UPPER_ARCH,
  imageKindForView, implantSuggestions, implantSummary, labelMeasures, mm, phaseLabel,
  type Implant, type ImplantFields, type ImplantLabel, type ImplantView,
} from "@/lib/implants";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayLabel = (iso: string) => iso.split("-").reverse().join("-");
const fdi = (code: number) => `${Math.floor(code / 10)}.${code % 10}`;
const BRANDS = [...new Set(IMPLANT_BRANDS.map(item => item.brand))].sort((a, b) => a.localeCompare(b, "es"));

type Draft = { id: number | null; tooth: string; phase: string; brand: string; system: string; diameter: string; length: string; placedOn: string; torque: string; isq: string; productId: string; note: string };
const toDraft = (item: Partial<ImplantFields> & { id?: number }): Draft => ({
  id: item.id ?? null, tooth: item.tooth ?? "", phase: item.phase ?? "", brand: item.brand ?? "", system: item.system ?? "",
  diameter: mm(item.diameter ?? null), length: mm(item.length ?? null), placedOn: item.placedOn ?? "",
  torque: item.torque == null ? "" : String(item.torque), isq: item.isq == null ? "" : String(item.isq),
  productId: item.productId ? String(item.productId) : "", note: item.note ?? "",
});

const PHASE_COLOR: Record<string, string> = {
  "": "border-[#473a6d] bg-[#e6e4ee] text-[#2a2540]", evaluacion: "border-slate-500 bg-slate-100 text-slate-800", plan: "border-sky-600 bg-sky-100 text-sky-900",
  cirugia: "border-rose-600 bg-rose-100 text-rose-900", osteointegracion: "border-amber-600 bg-amber-100 text-amber-900",
  rehabilitacion: "border-violet-600 bg-violet-100 text-violet-900", mantencion: "border-emerald-600 bg-emerald-100 text-emerald-900",
};
const input = "mt-1 block min-h-11 w-full rounded-lg border border-[#d8d5e4] bg-white px-3 text-base";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";
const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm font-medium ${on ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d8d5e4] bg-white text-[#473a6d]"}`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar. Intenta otra vez.");
  return data;
}
const send = <T,>(method: "POST" | "PATCH", body: unknown) => call<T>("/api/implantes", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Pone una etiqueta en la ficha: completa lo vacío o lo que venía de la etiqueta anterior; lo escrito por el profesional no se pisa. */
function withLabel(draft: Draft, old: ImplantLabel | undefined, label: ImplantLabel): Draft {
  const fill = (now: string, from: string | undefined, to: string) => !now || now === from ? to : now;
  const before = old && labelMeasures(old), after = labelMeasures(label);
  return { ...draft, productId: String(label.id), brand: fill(draft.brand, old?.brand, label.brand), placedOn: fill(draft.placedOn, old?.placedOn, label.placedOn),
    diameter: fill(draft.diameter, before && mm(before.diameter), mm(after.diameter)), length: fill(draft.length, before && mm(before.length), mm(after.length)) };
}

export function ImplantologyPanel({ patient, teeth, crowns, images, showCapturer, onUploadImage, onRemoveImage, onImageGone, onChanged }: {
  patient: { id: number; name: string };
  /** Estados del odontograma actual: de ahí salen las propuestas de fichas. */
  teeth: Record<number, string>;
  crowns?: Record<number, { foundation?: string }>;
  images: ClinicalImage[];
  /** La capturadora de prueba (sin firmar) por ahora solo la ve el desarrollador. */
  showCapturer: boolean;
  onUploadImage: (file: File, kind: "Radiografía" | "Captura CBCT" | "Producto biomédico", note: string) => Promise<ClinicalImage>;
  onRemoveImage: (id: number) => Promise<void>;
  /** La foto de una etiqueta se borró junto con su producto. */
  onImageGone: (id: number) => void;
  onChanged: () => void;
}) {
  const [implants, setImplants] = useState<Implant[] | null>(null);
  const [labels, setLabels] = useState<ImplantLabel[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [view, setView] = useState<ImplantView>("Transversal");
  const [busy, setBusy] = useState<"" | "saving" | "image">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<ClinicalImage | null>(null);
  const [windows, setWindows] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const working = useRef(false);
  /** Cambia cada vez que se abre o cierra una ficha: una respuesta tardía no pisa la que está en pantalla. */
  const session = useRef(0);

  useEffect(() => { setWindows(/Windows/i.test(navigator.userAgent)); }, []);
  const load = useCallback(async () => {
    try {
      const data = await call<{ implants: Implant[]; labels: ImplantLabel[] }>(`/api/implantes?patientId=${patient.id}`, { cache: "no-store" });
      setImplants(data.implants); setLabels(data.labels); setError("");
      return data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudieron cargar los implantes."); return null; }
  }, [patient.id]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const current = draft?.id ? implants?.find(item => item.id === draft.id) ?? null : null;
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  const show = (next: Draft | null) => {
    if (dirty && !window.confirm("Hay cambios sin guardar en este implante. ¿Descartarlos?")) return;
    session.current++;
    setDraft(next); setBaseline(next ? JSON.stringify(next) : ""); setError(""); setNotice("");
    if (next) requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  /** Etiqueta que puso la aplicación al abrir la ficha nueva (no elegida a mano): una recién registrada la reemplaza. */
  const autoLabel = useRef("");
  /** Ficha nueva: si hay una etiqueta de esa pieza sin usar, viene prellenada. */
  const startNew = (tooth: string, extra: Partial<ImplantFields> = {}) => {
    const used = new Set((implants ?? []).map(item => item.productId));
    const label = labels.find(item => item.tooth === tooth && !used.has(item.id));
    const next = toDraft({ tooth, ...(label ? { brand: label.brand, placedOn: label.placedOn, productId: label.id, phase: "cirugia", ...labelMeasures(label) } : {}), ...extra });
    autoLabel.current = next.productId;
    show(next);
  };

  const set = (key: keyof Draft, value: string) => setDraft(previous => previous ? { ...previous, [key]: value } : previous);
  const chooseLabel = (value: string) => {
    autoLabel.current = "";
    setDraft(previous => {
      if (!previous) return previous;
      const label = labels.find(item => String(item.id) === value);
      return label ? withLabel(previous, labels.find(item => String(item.id) === previous.productId), label) : { ...previous, productId: value };
    });
  };

  const save = async () => {
    if (!draft || busy) return;
    setBusy("saving"); setError("");
    const opened = session.current;
    try {
      const { id, ...fields } = draft;
      const { implant } = await send<{ implant: Implant }>(id ? "PATCH" : "POST", { ...fields, ...(id ? { id } : { patientId: patient.id }) });
      setImplants(previous => {
        const kept = (previous ?? []).filter(item => item.id !== implant.id);
        return [...kept, implant].sort((a, b) => a.tooth.localeCompare(b.tooth) || a.id - b.id);
      });
      const next = toDraft(implant);
      // Si mientras se guardaba se abrió otra ficha, no se reemplaza lo que hay en pantalla.
      if (session.current === opened) {
        // Lo que se haya escrito mientras se guardaba se conserva como cambio pendiente.
        setDraft(previous => previous && previous !== draft ? { ...previous, id: next.id } : next); setBaseline(JSON.stringify(next));
      }
      setNotice(id ? `Cambios guardados en el implante ${implant.tooth}.` : `Implante ${implant.tooth} guardado. Ya puedes pegar o subir sus imágenes.`);
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el implante."); }
    finally { setBusy(""); }
  };

  const remove = async () => {
    if (!draft?.id || busy) return;
    if (!window.confirm(`¿Desea eliminar la ficha del implante ${draft.tooth}? Sus imágenes y su etiqueta seguirán en la ficha del paciente.`)) return;
    setError("");
    try {
      await call("/api/implantes?id=" + draft.id, { method: "DELETE" });
      setImplants(previous => (previous ?? []).filter(item => item.id !== draft.id));
      setDraft(null); setBaseline(""); setNotice("Ficha del implante eliminada."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar el implante."); }
  };

  const addFiles = useCallback(async (files: File[], as: ImplantView = view): Promise<"saved" | "busy" | "failed"> => {
    const target = current;
    if (working.current) return "busy";
    if (!files.length) return "failed";
    if (!target) { setNotice(""); setError("Guarda el implante y luego pega o sube la imagen."); return "failed"; }
    if (files.some(file => !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024)) { setError("Usa imágenes JPG, PNG o WebP de hasta 12 MB. Los archivos DICOM no se cargan: captura el corte."); return "failed"; }
    working.current = true; setBusy("image"); setError(""); setNotice("");
    let added = 0;
    try {
      for (const original of files) {
        const extension = original.type === "image/png" ? "png" : original.type === "image/webp" ? "webp" : "jpg";
        const file = new File([original], `Implante ${target.tooth} ${as} ${today()}.${extension}`, { type: original.type });
        const image = await onUploadImage(file, imageKindForView(as), `Implante ${target.tooth} · ${as}`);
        try {
          const { implant } = await send<{ implant: Implant }>("PATCH", { id: target.id, addImage: { imageId: image.id, view: as } });
          setImplants(previous => (previous ?? []).map(item => item.id === implant.id ? implant : item));
        } catch (reason) { await onRemoveImage(image.id).catch(() => undefined); throw reason; }
        added++;
      }
      setNotice(`${added === 1 ? "Imagen guardada" : `${added} imágenes guardadas`} en el implante ${target.tooth} de ${patient.name} · ${as}.`);
      onChanged();
      return "saved";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la imagen."); return "failed"; }
    finally { working.current = false; setBusy(""); }
  }, [current, view, onUploadImage, onRemoveImage, onChanged, patient.name]);

  // Ctrl+V en cualquier parte de la pestaña, con una ficha abierta. El texto pegado en los campos no se intercepta.
  useEffect(() => {
    if (!draft) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
      if (!files.length) return;
      // Texto copiado de Word o Excel suele traer además una imagen: en un campo de texto se pega como texto.
      if (event.target instanceof Element && event.target.closest("input, textarea") && event.clipboardData?.getData("text/plain")) return;
      event.preventDefault();
      void addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [draft, addFiles]);

  const pasteButton = async () => {
    setError("");
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find(t => /^image\/(png|jpeg|webp)$/.test(t));
        if (type) files.push(new File([await item.getType(type)], "captura", { type }));
      }
      if (!files.length) { setError("No hay una imagen copiada. Captura el corte y vuelve a intentarlo."); return; }
      await addFiles(files);
    } catch { setError("El navegador no permitió leer lo copiado. Presiona Ctrl+V (en Mac, ⌘V)."); }
  };

  const removeImage = async (imageId: number) => {
    if (!current || busy || working.current) return;
    if (!window.confirm("¿Desea eliminar esta imagen? Se borrará de la ficha del paciente y no se puede deshacer.")) return;
    working.current = true; setBusy("image"); setError("");
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { id: current.id, removeImageId: imageId });
      setImplants(previous => (previous ?? []).map(item => item.id === implant.id ? implant : item));
      await onRemoveImage(imageId);
      setNotice("Imagen eliminada."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar la imagen."); }
    finally { working.current = false; setBusy(""); }
  };

  /** Lo último en pantalla: la respuesta de guardar un producto puede llegar después de abrir otra ficha. */
  const screen = useRef({ draft, dirty });
  useEffect(() => { screen.current = { draft, dirty }; });
  const productTool = useRef<ProductTool | null>(null);

  /**
   * Al corregir la pieza o el tipo de una etiqueta ya unida, se ofrece quitarla del implante donde quedó mal.
   * Devuelve true si se quitó de alguno (entonces se puede unir al de la pieza correcta).
   */
  const releaseWrong = async (product: ProductView, list: Implant[]) => {
    const wrong = (item: { tooth: string; productId: number | string | null }) => String(item.productId) === String(product.id) && (item.tooth !== product.tooth || product.category !== "implante");
    // Lo que vino de la etiqueta (marca y medidas tal como eran antes de corregirla) se quita junto con ella.
    const old = labels.find(item => item.id === product.id), measures = labelMeasures(old);
    let released = false;
    const shown = screen.current.draft;
    if (shown && shown.id === null && wrong(shown)) {
      setDraft(previous => previous && previous.id === null && wrong(previous) ? { ...previous, productId: "",
        brand: previous.brand === old?.brand ? "" : previous.brand, diameter: previous.diameter === mm(measures.diameter) ? "" : previous.diameter, length: previous.length === mm(measures.length) ? "" : previous.length } : previous);
      released = true;
    }
    for (const item of list.filter(wrong)) {
      if (!window.confirm(`Esta etiqueta sigue unida al implante ${item.tooth}. ¿Desea quitarla de ese implante? También se quitan la marca y las medidas que vinieron de ella.`)) continue;
      try {
        const { implant } = await send<{ implant: Implant }>("PATCH", { ...toDraft(item), id: item.id, productId: "", brand: item.brand === old?.brand ? "" : item.brand,
          diameter: item.diameter === measures.diameter ? "" : mm(item.diameter), length: item.length === measures.length ? "" : mm(item.length) });
        setImplants(previous => (previous ?? []).map(other => other.id === implant.id ? implant : other));
        if (screen.current.draft?.id === implant.id) { const next = toDraft(implant); setDraft(next); setBaseline(JSON.stringify(next)); }
        setNotice(`Etiqueta quitada del implante ${implant.tooth}.`); onChanged(); released = true;
      } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar la etiqueta del implante."); }
    }
    return released;
  };

  /** Una etiqueta de implante recién guardada se une sola al implante de su pieza que aún no tiene etiqueta. */
  const productSaved = async (product: ProductView, created: boolean, implantKnown: boolean) => {
    const data = await load();
    if (!data || (!created && !await releaseWrong(product, data.implants))) return;
    if (product.category !== "implante" || !product.tooth) return;
    if (!implantKnown) { setNotice(`Producto guardado. Si es el implante de la ${product.tooth}, elige su etiqueta en la ficha del implante.`); return; }
    const { draft: shown, dirty: pending } = screen.current;
    const measures = labelMeasures(product);
    const here = shown && shown.tooth === product.tooth ? shown : null;
    const replaceable = (item: Draft) => !item.productId || (item.id === null && item.productId === autoLabel.current);
    if (here && replaceable(here) && (here.id === null || pending)) {
      setDraft(previous => previous && previous.tooth === product.tooth && replaceable(previous)
        ? withLabel(previous, data.labels.find(item => String(item.id) === previous.productId), product) : previous);
      setNotice(`Etiqueta puesta en la ficha del implante ${product.tooth}. Guarda para confirmar.`);
      return;
    }
    const same = data.implants.filter(item => item.tooth === product.tooth);
    const target = same.find(item => item.id === here?.id && !item.productId) ?? (same.length === 1 && !same[0]!.productId ? same[0] : undefined);
    if (!target) return;
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { ...toDraft(target), id: target.id, productId: String(product.id), brand: target.brand || product.brand, diameter: mm(target.diameter ?? measures.diameter), length: mm(target.length ?? measures.length) });
      setImplants(previous => (previous ?? []).map(item => item.id === implant.id ? implant : item));
      if (screen.current.draft?.id === implant.id && !screen.current.dirty) { const next = toDraft(implant); setDraft(next); setBaseline(JSON.stringify(next)); }
      setNotice(`Etiqueta vinculada al implante ${implant.tooth}.`); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "El producto se guardó, pero no se pudo vincular al implante."); }
  };

  const suggestions = implants ? implantSuggestions({ implants, labels, teeth, crowns }) : [];
  const label = current?.productId ? labels.find(item => item.id === current.productId) : undefined;
  const sameTooth = draft && !draft.id ? (implants ?? []).filter(item => item.tooth === draft.tooth).length : 0;

  const arch = (codes: number[]) => <div className="grid grid-cols-8 gap-1 lg:grid-cols-16">{codes.map(code => {
    const tooth = fdi(code), found = (implants ?? []).filter(item => item.tooth === tooth), last = found.at(-1);
    const marked = !last && suggestions.some(item => item.tooth === tooth);
    return <button key={code} type="button" disabled={!implants} onClick={() => last ? show(toDraft(last)) : startNew(tooth)} data-testid={`implant-tooth-${code}`}
      aria-label={last ? `Implante ${tooth}, ${phaseLabel(last.phase)}` : `Registrar implante en ${tooth}`}
      className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${last ? `${PHASE_COLOR[last.phase]} border-2` : marked ? "border-dashed border-[#473a6d] bg-white text-[#473a6d]" : "border-[#e0dde9] bg-white text-[#6b6a7c] hover:border-[#473a6d]"} ${draft?.tooth === tooth ? "ring-2 ring-[#ef895f]" : ""}`}>
      <span>{tooth}</span>
      {last ? <svg viewBox="0 0 16 22" className="mt-0.5 h-5 w-4" aria-hidden="true"><path d="M4 1h8v4H4zM5 6h6l-1.5 14h-3z" fill="currentColor"/><path d="M3 9h10M3.5 12h9M4 15h8" stroke="currentColor" strokeWidth="1.2"/></svg> : <span className="h-5 text-xs leading-5" aria-hidden="true">{marked ? "+" : ""}</span>}
      {found.length > 1 && <span className="text-[10px]">×{found.length}</span>}
    </button>;
  })}</div>;

  return <section className="space-y-4" data-testid="implantology">
    <div className="surface space-y-3">
      <div><h3 className="font-semibold">Implantología</h3><p className="mt-1 text-sm text-[#615f73]">Toca una pieza para abrir o crear la ficha de su implante.</p></div>
      <div className="space-y-2" role="group" aria-label="Implantograma">{arch(UPPER_ARCH)}<div className="border-t border-dashed border-[#d8d5e4]"/>{arch(LOWER_ARCH)}</div>
      <div className="flex flex-wrap gap-2 text-xs">{IMPLANT_PHASES.map(item => <span key={item.id} className={`rounded-full border px-2 py-1 ${PHASE_COLOR[item.id]}`}>{item.label}</span>)}</div>
      {suggestions.length > 0 && <div data-testid="implant-suggestions"><p className="text-sm font-semibold">Sin ficha todavía</p><div className="mt-1 flex flex-wrap gap-2">{suggestions.map(item => <button key={item.tooth} type="button" className={secondary} onClick={() => startNew(item.tooth, item.draft)}><Plus className="size-4" aria-hidden="true"/>{item.tooth} · {item.source === "etiqueta" ? `desde la etiqueta${item.draft.brand ? ` (${item.draft.brand})` : ""}` : "desde el odontograma"}</button>)}</div></div>}
      {implants === null && !error && <p role="status" className="text-sm text-[#615f73]">Cargando implantes…</p>}
      {implants === null && error && <button type="button" className={secondary} onClick={() => { setError(""); void load(); }}>Volver a intentar</button>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && !error && <p role="status" className="rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d]">{notice}</p>}
    </div>

    <BiomedicalProducts embedded tool={productTool} patient={patient} startTooth={draft?.tooth ?? ""} onSaved={(product, created, implantKnown) => void productSaved(product, created, implantKnown)}
      onUploadImage={onUploadImage} onRemoveImage={onRemoveImage} onImageGone={onImageGone} onChanged={() => { void load(); onChanged(); }}/>

    {draft && <div ref={formRef} className="surface space-y-4" data-testid="implant-form">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-semibold">{draft.id ? "Implante" : "Nuevo implante"} {draft.tooth} · {patient.name}</h3>{current && implantSummary(current) && <p className="text-sm text-[#615f73]">{implantSummary(current)}</p>}</div>
        <button type="button" className="rounded-lg p-2 text-[#473a6d] hover:bg-[#f3f1f7]" aria-label="Cerrar ficha del implante" onClick={() => show(null)}><X className="size-5"/></button>
      </div>
      {sameTooth > 0 && <p className="text-sm text-[#7a5a12]">Ya hay una ficha de implante en la {draft.tooth}. Guarda otra solo si es un implante distinto.</p>}
      <fieldset><legend className="text-sm font-semibold">Fase</legend><div className="mt-1 flex flex-wrap gap-2">{IMPLANT_PHASES.map(item => <button key={item.id} type="button" aria-pressed={draft.phase === item.id} className={chip(draft.phase === item.id)} onClick={() => set("phase", draft.phase === item.id ? "" : item.id)}>{item.label}</button>)}</div></fieldset>
      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-4">
        <label className="text-sm font-semibold">Pieza (FDI)<select value={draft.tooth} onChange={e => set("tooth", e.target.value)} className={input}>{[...UPPER_ARCH, ...LOWER_ARCH].map(code => <option key={code} value={fdi(code)}>{fdi(code)}</option>)}</select></label>
        <label className="text-sm font-semibold">Marca<input list="implant-brand-list" value={draft.brand} maxLength={80} onChange={e => set("brand", e.target.value)} className={input} data-testid="implant-brand"/></label>
        <label className="text-sm font-semibold">Sistema o modelo<input value={draft.system} maxLength={80} onChange={e => set("system", e.target.value)} className={input}/></label>
        <label className="min-w-0 text-sm font-semibold">Fecha de instalación<input type="date" max={today()} value={draft.placedOn} onChange={e => set("placedOn", e.target.value)} className={`${input} min-w-0 max-w-full appearance-none`}/></label>
        <label className="text-sm font-semibold">Diámetro (mm)<input list="implant-diameter-list" inputMode="decimal" value={draft.diameter} maxLength={6} onChange={e => set("diameter", e.target.value)} className={input} data-testid="implant-diameter"/></label>
        <label className="text-sm font-semibold">Largo (mm)<input list="implant-length-list" inputMode="decimal" value={draft.length} maxLength={6} onChange={e => set("length", e.target.value)} className={input} data-testid="implant-length"/></label>
        <label className="text-sm font-semibold">Torque (Ncm)<input inputMode="numeric" value={draft.torque} maxLength={3} onChange={e => set("torque", e.target.value)} className={input}/></label>
        <label className="text-sm font-semibold">ISQ<input inputMode="numeric" value={draft.isq} maxLength={3} onChange={e => set("isq", e.target.value)} className={input}/></label>
      </div>
      <datalist id="implant-brand-list">{BRANDS.map(brand => <option key={brand} value={brand}/>)}</datalist>
      <datalist id="implant-diameter-list">{COMMON_DIAMETERS.map(value => <option key={value} value={mm(value)}/>)}</datalist>
      <datalist id="implant-length-list">{COMMON_LENGTHS.map(value => <option key={value} value={mm(value)}/>)}</datalist>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-60 flex-1 text-sm font-semibold">Etiqueta (trazabilidad)<select value={draft.productId} onChange={e => chooseLabel(e.target.value)} className={input} data-testid="implant-label"><option value="">Sin etiqueta vinculada</option>{labels.map(item => <option key={item.id} value={item.id}>{[item.tooth || "sin pieza", item.brand, item.lot && `lote ${item.lot}`, item.serial && `serie ${item.serial}`, dayLabel(item.placedOn)].filter(Boolean).join(" · ")}</option>)}</select></label>
        <button type="button" className={secondary} onClick={() => productTool.current?.scan()} data-testid="implant-scan"><ScanLine className="size-4" aria-hidden="true"/>Escanear código</button>
        <button type="button" className={secondary} onClick={() => productTool.current?.photograph()} data-testid="implant-photo-label"><Camera className="size-4" aria-hidden="true"/>Fotografiar etiqueta</button>
      </div>
      {label && !dirty && <p className="break-words text-sm text-[#473a6d]">{[label.reference && `Ref. ${label.reference}`, label.lot && `Lote ${label.lot}`, label.serial && `Serie ${label.serial}`].filter(Boolean).join(" · ") || "La etiqueta no tiene referencia, lote ni serie registrados."}</p>}
      <label className="block text-sm font-semibold">Nota (opcional)<textarea rows={2} value={draft.note} maxLength={600} onChange={e => set("note", e.target.value)} className={`${input} py-2`}/></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy !== "" || (draft.id !== null && !dirty)} onClick={() => void save()} data-testid="implant-save">{busy === "saving" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>}{draft.id ? "Guardar cambios" : "Guardar implante"}</button>
        {draft.id !== null && <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50" onClick={() => void remove()}><Trash2 className="size-4" aria-hidden="true"/>Eliminar ficha</button>}
      </div>

      {current && <div className="space-y-3 rounded-xl border-2 border-dashed border-[#c9c4da] bg-[#faf9fc] p-3" data-testid="implant-images"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}>
        <div><h4 className="font-semibold">Imágenes del implante {current.tooth}</h4><p className="text-sm text-[#615f73]">Elige el tipo de corte y pega con Ctrl+V, o arrastra el archivo aquí.</p></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de imagen">{IMPLANT_VIEWS.map(item => <button key={item} type="button" aria-pressed={view === item} className={chip(view === item)} onClick={() => setView(item)}>{item}</button>)}</div>
        {showCapturer && windows && <CaptureLink key={current.id} target={`implante ${current.tooth}`} patientName={patient.name} view={view} busy={busy === "image"}
          onCapture={(file, as) => addFiles([file], as)} onProblem={message => { setNotice(""); setError(message); }}/>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={busy !== ""} onClick={() => void pasteButton()} data-testid="implant-paste">{busy === "image" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <ClipboardPaste className="size-4" aria-hidden="true"/>}{busy === "image" ? "Guardando…" : "Pegar imagen"}</button>
          <button type="button" className={secondary} disabled={busy !== ""} onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" aria-hidden="true"/>Subir imagen</button>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} data-testid="implant-file"/>
        </div>
        {current.images.length ? <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">{current.images.map(item => {
          const image = images.find(found => found.id === item.imageId);
          return <li key={item.imageId} className="overflow-hidden rounded-xl border border-[#e6e4ee] bg-white">
            {image ? <button type="button" className="block h-36 w-full bg-[#1f1b30]" onClick={() => setOpen(image)} aria-label={`Abrir ${item.view}`}><img src={thumbUrl(image.url)} loading="lazy" alt={`${item.view}, implante ${current.tooth}`} className="h-36 w-full object-contain"/></button> : <p className="flex h-36 items-center justify-center text-xs text-[#615f73]">Cargando…</p>}
            <div className="flex items-center justify-between gap-2 px-2 py-1"><span className="text-sm font-medium">{item.view}</span><button type="button" className="rounded-lg p-2 text-rose-800 hover:bg-rose-50" aria-label={`Eliminar imagen ${item.view}`} onClick={() => void removeImage(item.imageId)}><Trash2 className="size-4"/></button></div>
          </li>;
        })}</ul> : <p className="text-sm text-[#6b6a7c]">Aún no hay imágenes de este implante.</p>}
        <p className="text-xs text-[#615f73]">Las capturas no sustituyen el estudio original para diagnóstico.</p>
      </div>}
    </div>}

    {!!implants?.length && <div className="surface" data-testid="implant-list"><h3 className="font-semibold">Implantes registrados</h3>
      <ul className="mt-3 space-y-2">{implants.map(item => <li key={item.id}><button type="button" onClick={() => show(toDraft(item))} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[#e6e4ee] bg-white p-3 text-left text-sm hover:border-[#473a6d]">
        <span className="font-bold">{item.tooth}</span><span className={`rounded-full border px-2 py-0.5 text-xs ${PHASE_COLOR[item.phase]}`}>{phaseLabel(item.phase)}</span>
        <span>{implantSummary(item) || "Sin marca ni medidas registradas"}</span>
        <span className="text-[#615f73]">{[item.placedOn && dayLabel(item.placedOn), item.torque !== null && `${item.torque} Ncm`, item.isq !== null && `ISQ ${item.isq}`, item.images.length && `${item.images.length} ${item.images.length === 1 ? "imagen" : "imágenes"}`].filter(Boolean).join(" · ")}</span>
      </button></li>)}</ul></div>}

    {showCapturer && windows && <div className="surface space-y-2" data-testid="implant-capturer">
      <h3 className="font-semibold">Capturadora de imágenes (Windows, versión de prueba)</h3>
      <p className="text-sm text-[#615f73]">Versión 0.3: marca una vez las vistas en la capturadora y, con un implante abierto, captura cada una o todas juntas. Si tenías la anterior, ciérrala antes de abrir esta. Aún no está firmada, por eso solo la ve la cuenta de desarrollo.</p>
      <a href="/descargas/capturadora-speakdent-prueba.zip" download className={secondary}><Download className="size-4" aria-hidden="true"/>Descargar capturadora</a>
    </div>}

    {open && <div role="dialog" aria-modal="true" aria-label={open.name} className="fixed inset-0 z-[70] flex flex-col bg-[#2a2540]/95 p-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3"><strong>{open.note || open.name}</strong><button type="button" className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar imagen" onClick={() => setOpen(null)}><X/></button></div>
      <img src={open.url} alt={open.note || open.name} className="min-h-0 flex-1 object-contain"/>
    </div>}
  </section>;
}
