"use client";
/**
 * Productos biomédicos de la ficha (trazabilidad): el profesional toma la foto de la etiqueta de un implante, injerto, membrana o
 * pilar; la IA propone marca, referencia, lote, serie y vencimiento; él confirma o corrige y queda registrado con la pieza y la fecha.
 * Principios: escribir lo mínimo, la app propone y el profesional confirma, y todo lo agregado por error se puede quitar (con confirmación).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Camera, FileText, ImagePlus, LoaderCircle, Pencil, Plus, ScanLine, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import type { ClinicalImage } from "@/app/clinical-data";
import { CodeScanner } from "@/components/code-scanner";
import { readCodes } from "@/lib/code-reader";
import { parseProductCodes, type CodeRead, type ProductCode } from "@/lib/product-code";
import { applyPhoto, applyScan } from "@/lib/product-draft";
import { MAX_DETAILS, PRODUCT_CATEGORIES, PRODUCT_IMAGE_KIND, categoryLabel, cleanTooth, expiryLabel, measureText, missingTrace, type LabelReading, type ProductCategory, type ProductDetail } from "@/lib/biomedical-products";
import { categoryKind, kindCategory, loosePieces, pieceKind, pieceKindOptions, stagePieces } from "@/lib/implant-pieces";
import { phaseLabel, stageOptions, type RecordedPhase } from "@/lib/implants";

export type ProductView = {
  id: number; patientId: number; imageId: number | null; category: ProductCategory; brand: string; reference: string; lot: string; serial: string;
  expiry: string; manufacturer: string; tooth: string; note: string; placedOn: string; aiRead: boolean; createdByName: string; createdAt: string; imageUrl: string; thumbUrl: string;
  model: string; diameter: string; length: string; registration: string; manufactured: string; gtin: string; details: ProductDetail[]; code: string;
  kind: string; implantId: number | null; stage: string;
};

/** La fase de un implante donde se anota lo que se usó. */
export type StageSlot = {
  implant: { id: number; tooth: string; productId: number | null };
  /** Todos los implantes del paciente: lo unido a otro no se ofrece aquí. */
  implants: { id: number; tooth: string; productId: number | null }[];
  phase: RecordedPhase;
  /** Fecha escrita en la fase; es la que toma lo que se anote. */
  date: string;
  /** Tipos que la cuenta ya usó. */
  kinds: string[];
};

type Draft = {
  id: number | null; imageId: number | null; imageUrl: string; category: ProductCategory;
  brand: string; reference: string; lot: string; serial: string; expiry: string; manufacturer: string; tooth: string; note: string; placedOn: string;
  model: string; diameter: string; length: string; registration: string; manufactured: string; gtin: string; details: ProductDetail[]; code: string;
  /** Campos que la IA propuso y el profesional aún no tocó: se marcan para que los compare con la foto. */
  suggested: Set<string>; fromCode: Set<string>; aiRead: boolean; categoryBy: "" | "read" | "user"; scan: ProductCode | null;
  kind: string;
  /** Solo dentro de una fase: dónde quedará al guardar ("" = fuera de las fases). */
  moveTo: RecordedPhase | "";
  /** Dónde y en qué pieza dental estaba al abrirlo para corregirlo. */
  was?: { tooth: string; implantId: number | null; stage: string };
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const blank = (tooth = ""): Draft => ({ kind: "", moveTo: "", id: null, imageId: null, imageUrl: "", category: "implante", brand: "", reference: "", lot: "", serial: "", expiry: "", manufacturer: "", tooth, note: "", placedOn: today(), model: "", diameter: "", length: "", registration: "", manufactured: "", gtin: "", details: [], code: "", suggested: new Set(), fromCode: new Set(), aiRead: false, categoryBy: "", scan: null });
const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00-03:00`); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(d); };

const inputBase = "mt-1 block min-h-11 w-full rounded-lg border px-3 text-base";
const input = `${inputBase} border-[#d8d5e4] bg-white`;
/** En iPhone los campos de fecha se salen de la tarjeta si no se les quita el estilo nativo. */
const dateBox = "min-w-0 max-w-full appearance-none";
const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar. Intenta otra vez.");
  return data;
}

/** Lo que la ventana que la contiene necesita saber antes de cerrarse o pasar a otra ficha. */
export type ProductTool = { saving: () => boolean; pending: () => boolean; discard: () => void };

export function BiomedicalProducts({ patient, startTooth = "", startNonce = 0, embedded = false, compact = false, tool, slot, onSaved, onUploadImage, onRemoveImage, onImageGone, onChanged }: {
  patient: { id: number; name: string };
  /** Pieza de la evolución desde la que se abrió (FDI con punto o compacta); queda como valor inicial editable. */
  startTooth?: string;
  /** Cambia cada vez que se abre desde el menú Documento → Producto. */
  startNonce?: number;
  /** Dentro de otra pestaña (Implantología): la lista va plegada y no se mezclan piezas. */
  embedded?: boolean;
  /** Dentro de la ventana de un implante: solo los botones, el registro en curso y la lista plegada. */
  compact?: boolean;
  /** Permite que quien la contiene sepa si hay un registro a medias y lo descarte. */
  tool?: RefObject<ProductTool | null>;
  /** Dentro de una fase de un implante: solo lo de esa fase, con el tipo de pieza abierto. */
  slot?: StageSlot;
  /** `created`: es nuevo (o, dentro de una fase, se acaba de poner en ella).
   * `implantKnown`: se sabe que el tipo es correcto (elegido, leído o con medidas); sin eso no se une solo a un implante. */
  onSaved?: (product: ProductView, created: boolean, implantKnown: boolean) => void;
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
  const [scanning, setScanning] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  /** Se está escribiendo un tipo que no está en la lista. */
  const [otherKind, setOtherKind] = useState(false);
  const hasDraft = draft !== null;
  /** Borrador nuevo: en una fase toma la pieza dental del implante y su fecha se decide al guardar. */
  const fresh = () => slot ? { ...blank(slot.implant.tooth), placedOn: "", moveTo: slot.phase } : blank(cleanTooth(startTooth));
  /** Cambia al descartar o al desmontarse: una lectura que termina tarde no reaparece y su foto se borra. */
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (embedded && hasDraft) formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [embedded, hasDraft]);

  const load = useCallback(async () => {
    try { const data = await call<{ products: ProductView[] }>(`/api/productos?patientId=${patient.id}`, { cache: "no-store" }); setProducts(data.products); }
    // Si falla una relectura (p. ej. sin conexión), lo que ya se veía sigue a la vista.
    catch (reason) { setProducts(previous => previous ?? []); setError(reason instanceof Error ? reason.message : "No se pudieron cargar los productos."); }
  }, [patient.id]);
  useEffect(() => { void load(); }, [load]);
  // Abierto desde el menú Documento → Producto: se prepara un registro nuevo con la pieza de la evolución.
  useEffect(() => { if (startNonce) { setDraft(previous => previous ?? blank(cleanTooth(startTooth))); setNotice(""); setError(""); } }, [startNonce, startTooth]);

  const pick = async (file?: File) => {
    if (!file || busy) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size > 25 * 1024 * 1024) { setError("Usa una foto JPG, PNG o WebP."); return; }
    setError(""); setNotice(""); setBusy("photo");
    let image: ClinicalImage | null = null;
    const started = generation.current;
    try {
      // El código se busca en la foto original, a resolución completa.
      const found = readCodes(file).catch(() => [] as string[]);
      image = await onUploadImage(file, PRODUCT_IMAGE_KIND, "");
      if (generation.current !== started) { await onRemoveImage(image.id).catch(() => undefined); return; }
      setBusy("reading");
      const base = draft ?? fresh();
      // Si ya había una foto sin guardar en el borrador, se descarta: cada producto tiene su foto.
      if (base.imageId && base.imageId !== image.id) void onRemoveImage(base.imageId).catch(() => undefined);
      // 1) Código de la etiqueta (lectura exacta, en el equipo). 2) Texto impreso, leído por la IA. 3) La foto queda como respaldo.
      const codes = await found;
      const parsed = codes.length ? parseProductCodes(codes) : null;
      const code = parsed && !parsed.mixed ? parsed : null;
      let aiProblem = "";
      let read: { fields: LabelReading | null; aiError?: string } = { fields: null };
      try { read = await call("/api/productos/leer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: image.id, code: code?.raw ?? "" }) }); }
      catch { aiProblem = "No se pudo leer el texto de la etiqueta."; }
      if (generation.current !== started) { await onRemoveImage(image.id).catch(() => undefined); return; }
      if (!read.fields || !read.fields.legible) aiProblem ||= read.aiError || "No se pudo leer el texto de la etiqueta.";
      // El tipo de pieza solo se usa dentro de una fase.
      const result = applyPhoto(base, code, !read.fields || slot ? read.fields : read.fields.legible ? { ...read.fields, kind: "" } : null);
      const next: Draft = { ...result.draft, imageId: image.id, imageUrl: image.url, aiRead: result.draft.suggested.size > 0 };
      // En una fase, si la foto dijo la categoría pero no el nombre, se propone el nombre que le corresponde.
      if (slot && !next.kind && next.categoryBy === "read" && categoryKind(next.category)) { next.kind = categoryKind(next.category); next.suggested.add("kind"); }
      setOtherKind(false);
      const parts: string[] = [];
      if (parsed?.mixed) parts.push("En la foto hay códigos de productos distintos y no se usó ninguno: fotografía una sola etiqueta.");
      if (code) parts.push(result.filled.length ? `Se leyó el código de la etiqueta (${result.filled.join(", ")}).` : "Se encontró un código, pero no trae lote ni serie reconocibles.");
      if (result.droppedScan) parts.push("El código escaneado antes no coincide con esta foto y se quitó; si es el mismo producto, escanéalo otra vez.");
      if (result.kept.length) parts.push(`Se mantuvo lo que escribiste en ${result.kept.join(", ")}; el código dice otra cosa.`);
      if (result.mismatch) parts.push("El código y el texto impreso no coinciden en algún dato: compáralos con la foto.");
      if (aiProblem) parts.push(`${aiProblem} Completa lo que falte mirando la foto, que queda guardada como respaldo.`);
      setNotice(parts.join(" "));
      setDraft(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la foto."); }
    finally { setBusy(""); }
  };

  const scanned = (codes: CodeRead[]) => {
    setScanning(false); setError(""); setNotice("");
    const code = parseProductCodes(codes);
    if (code.mixed) { setError("Se ven códigos de productos distintos: escanea uno solo."); return; }
    const base = draft ?? fresh();
    const result = applyScan(base, code, !!base.imageId);
    if (result.rejected) { setError("Ese código es de otro producto, distinto al de la foto. Guarda o descarta este antes de escanear otro."); return; }
    setDraft(result.draft);
    const parts = [result.filled.length ? `Código leído: ${result.filled.join(", ")}.` : "Código leído; no trae lote ni vencimiento reconocibles (queda guardado en el registro)."];
    if (result.kept.length) parts.push(`Se mantuvo lo que escribiste en ${result.kept.join(", ")}; el código dice otra cosa.`);
    if (result.mismatch) parts.push("Algún dato no coincidía con lo leído de la foto: revisa la etiqueta.");
    if (!result.draft.imageId) parts.push("Toma además la foto de la etiqueta: ahí están las medidas y el resto de los datos.");
    setNotice(parts.join(" "));
  };

  /**
   * Una foto o un código nuevo no se mezcla con un producto guardado que se está editando ni, dentro de Implantología,
   * con un registro a medias de otra pieza.
   */
  const blocked = () => {
    if (busy) return true;
    if (!draft) return false;
    const wanted = cleanTooth(startTooth);
    const reason = draft.id !== null ? "Estás editando un producto guardado: guarda o cancela antes de registrar otro."
      : embedded && wanted && cleanTooth(draft.tooth) !== wanted ? `Primero guarda o descarta el producto ${draft.tooth ? `de la ${draft.tooth}` : "sin pieza"} que está abierto.` : "";
    if (!reason) return false;
    setNotice(""); setError(reason);
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  };
  const openScanner = () => { if (blocked()) return; setError(""); setNotice(""); setScanning(true); };
  const openPicker = (input: RefObject<HTMLInputElement | null>) => { if (!blocked()) input.current?.click(); };

  useEffect(() => {
    if (!tool) return;
    tool.current = {
      // Mientras se guarda no se sale: si fallara, el aviso y lo escrito tienen que seguir a la vista.
      saving: () => busy === "saving",
      pending: () => draft !== null || busy !== "",
      discard: () => {
        if (busy === "saving") return;
        generation.current++;
        if (draft && draft.id === null && draft.imageId) void onRemoveImage(draft.imageId).catch(() => undefined);
        setDraft(null); setBusy(""); setScanning(false); setError(""); setNotice("");
      },
    };
    return () => { tool.current = null; };
  });

  const set = (key: keyof Draft, value: string) => setDraft(previous => {
    if (!previous) return previous;
    const suggested = new Set(previous.suggested), fromCode = new Set(previous.fromCode); suggested.delete(key); fromCode.delete(key);
    return { ...previous, [key]: value, suggested, fromCode,
      // El tipo de producto sigue a lo que el profesional dijo que es; al cambiar el tipo, un nombre que ya no corresponde se quita.
      ...(key === "category" ? { categoryBy: "user" as const, kind: previous.kind && kindCategory(previous.kind) !== value ? "" : previous.kind } : {}),
      ...(key === "kind" ? (value ? { category: kindCategory(value), categoryBy: "user" as const } : { categoryBy: "" as const }) : {}) };
  });

  const save = async () => {
    if (!draft || busy) return;
    setBusy("saving"); setError("");
    try {
      const { id: _id, imageUrl: _url, suggested: _suggested, fromCode: _fromCode, categoryBy, scan, moveTo, was, ...data } = draft;
      const place = !slot ? {} : moveTo ? { implantId: slot.implant.id, stage: moveTo, tooth: slot.implant.tooth } : { implantId: null, stage: "" };
      // Lo que había al abrirlo: el servidor no pisa un cambio hecho en otro lado.
      const expected = !was ? {} : { toothWas: was.tooth, ...(slot ? { from: { implantId: was.implantId, stage: was.stage } } : {}) };
      let unplace = false;
      if (!slot && was?.implantId && cleanTooth(data.tooth) !== was.tooth) {
        if (!window.confirm(`Este producto está anotado en la fase «${phaseLabel(was.stage)}» de un implante. Al cambiar la pieza dental se quita de esa fase. ¿Continuar?`)) { setBusy(""); return; }
        unplace = true;
      }
      const body = { ...data, patientId: patient.id, ...place, ...expected, ...(unplace ? { unplace } : {}),
        // En una fase manda lo que se dijo que es; sin nombre ni lectura no se supone que sea un implante.
        ...(slot ? { placedOn: data.placedOn || (draft.id === null ? slot.date || today() : ""), category: data.kind ? kindCategory(data.kind) : categoryBy ? data.category : "otro" } : { kind: draft.id === null ? "" : data.kind }) };
      // Sin tipo elegido ni leído y sin medidas, una foto o un código podrían ser de un injerto o membrana.
      const implantKnown = slot ? body.category === "implante" : categoryBy !== "" || (!scan && !data.imageId) || !!(data.diameter && data.length);
      const done = slot ? `Guardado en ${phaseLabel(moveTo || slot.phase)}.` : "Producto registrado en la ficha.";
      if (draft.id === null) {
        const saved = await call<{ product: ProductView }>("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        setProducts(previous => [saved.product, ...(previous ?? [])].sort((a, b) => b.placedOn.localeCompare(a.placedOn) || b.id - a.id));
        setDraft(null); setNotice(slot && !moveTo ? "Quedó en la ficha, fuera de las fases." : done); onChanged(); onSaved?.(saved.product, true, implantKnown);
      } else {
        const saved = await call<{ product: ProductView }>("/api/productos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: draft.id }) });
        setProducts(previous => (previous ?? []).map(item => item.id === saved.product.id ? saved.product : item));
        setDraft(null); setNotice(slot && !moveTo ? "Quedó en la ficha, fuera de las fases." : done); onChanged();
        // En una fase, mover algo a otra cuenta como anotarlo allí; corregirlo en la misma, no.
        onSaved?.(saved.product, !!slot && !!moveTo && moveTo !== slot.phase, implantKnown);
      }
    } catch (reason) { if (draft.id !== null) await load(); setError(reason instanceof Error ? reason.message : "No se pudo guardar el producto."); }
    finally { setBusy(""); }
  };

  const discard = async () => {
    if (!draft) return;
    // Una foto tomada y no guardada se quita para no dejar imágenes sueltas en la ficha.
    if (draft.id === null && draft.imageId && !window.confirm("¿Descartar este producto? Se borrará también la foto que acabas de tomar.")) return;
    if (draft.id === null && draft.imageId) await onRemoveImage(draft.imageId).catch(() => undefined);
    setDraft(null); setError(""); setNotice("");
  };

  const edit = (product: ProductView) => { setOtherKind(false); setMore(false); setDraft({ ...blank(), kind: slot ? pieceKind(product).replace(/^Otro$/, "") : product.kind, moveTo: slot?.phase ?? "", id: product.id, imageId: product.imageId, imageUrl: product.imageUrl, category: product.category, brand: product.brand, reference: product.reference, lot: product.lot, serial: product.serial, expiry: product.expiry, manufacturer: product.manufacturer, model: product.model, diameter: product.diameter, length: product.length, registration: product.registration, manufactured: product.manufactured, gtin: product.gtin, details: product.details, code: product.code, tooth: product.tooth, note: product.note, placedOn: product.placedOn, aiRead: product.aiRead, categoryBy: "user", was: { tooth: product.tooth, implantId: product.implantId, stage: product.stage } }); setNotice(""); setError(""); };

  /** Pone en esta fase algo de la misma pieza dental que estaba fuera de las fases. */
  const putHere = async (product: ProductView) => {
    if (!slot || busy) return;
    setBusy("saving"); setError(""); setNotice("");
    try {
      const saved = await call<{ product: ProductView }>("/api/productos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: product.id, place: { implantId: slot.implant.id, stage: slot.phase }, from: { implantId: product.implantId, stage: product.stage } }) });
      setProducts(previous => (previous ?? []).map(item => item.id === saved.product.id ? saved.product : item));
      setNotice(`Guardado en ${phaseLabel(slot.phase)}.`); onChanged(); onSaved?.(saved.product, true, saved.product.category === "implante");
    } catch (reason) { await load(); setError(reason instanceof Error ? reason.message : "No se pudo poner en esta fase."); }
    finally { setBusy(""); }
  };

  const remove = async (product: ProductView) => {
    const trace = [product.lot && `lote ${product.lot}`, product.serial && `serie ${product.serial}`].filter(Boolean).join(", ");
    const photo = product.imageId ? ` Se borrará también ${slot ? "su foto" : "la foto de la etiqueta"}.` : "";
    if (!window.confirm(`¿Desea eliminar ${slot ? `«${pieceKind(product)}»` : "este producto"}${trace ? ` (${trace})` : ""} del registro del paciente?${photo} No se puede deshacer.`)) return;
    setError("");
    try {
      await call("/api/productos?id=" + product.id, { method: "DELETE" });
      setProducts(previous => (previous ?? []).filter(item => item.id !== product.id));
      if (product.imageId) onImageGone(product.imageId);
      setDraft(previous => previous?.id === product.id ? null : previous);
      setNotice("Producto eliminado del registro."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar el producto."); }
  };

  const setDetail = (index: number, item: ProductDetail | null) => setDraft(previous => {
    if (!previous) return previous;
    const details = item ? Object.assign([...previous.details], { [index]: item }) : previous.details.filter((_, position) => position !== index);
    const suggested = new Set(previous.suggested); suggested.delete("details");
    return { ...previous, details, suggested };
  });
  /** Fecha completa o solo mes, según lo que traiga la etiqueta. */
  const dateType = (value: string) => value.length === 7 ? "month" : "date";

  const working = busy === "photo" || busy === "reading";
  const flagged = (key: string) => draft?.fromCode.has(key) ? "border-emerald-500 bg-emerald-50" : draft?.suggested.has(key) ? "border-amber-400 bg-amber-50" : "border-[#d8d5e4] bg-white";

  const pdf = !!products?.length && <a href={`/api/productos/pdf?patientId=${patient.id}`} target="_blank" rel="noopener noreferrer" className={secondary} data-testid="products-pdf"><FileText className="size-4" aria-hidden="true"/>Imprimir registro (PDF)</a>;

  const here = slot && products ? stagePieces(products, slot.implant, slot.phase) : [];
  const loose = slot && products ? loosePieces(products, slot.implant, slot.implants) : [];
  /** Tarjeta de una pieza: qué es, su descripción y lo que permite rastrearla. */
  const pieceBody = (product: ProductView) => <>
    {product.thumbUrl ? <a href={product.imageUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir la foto de ${pieceKind(product)}`} className="shrink-0"><img src={product.thumbUrl} alt={`Foto de ${pieceKind(product)}`} className="size-16 rounded-lg border border-[#e6e4ee] object-cover" loading="lazy"/></a>
      : <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-[#f3f1f7] text-[#473a6d]" title="Anotado a mano"><Pencil className="size-5" aria-hidden="true"/></span>}
    <div className="min-w-0 flex-1 text-sm">
      <span className="inline-block rounded-full bg-[#ece8f6] px-2 py-0.5 text-xs font-semibold text-[#473a6d]" data-testid="stage-piece-kind">{pieceKind(product)}</span>
      <p className="mt-1 break-words font-medium">{[product.brand, product.model, measureText(product)].filter(Boolean).join(" · ") || "Sin descripción"}</p>
      <p className="break-words text-[#615f73]">{[product.reference && `Ref. ${product.reference}`, product.lot && `Lote ${product.lot}`, product.serial && `Serie ${product.serial}`, product.expiry && `Vence ${expiryLabel(product.expiry)}`].filter(Boolean).join(" · ")}</p>
      {(product.manufacturer || product.registration || product.manufactured || product.gtin || product.details.length > 0) && <details><summary className="cursor-pointer py-1 text-[#473a6d]">Todos los datos de la etiqueta</summary><ul className="break-words text-[#615f73]">{[
        product.manufacturer && `Fabricante: ${product.manufacturer}`, product.registration && `Registro sanitario: ${product.registration}`,
        product.manufactured && `Fabricación: ${expiryLabel(product.manufactured)}`, product.gtin && `GTIN: ${product.gtin}`,
        ...product.details.map(item => item.label ? `${item.label}: ${item.value}` : item.value),
      ].filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
      {product.note && <p className="break-words text-[#615f73]">{product.note}</p>}
    </div>
  </>;

  const measureFields = draft && <div className="grid grid-cols-2 gap-3 sm:col-span-2">
    <label className="text-sm font-semibold">Diámetro (mm)<input value={draft.diameter} onChange={event => set("diameter", event.target.value)} inputMode="decimal" maxLength={30} className={`${inputBase} ${flagged("diameter")}`} data-testid="product-diameter"/></label>
    <label className="text-sm font-semibold">Largo (mm)<input value={draft.length} onChange={event => set("length", event.target.value)} inputMode="decimal" maxLength={30} className={`${inputBase} ${flagged("length")}`} data-testid="product-length"/></label>
  </div>;
  const brandField = draft && <label className="text-sm font-semibold">Marca<input value={draft.brand} onChange={event => set("brand", event.target.value)} maxLength={80} className={`${inputBase} ${flagged("brand")}`} data-testid="product-brand"/></label>;
  const traceFields = draft && <>
    <label className="text-sm font-semibold">Referencia / código<input value={draft.reference} onChange={event => set("reference", event.target.value)} maxLength={60} className={`${inputBase} ${flagged("reference")}`} data-testid="product-reference"/></label>
    <label className="text-sm font-semibold">Lote<input value={draft.lot} onChange={event => set("lot", event.target.value)} maxLength={60} autoCapitalize="characters" className={`${inputBase} ${flagged("lot")}`} data-testid="product-lot"/></label>
  </>;
  const restFields = draft && <>
    <label className="text-sm font-semibold">N.º de serie<input value={draft.serial} onChange={event => set("serial", event.target.value)} maxLength={60} autoCapitalize="characters" className={`${inputBase} ${flagged("serial")}`} data-testid="product-serial"/></label>
    <label className="min-w-0 text-sm font-semibold">Fecha de fabricación<input type={dateType(draft.manufactured)} value={draft.manufactured} onChange={event => set("manufactured", event.target.value)} className={`${inputBase} ${dateBox} ${flagged("manufactured")}`} data-testid="product-manufactured"/></label>
    <label className="min-w-0 text-sm font-semibold">Vencimiento<input type={dateType(draft.expiry)} value={draft.expiry} onChange={event => set("expiry", event.target.value)} className={`${inputBase} ${dateBox} ${flagged("expiry")}`} data-testid="product-expiry"/></label>
    <label className="text-sm font-semibold">Fabricante<input value={draft.manufacturer} onChange={event => set("manufacturer", event.target.value)} maxLength={200} className={`${inputBase} ${flagged("manufacturer")}`}/></label>
    <label className="text-sm font-semibold">Registro sanitario<input value={draft.registration} onChange={event => set("registration", event.target.value)} maxLength={100} className={`${inputBase} ${flagged("registration")}`} data-testid="product-registration"/></label>
    <label className="text-sm font-semibold">GTIN (código de barras)<input value={draft.gtin} onChange={event => set("gtin", event.target.value)} inputMode="numeric" maxLength={14} className={`${inputBase} ${flagged("gtin")}`} data-testid="product-gtin"/></label>
    {!slot && <label className="text-sm font-semibold">Pieza (FDI)<input value={draft.tooth} onChange={event => set("tooth", event.target.value)} inputMode="decimal" placeholder="Ej.: 3.6" maxLength={4} className={input} data-testid="product-tooth"/></label>}
    <label className="min-w-0 text-sm font-semibold">{slot ? "Fecha en que se usó" : "Fecha de colocación"}<input type="date" value={draft.placedOn || (slot && draft.id === null ? slot.date || today() : "")} max={today()} onChange={event => set("placedOn", event.target.value)} className={`${input} ${dateBox}`}/></label>
  </>;
  const detailFields = draft && <fieldset className={`space-y-2 rounded-lg border p-3 ${draft.suggested.has("details") ? "border-amber-400 bg-amber-50" : "border-[#e6e4ee]"}`} data-testid="product-details"><legend className="px-1 text-sm font-semibold">Otros datos de la etiqueta</legend>
    {draft.details.map((item, index) => <div key={index} className="flex items-end gap-1">
      <div className="min-w-0 flex-1">
        <input value={item.label} aria-label={`Nombre del dato ${index + 1}`} placeholder="Nombre del dato" maxLength={60} onChange={event => setDetail(index, { ...item, label: event.target.value })} className="block w-full bg-transparent px-1 text-xs font-semibold text-[#615f73]"/>
        <input value={item.value} aria-label={`Valor del dato ${index + 1}`} placeholder="Lo que dice" maxLength={240} onChange={event => setDetail(index, { ...item, value: event.target.value })} className={`${input} !mt-0.5`}/>
      </div>
      <button type="button" aria-label={`Quitar el dato ${index + 1}`} onClick={() => setDetail(index, null)} className="rounded-lg p-3 text-rose-800 hover:bg-rose-50"><X className="size-4"/></button>
    </div>)}
    {draft.details.length < MAX_DETAILS && <button type="button" className={secondary} onClick={() => setDetail(draft.details.length, { label: "", value: "" })}><Plus className="size-4" aria-hidden="true"/>Agregar dato</button>}
  </fieldset>;
  const modelField = draft && <label className="block text-sm font-semibold">{slot ? "Descripción" : "Producto (como dice la etiqueta)"}<textarea value={draft.model} onChange={event => set("model", event.target.value)} maxLength={200} rows={2} className={`${inputBase} py-2 ${flagged("model")}`} data-testid="product-model"/></label>;
  // En una fase, las medidas van a la vista en un implante o cuando la etiqueta las trae.
  const measured = !!draft && (draft.category === "implante" && !!draft.kind || !!draft.diameter || !!draft.length);
  // Si algo propuesto por la foto o el código quedó en «Más datos», se abre para que se revise antes de guardar.
  const unreviewed = !!draft && ["serial", "manufactured", "expiry", "manufacturer", "registration", "gtin", "details"].some(key => draft.suggested.has(key) || draft.fromCode.has(key));
  const kinds = slot ? pieceKindOptions(slot.kinds) : [];
  const listed = !!draft && kinds.includes(draft.kind);
  const kindField = draft && slot && <fieldset className={`rounded-lg ${draft.suggested.has("kind") ? "border border-amber-400 bg-amber-50 p-2" : ""}`} data-testid="product-kind">
    <legend className="text-sm font-semibold">¿Qué es?{draft.suggested.has("kind") && <span className="ml-1 font-normal text-amber-900">Propuesto por la foto: confírmalo</span>}</legend>
    <div className="mt-1 flex flex-wrap gap-2">{kinds.map(kind => <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => { setOtherKind(false); set("kind", draft.kind === kind && !draft.suggested.has("kind") ? "" : kind); }} className={`min-h-11 rounded-full border px-3 text-sm font-medium ${draft.kind === kind ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d8d5e4] bg-white text-[#473a6d]"}`}>{kind}</button>)}
      <button type="button" aria-pressed={otherKind || (!!draft.kind && !listed)} onClick={() => { setOtherKind(true); if (listed) set("kind", ""); }} className={`min-h-11 rounded-full border border-dashed px-3 text-sm font-medium ${otherKind || (draft.kind && !listed) ? "border-[#473a6d] bg-[#f3f1f7] text-[#473a6d]" : "border-[#473a6d] bg-white text-[#473a6d]"}`} data-testid="product-kind-other">Otro…</button></div>
    {(otherKind || (!!draft.kind && !listed)) && <input value={draft.kind} onChange={event => set("kind", event.target.value)} maxLength={60} placeholder="Escribe qué es" aria-label="Qué es" className={input} data-testid="product-kind-text"/>}
  </fieldset>;
  const ready = !!draft && !!(draft.imageId || draft.brand || draft.reference || draft.lot || draft.serial || draft.gtin || draft.code || ((slot || draft.id !== null) && (draft.kind.trim() || draft.model.trim())));

  return <section className={compact ? "space-y-3" : "space-y-4"} data-testid="biomedical-products">
    <div className={compact ? "" : "surface"}>
      {slot && <h4 className="mb-2 font-semibold">Lo que usé en esta etapa</h4>}
      {!compact && <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">{embedded ? `Producto${(draft ? draft.tooth : startTooth) ? ` · pieza ${draft ? draft.tooth : startTooth}` : ""}` : "Productos biomédicos y trazabilidad"}</h3><p className="mt-1 max-w-2xl text-sm text-[#615f73]">Escanea el código y fotografía la etiqueta de un implante, injerto, membrana o pilar: la app lee las medidas, el lote y los demás datos, tú confirmas, y queda en la ficha con la pieza y la fecha.</p></div>
        {pdf}
      </div>}
      <div className={compact ? "grid grid-cols-2 gap-2" : "mt-3 flex flex-wrap gap-2"}>
        {!slot && <button type="button" className={`${primary} ${compact ? "col-span-2" : ""}`} disabled={working} onClick={openScanner} data-testid="products-scan"><ScanLine className="size-5" aria-hidden="true"/>{compact ? "Escanear etiqueta" : "Escanear código"}</button>}
        <button type="button" className={slot ? `${primary} col-span-2` : compact ? `${secondary} col-span-2` : primary} disabled={working} onClick={() => openPicker(cameraRef)} data-testid="products-camera">{working ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true"/> : <Camera className="size-5" aria-hidden="true"/>}{busy === "photo" ? "Guardando foto…" : busy === "reading" ? "Leyendo la foto…" : slot ? "Foto de lo que usé" : compact ? "Foto de la etiqueta" : "Tomar foto del producto"}</button>
        {slot && <button type="button" className={secondary} disabled={working} onClick={openScanner} data-testid="products-scan"><ScanLine className="size-4" aria-hidden="true"/>Escanear código</button>}
        <button type="button" className={secondary} disabled={working} onClick={() => openPicker(galleryRef)}><ImagePlus className="size-4" aria-hidden="true"/>{compact ? "Galería" : "Elegir de la galería"}</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} data-testid="products-camera-input"/>
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }}/>
        {!draft && <button type="button" className={slot ? `${secondary} col-span-2` : secondary} disabled={busy !== ""} onClick={() => { setOtherKind(false); setMore(false); setDraft(fresh()); setNotice(""); setError(""); }} data-testid="products-manual">{slot ? <><Plus className="size-4" aria-hidden="true"/>Anotar pieza o material</> : compact ? "Sin foto" : "Registrar sin foto"}</button>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && !error && <p role="status" className="mt-3 rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d]">{notice}</p>}
    </div>

    {draft && <div ref={formRef} className={`space-y-3 ${compact ? "rounded-xl border border-[#c9c4da] p-3" : "surface"}`} data-testid="product-form">
      <h3 className="font-semibold">{slot ? draft.id === null ? "Nueva pieza o material" : "Editar" : draft.id === null ? "Nuevo producto" : "Editar producto"} · {patient.name}</h3>
      {/* Mientras se lee la etiqueta no se escribe: la lectura reemplazaría lo escrito. */}
      <fieldset disabled={working} className="m-0 min-w-0 border-0 p-0">
      <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]"}`}>
        <div>{draft.imageUrl ? <a href={draft.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir la foto de la etiqueta en grande"><img src={draft.imageUrl} alt="Foto de la etiqueta del producto" className="max-h-80 w-full rounded-xl border border-[#e6e4ee] bg-white object-contain"/></a> : !slot && <p className="rounded-xl border border-dashed border-[#c9c4da] p-4 text-sm text-[#615f73]">{draft.id === null ? "Sin foto: puedes agregarla con «Tomar foto del producto»." : "Sin foto."}</p>}</div>
        <div className="space-y-3">
          {draft.fromCode.size > 0 && <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="product-qr-note"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true"/><span>Los campos en verde vienen del <strong>código de la etiqueta</strong> (lectura exacta).</span></p>}
          {draft.suggested.size > 0 && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950" data-testid="product-ai-note"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true"/><span>La IA leyó los campos marcados en amarillo. <strong>Compáralos con la foto</strong>, sobre todo lote y serie, y corrige lo que haga falta antes de guardar.</span></p>}
          {slot ? kindField : <fieldset><legend className="text-sm font-semibold">Tipo de producto</legend>
            <div className="mt-1 flex flex-wrap gap-2">{PRODUCT_CATEGORIES.map(item => <button key={item.id} type="button" onClick={() => set("category", item.id)} aria-pressed={draft.category === item.id} className={`min-h-11 rounded-full border px-3 text-sm font-medium ${draft.category === item.id ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d8d5e4] bg-white text-[#473a6d]"}`}>{item.label}</button>)}</div></fieldset>}
          {slot ? <div className="space-y-3">
            {modelField}
            <div className="grid gap-3 sm:grid-cols-2">{brandField}{measured && measureFields}<div className="grid grid-cols-2 gap-3 sm:col-span-2">{traceFields}</div></div>
            <details className="rounded-lg border border-[#e6e4ee] px-3" open={more || unreviewed} onToggle={event => setMore(event.currentTarget.open)} data-testid="product-more"><summary className="cursor-pointer py-3 text-sm font-semibold text-[#473a6d]">Más datos (serie, fechas, fabricante…)</summary>
              <div className="space-y-3 pb-3"><div className="grid gap-3 sm:grid-cols-2">{!measured && measureFields}{restFields}</div>{detailFields}</div></details>
            {draft.id !== null && <label className="block text-sm font-semibold">Fase<select value={draft.moveTo} onChange={event => set("moveTo", event.target.value)} className={input} data-testid="product-move">{stageOptions([slot.phase]).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="">Fuera de las fases</option></select></label>}
          </div> : <>
          {modelField}
          <div className="grid gap-3 sm:grid-cols-2">{measureFields}{brandField}{traceFields}{restFields}</div>
          {detailFields}
          </>}
          {draft.code && <p className="break-all rounded-lg bg-[#f3f1f7] p-3 text-xs text-[#473a6d]" data-testid="product-code">Contenido del código: {draft.code}{/^https?:\/\/\S+$/.test(draft.code) && <> · <a href={draft.code} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Abrir la página del fabricante</a></>}</p>}
          <label className="block text-sm font-semibold">Nota (opcional)<textarea value={draft.note} onChange={event => set("note", event.target.value)} maxLength={600} rows={2} className={`${input} py-2`}/></label>
          {!slot && missingTrace(draft) && <p className="flex items-start gap-2 text-sm text-[#7a5a12]"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true"/>Sin lote ni número de serie no se puede rastrear el producto. Puedes guardarlo igual y completarlo después.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy !== "" || !ready} onClick={() => void save()} data-testid="product-save">{busy === "saving" ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true"/> : null}{busy === "saving" ? "Guardando…" : !slot ? "Guardar producto" : draft.id !== null ? "Guardar cambios" : `Agregar a ${phaseLabel(slot.phase)}`}</button>
            <button type="button" className={secondary} disabled={busy !== ""} onClick={() => void discard()}>{draft.id === null ? "Descartar" : "Cancelar"}</button>
          </div>
        </div>
      </div>
      </fieldset>
    </div>}

    {slot && (products === null ? <p className="text-sm text-[#615f73]" role="status">Cargando…</p> : <>
      {here.length ? <ul className="space-y-2" data-testid="stage-pieces">{here.map(product => <li key={product.id} className="flex items-start gap-3 rounded-xl border border-[#e6e4ee] bg-white p-3" data-testid="stage-piece">
        {pieceBody(product)}
        <div className="flex shrink-0 flex-col">
          <button type="button" className="rounded-lg p-3 text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-40" disabled={busy !== "" || !!draft} onClick={() => edit(product)} aria-label={`Editar ${pieceKind(product)}`}><Pencil className="size-4" aria-hidden="true"/></button>
          <button type="button" className="rounded-lg p-3 text-rose-800 hover:bg-rose-50 disabled:opacity-40" disabled={busy !== "" || !!draft} onClick={() => void remove(product)} aria-label={`Eliminar ${pieceKind(product)}`}><Trash2 className="size-4" aria-hidden="true"/></button>
        </div>
      </li>)}</ul> : !draft && <p className="text-sm text-[#6b6a7c]" data-testid="stage-empty">Aún no hay piezas ni materiales en esta fase.</p>}
      {!draft && loose.length > 0 && <details className="rounded-xl border border-dashed border-[#c9c4da] px-3" data-testid="stage-loose"><summary className="cursor-pointer py-3 text-sm font-semibold text-[#473a6d]">Registrados en la pieza {slot.implant.tooth}, fuera de las fases ({loose.length})</summary>
        <ul className="space-y-2 pb-3">{loose.map(product => <li key={product.id} className="rounded-xl border border-[#e6e4ee] bg-white p-3"><div className="flex items-start gap-3">{pieceBody(product)}</div>
          <button type="button" className={`${secondary} mt-2 w-full`} disabled={busy !== ""} onClick={() => void putHere(product)} data-testid="stage-put">Poner en {phaseLabel(slot.phase)}</button></li>)}</ul></details>}
    </>)}
    {!slot && (!embedded || !!products?.length) && <ProductList embedded={embedded} compact={compact} count={products?.length ?? 0}>
      {compact && <div className="mt-2">{pdf}</div>}
      {products === null ? <p className="mt-2 text-sm text-[#615f73]" role="status">Cargando…</p> : !products.length ? <p className="mt-2 text-sm text-[#615f73]">Este paciente aún no tiene productos registrados.</p> :
        <ul className="mt-3 space-y-3">{products.map(product => <li key={product.id} className={`grid gap-3 rounded-xl border border-[#e6e4ee] bg-white p-3 ${compact ? "" : "sm:grid-cols-[96px_minmax(0,1fr)_auto]"}`} data-testid="product-item">
          {product.thumbUrl ? <a href={product.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir la foto de la etiqueta"><img src={product.thumbUrl} alt={`Etiqueta: ${categoryLabel(product.category)} ${product.brand}`.trim()} className="h-24 w-24 rounded-lg border border-[#e6e4ee] object-cover" loading="lazy"/></a> : <span className="flex h-24 w-24 items-center justify-center rounded-lg bg-[#f3f1f7] text-xs text-[#615f73]">Sin foto</span>}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{product.kind || categoryLabel(product.category)}{product.brand ? ` · ${product.brand}` : ""}{product.tooth ? ` · pieza ${product.tooth}` : ""}{product.implantId && product.stage ? ` · ${phaseLabel(product.stage)}` : ""}</p>
            <p className="mt-0.5 text-[#615f73]">{dayLabel(product.placedOn)}{product.createdByName ? ` · ${product.createdByName}` : ""}</p>
            {(product.model || measureText(product)) && <p className="mt-1 break-words font-medium">{[product.model, measureText(product)].filter(Boolean).join(" · ")}</p>}
            <p className="mt-1 break-words">{[product.reference && `Ref. ${product.reference}`, product.lot && `Lote ${product.lot}`, product.serial && `Serie ${product.serial}`, product.expiry && `Vence ${expiryLabel(product.expiry)}`].filter(Boolean).join(" · ") || <span className="text-[#7a5a12]">Sin lote ni serie registrados</span>}</p>
            {(product.manufacturer || product.registration || product.manufactured || product.gtin || product.details.length > 0) && <details className="mt-1"><summary className="cursor-pointer py-1 text-[#473a6d]">Todos los datos de la etiqueta</summary><ul className="break-words text-[#615f73]">{[
              product.manufacturer && `Fabricante: ${product.manufacturer}`, product.registration && `Registro sanitario: ${product.registration}`,
              product.manufactured && `Fabricación: ${expiryLabel(product.manufactured)}`, product.gtin && `GTIN: ${product.gtin}`,
              ...product.details.map(item => item.label ? `${item.label}: ${item.value}` : item.value),
            ].filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
            {product.note && <p className="mt-1 text-[#615f73]">{product.note}</p>}
          </div>
          <div className={`flex gap-2 ${compact ? "" : "sm:flex-col"}`}>
            <button type="button" className={secondary} disabled={busy !== ""} onClick={() => edit(product)} aria-label="Editar producto"><Pencil className="size-4" aria-hidden="true"/>Editar</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50" onClick={() => void remove(product)} aria-label="Eliminar producto"><Trash2 className="size-4" aria-hidden="true"/>Quitar</button>
          </div>
        </li>)}</ul>}
    </ProductList>}
    {scanning && <CodeScanner onRead={scanned} onClose={() => setScanning(false)}/>}
  </section>;
}

function ProductList({ embedded, compact, count, children }: { embedded: boolean; compact: boolean; count: number; children: ReactNode }) {
  if (embedded) return <details className={compact ? "rounded-xl border border-[#e6e4ee] px-3" : "surface"} data-testid="product-list"><summary className="cursor-pointer py-2 font-semibold">Productos registrados ({count})</summary>{children}</details>;
  return <div className="surface" data-testid="product-list"><h3 className="font-semibold">Productos registrados</h3>{children}</div>;
}
