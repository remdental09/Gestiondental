"use client";
/**
 * Productos biomédicos de la ficha (trazabilidad): el profesional toma la foto de la etiqueta de un implante, injerto, membrana o
 * pilar; la IA propone marca, referencia, lote, serie y vencimiento; él confirma o corrige y queda registrado con la pieza y la fecha.
 * Principios: escribir lo mínimo, la app propone y el profesional confirma, y todo lo agregado por error se puede quitar (con confirmación).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileText, ImagePlus, LoaderCircle, Pencil, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import type { ClinicalImage } from "@/app/clinical-data";
import { PRODUCT_CATEGORIES, PRODUCT_IMAGE_KIND, categoryLabel, cleanTooth, missingTrace, type ProductCategory } from "@/lib/biomedical-products";

export type ProductView = {
  id: number; patientId: number; imageId: number | null; category: ProductCategory; brand: string; reference: string; lot: string; serial: string;
  expiry: string; manufacturer: string; tooth: string; note: string; placedOn: string; aiRead: boolean; createdByName: string; createdAt: string; imageUrl: string; thumbUrl: string;
};

type Draft = {
  id: number | null; imageId: number | null; imageUrl: string; category: ProductCategory;
  brand: string; reference: string; lot: string; serial: string; expiry: string; manufacturer: string; tooth: string; note: string; placedOn: string;
  /** Campos que la IA propuso y el profesional aún no tocó: se marcan para que los compare con la foto. */
  suggested: Set<string>; aiRead: boolean;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const blank = (tooth = ""): Draft => ({ id: null, imageId: null, imageUrl: "", category: "implante", brand: "", reference: "", lot: "", serial: "", expiry: "", manufacturer: "", tooth, note: "", placedOn: today(), suggested: new Set(), aiRead: false });
const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00-03:00`); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(d); };
const expiryLabel = (value: string) => value.length === 7 ? `${value.slice(5)}/${value.slice(0, 4)}` : value.split("-").reverse().join("/");

const inputBase = "mt-1 block min-h-11 w-full rounded-lg border px-3 text-base";
const input = `${inputBase} border-[#d8d5e4] bg-white`;
const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar. Intenta otra vez.");
  return data;
}

export function BiomedicalProducts({ patient, startTooth = "", startNonce = 0, onUploadImage, onRemoveImage, onImageGone, onChanged }: {
  patient: { id: number; name: string };
  /** Pieza de la evolución desde la que se abrió (FDI con punto o compacta); queda como valor inicial editable. */
  startTooth?: string;
  /** Cambia cada vez que se abre desde el menú Documento → Producto. */
  startNonce?: number;
  onUploadImage: (file: File, kind: typeof PRODUCT_IMAGE_KIND, note: string) => Promise<ClinicalImage>;
  onRemoveImage: (id: number) => Promise<void>;
  onImageGone: (id: number) => void;
  onChanged: () => void;
}) {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"" | "photo" | "reading" | "saving">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try { const data = await call<{ products: ProductView[] }>(`/api/productos?patientId=${patient.id}`, { cache: "no-store" }); setProducts(data.products); }
    catch (reason) { setProducts([]); setError(reason instanceof Error ? reason.message : "No se pudieron cargar los productos."); }
  }, [patient.id]);
  useEffect(() => { void load(); }, [load]);
  // Abierto desde el menú Documento → Producto: se prepara un registro nuevo con la pieza de la evolución.
  useEffect(() => { if (startNonce) { setDraft(previous => previous ?? blank(cleanTooth(startTooth))); setNotice(""); setError(""); } }, [startNonce, startTooth]);

  const pick = async (file?: File) => {
    if (!file || busy) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size > 25 * 1024 * 1024) { setError("Usa una foto JPG, PNG o WebP."); return; }
    setError(""); setNotice(""); setBusy("photo");
    let image: ClinicalImage | null = null;
    try {
      image = await onUploadImage(file, PRODUCT_IMAGE_KIND, "");
      setBusy("reading");
      const base = draft && draft.id === null ? draft : blank(cleanTooth(startTooth));
      // Si ya había una foto sin guardar en el borrador, se descarta (cada producto tiene su foto).
      if (base.imageId && base.imageId !== image.id) void onRemoveImage(base.imageId).catch(() => undefined);
      let next: Draft = { ...base, imageId: image.id, imageUrl: image.url, suggested: new Set(), aiRead: false };
      try {
        const read = await call<{ fields: Partial<Record<string, string>> | null; aiError?: string }>("/api/productos/leer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: image.id }) });
        if (read.fields) {
          const f = read.fields, suggested = new Set<string>();
          const take = (key: "brand" | "reference" | "lot" | "serial" | "manufacturer") => { if (f[key]) { next = { ...next, [key]: f[key]! }; suggested.add(key); } };
          (["brand", "reference", "lot", "serial", "manufacturer"] as const).forEach(take);
          if (f.expiry) { next = { ...next, expiry: f.expiry.slice(0, 7) }; suggested.add("expiry"); }
          if (f.category && PRODUCT_CATEGORIES.some(item => item.id === f.category)) next = { ...next, category: f.category as ProductCategory };
          next = { ...next, suggested, aiRead: suggested.size > 0 };
          if (!suggested.size) setNotice("No se alcanzó a leer nada de la etiqueta: completa los datos mirando la foto.");
        } else setNotice(read.aiError || "No se pudo leer la etiqueta: completa los datos mirando la foto.");
      } catch { setNotice("No se pudo leer la etiqueta: completa los datos mirando la foto."); }
      setDraft(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la foto."); }
    finally { setBusy(""); }
  };

  const set = (key: keyof Draft, value: string) => setDraft(previous => {
    if (!previous) return previous;
    const suggested = new Set(previous.suggested); suggested.delete(key);
    return { ...previous, [key]: value, suggested };
  });

  const save = async () => {
    if (!draft || busy) return;
    setBusy("saving"); setError("");
    try {
      const body = { patientId: patient.id, imageId: draft.imageId, aiRead: draft.aiRead, category: draft.category, brand: draft.brand, reference: draft.reference, lot: draft.lot, serial: draft.serial, expiry: draft.expiry, manufacturer: draft.manufacturer, tooth: draft.tooth, note: draft.note, placedOn: draft.placedOn };
      if (draft.id === null) {
        const saved = await call<{ product: ProductView }>("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        setProducts(previous => [saved.product, ...(previous ?? [])].sort((a, b) => b.placedOn.localeCompare(a.placedOn) || b.id - a.id));
      } else {
        const saved = await call<{ product: ProductView }>("/api/productos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: draft.id }) });
        setProducts(previous => (previous ?? []).map(item => item.id === saved.product.id ? saved.product : item));
      }
      setDraft(null); setNotice("Producto registrado en la ficha."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el producto."); }
    finally { setBusy(""); }
  };

  const discard = async () => {
    if (!draft) return;
    // Una foto tomada y no guardada se quita para no dejar imágenes sueltas en la ficha.
    if (draft.id === null && draft.imageId && !window.confirm("¿Descartar este producto? Se borrará también la foto que acabas de tomar.")) return;
    if (draft.id === null && draft.imageId) await onRemoveImage(draft.imageId).catch(() => undefined);
    setDraft(null); setError(""); setNotice("");
  };

  const edit = (product: ProductView) => { setDraft({ ...blank(), id: product.id, imageId: product.imageId, imageUrl: product.imageUrl, category: product.category, brand: product.brand, reference: product.reference, lot: product.lot, serial: product.serial, expiry: product.expiry.slice(0, 7), manufacturer: product.manufacturer, tooth: product.tooth, note: product.note, placedOn: product.placedOn, aiRead: product.aiRead }); setNotice(""); setError(""); };

  const remove = async (product: ProductView) => {
    if (!window.confirm(`¿Desea eliminar este producto del registro? Se borrará también la foto de la etiqueta${product.lot || product.serial ? ` (${[product.lot && `lote ${product.lot}`, product.serial && `serie ${product.serial}`].filter(Boolean).join(", ")})` : ""}. No se puede deshacer.`)) return;
    setError("");
    try {
      await call("/api/productos?id=" + product.id, { method: "DELETE" });
      setProducts(previous => (previous ?? []).filter(item => item.id !== product.id));
      if (product.imageId) onImageGone(product.imageId);
      setNotice("Producto eliminado del registro."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar el producto."); }
  };

  const working = busy === "photo" || busy === "reading";
  const flagged = (key: string) => draft?.suggested.has(key) ? "border-amber-400 bg-amber-50" : "border-[#d8d5e4] bg-white";

  return <section className="space-y-4" data-testid="biomedical-products">
    <div className="surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Productos biomédicos y trazabilidad</h3><p className="mt-1 max-w-2xl text-sm text-[#615f73]">Fotografía la etiqueta de un implante, injerto, membrana o pilar: la app lee la marca, el lote y la serie, tú confirmas, y queda en la ficha con la pieza y la fecha.</p></div>
        {!!products?.length && <a href={`/api/productos/pdf?patientId=${patient.id}`} target="_blank" rel="noopener noreferrer" className={secondary} data-testid="products-pdf"><FileText className="size-4" aria-hidden="true"/>Imprimir registro (PDF)</a>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={working} onClick={() => cameraRef.current?.click()} data-testid="products-camera">{working ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true"/> : <Camera className="size-5" aria-hidden="true"/>}{busy === "photo" ? "Guardando foto…" : busy === "reading" ? "Leyendo la etiqueta…" : "Tomar foto del producto"}</button>
        <button type="button" className={secondary} disabled={working} onClick={() => galleryRef.current?.click()}><ImagePlus className="size-4" aria-hidden="true"/>Elegir de la galería</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} data-testid="products-camera-input"/>
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }}/>
        {!draft && <button type="button" className={secondary} onClick={() => { setDraft(blank(cleanTooth(startTooth))); setNotice(""); setError(""); }} data-testid="products-manual">Registrar sin foto</button>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && !error && <p role="status" className="mt-3 rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d]">{notice}</p>}
    </div>

    {draft && <div className="surface space-y-3" data-testid="product-form">
      <h3 className="font-semibold">{draft.id === null ? "Nuevo producto" : "Editar producto"} · {patient.name}</h3>
      <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div>{draft.imageUrl ? <a href={draft.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir la foto de la etiqueta en grande"><img src={draft.imageUrl} alt="Foto de la etiqueta del producto" className="max-h-80 w-full rounded-xl border border-[#e6e4ee] bg-white object-contain"/></a> : <p className="rounded-xl border border-dashed border-[#c9c4da] p-4 text-sm text-[#615f73]">Sin foto: puedes agregarla con «Tomar foto del producto».</p>}</div>
        <div className="space-y-3">
          {draft.suggested.size > 0 && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950" data-testid="product-ai-note"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true"/><span>La IA leyó los campos marcados en amarillo. <strong>Compáralos con la foto</strong>, sobre todo lote y serie, y corrige lo que haga falta antes de guardar.</span></p>}
          <fieldset><legend className="text-sm font-semibold">Tipo de producto</legend>
            <div className="mt-1 flex flex-wrap gap-2">{PRODUCT_CATEGORIES.map(item => <button key={item.id} type="button" onClick={() => set("category", item.id)} aria-pressed={draft.category === item.id} className={`min-h-11 rounded-full border px-3 text-sm font-medium ${draft.category === item.id ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d8d5e4] bg-white text-[#473a6d]"}`}>{item.label}</button>)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Marca<input value={draft.brand} onChange={event => set("brand", event.target.value)} maxLength={80} className={`${inputBase} ${flagged("brand")}`} data-testid="product-brand"/></label>
            <label className="text-sm font-semibold">Referencia / código<input value={draft.reference} onChange={event => set("reference", event.target.value)} maxLength={60} className={`${inputBase} ${flagged("reference")}`}/></label>
            <label className="text-sm font-semibold">Lote<input value={draft.lot} onChange={event => set("lot", event.target.value)} maxLength={60} autoCapitalize="characters" className={`${inputBase} ${flagged("lot")}`} data-testid="product-lot"/></label>
            <label className="text-sm font-semibold">N.º de serie<input value={draft.serial} onChange={event => set("serial", event.target.value)} maxLength={60} autoCapitalize="characters" className={`${inputBase} ${flagged("serial")}`} data-testid="product-serial"/></label>
            <label className="text-sm font-semibold">Vencimiento<input type="month" value={draft.expiry} onChange={event => set("expiry", event.target.value)} className={`${inputBase} ${flagged("expiry")}`}/></label>
            <label className="text-sm font-semibold">Fabricante<input value={draft.manufacturer} onChange={event => set("manufacturer", event.target.value)} maxLength={80} className={`${inputBase} ${flagged("manufacturer")}`}/></label>
            <label className="text-sm font-semibold">Pieza (FDI)<input value={draft.tooth} onChange={event => set("tooth", event.target.value)} inputMode="decimal" placeholder="Ej.: 3.6" maxLength={4} className={input} data-testid="product-tooth"/></label>
            <label className="text-sm font-semibold">Fecha de colocación<input type="date" value={draft.placedOn} max={today()} onChange={event => set("placedOn", event.target.value)} className={input}/></label>
          </div>
          <label className="block text-sm font-semibold">Nota (opcional)<textarea value={draft.note} onChange={event => set("note", event.target.value)} maxLength={600} rows={2} className={`${input} py-2`}/></label>
          {missingTrace(draft) && <p className="flex items-start gap-2 text-sm text-[#7a5a12]"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true"/>Sin lote ni número de serie no se puede rastrear el producto. Puedes guardarlo igual y completarlo después.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy !== "" || (!draft.imageId && !draft.brand && !draft.reference && !draft.lot && !draft.serial)} onClick={() => void save()} data-testid="product-save">{busy === "saving" ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true"/> : null}{busy === "saving" ? "Guardando…" : "Guardar producto"}</button>
            <button type="button" className={secondary} disabled={busy !== ""} onClick={() => void discard()}>{draft.id === null ? "Descartar" : "Cancelar"}</button>
          </div>
        </div>
      </div>
    </div>}

    <div className="surface" data-testid="product-list">
      <h3 className="font-semibold">Productos registrados</h3>
      {products === null ? <p className="mt-2 text-sm text-[#615f73]" role="status">Cargando…</p> : !products.length ? <p className="mt-2 text-sm text-[#615f73]">Este paciente aún no tiene productos registrados.</p> :
        <ul className="mt-3 space-y-3">{products.map(product => <li key={product.id} className="grid gap-3 rounded-xl border border-[#e6e4ee] bg-white p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]" data-testid="product-item">
          {product.thumbUrl ? <a href={product.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir la foto de la etiqueta"><img src={product.thumbUrl} alt={`Etiqueta: ${categoryLabel(product.category)} ${product.brand}`.trim()} className="h-24 w-24 rounded-lg border border-[#e6e4ee] object-cover" loading="lazy"/></a> : <span className="flex h-24 w-24 items-center justify-center rounded-lg bg-[#f3f1f7] text-xs text-[#615f73]">Sin foto</span>}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{categoryLabel(product.category)}{product.brand ? ` · ${product.brand}` : ""}{product.tooth ? ` · pieza ${product.tooth}` : ""}</p>
            <p className="mt-0.5 text-[#615f73]">{dayLabel(product.placedOn)}{product.createdByName ? ` · ${product.createdByName}` : ""}</p>
            <p className="mt-1 break-words">{[product.reference && `Ref. ${product.reference}`, product.lot && `Lote ${product.lot}`, product.serial && `Serie ${product.serial}`, product.expiry && `Vence ${expiryLabel(product.expiry)}`].filter(Boolean).join(" · ") || <span className="text-[#7a5a12]">Sin lote ni serie registrados</span>}</p>
            {product.note && <p className="mt-1 text-[#615f73]">{product.note}</p>}
          </div>
          <div className="flex gap-2 sm:flex-col">
            <button type="button" className={secondary} onClick={() => edit(product)} aria-label="Editar producto"><Pencil className="size-4" aria-hidden="true"/>Editar</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50" onClick={() => void remove(product)} aria-label="Eliminar producto"><Trash2 className="size-4" aria-hidden="true"/>Quitar</button>
          </div>
        </li>)}</ul>}
    </div>
  </section>;
}
