"use client";
/* eslint-disable @next/next/no-img-element -- Las imágenes clínicas son rutas autenticadas que se cargan con la sesión del navegador. */
/**
 * Pestaña «Implantología»: abajo del implantograma no hay nada más. Cada diente abre la ventana de su implante, con sus etapas
 * (cada una con su fecha, las piezas y materiales usados, nota e imágenes) y todas sus imágenes (capturar, subir, pegar o arrastrar).
 * La app propone fichas desde las etiquetas y el odontograma; nada se guarda sin que el profesional confirme.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Download, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import type { ClinicalImage, OdontogramData } from "@/app/clinical-data";
import { emptyOdontogram } from "@/app/clinical-data";
import { BiomedicalProducts, type ProductTool, type ProductView } from "@/components/biomedical-products";
import { CaptureLink } from "@/components/capture-link";
import { CutOffer, type Offer } from "@/components/cut-offer";
import type { EvolutionHistoryNote } from "@/components/evolution-history";
import { ImplantIdBox, ImplantSheet, StageList, StagePage, StageStrip, stageDate, stagePending, type SheetTab, type StageEdit } from "@/components/implant-sheet";
import type { CaptureView } from "@/lib/capture-bridge";
import { cutViews } from "@/lib/capture-crop";
import type { DetectedView } from "@/lib/capture-detect";
import { thumbUrl } from "@/lib/image-compress";
import { IMPLANT_BRANDS } from "@/lib/dictation/implant-brands";
import {
  COMMON_DIAMETERS, COMMON_LENGTHS, IMPLANT_CONNECTIONS, IMPLANT_VIEWS, LOWER_ARCH, UPPER_ARCH,
  archOrder, imageKindForView, implantSuggestions, isCutView, labelMeasures, mm, phaseLabel, stageMarks, stageOptions, suggestConnection,
  type Implant, type ImplantFields, type ImplantLabel, type ImplantView, type KnownConnection, type RecordedPhase, type StageChange,
} from "@/lib/implants";
import type { Piece } from "@/lib/implant-pieces";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayLabel = (iso: string) => iso.split("-").reverse().join("-");
const fdi = (code: number) => `${Math.floor(code / 10)}.${code % 10}`;
const BRANDS = [...new Set(IMPLANT_BRANDS.map(item => item.brand))].sort((a, b) => a.localeCompare(b, "es"));

type Draft = { id: number | null; tooth: string; phase: string; brand: string; system: string; connection: string; diameter: string; length: string; placedOn: string; torque: string; isq: string; productId: string; note: string };
const toDraft = (item: Partial<ImplantFields> & { id?: number }): Draft => ({
  id: item.id ?? null, tooth: item.tooth ?? "", phase: item.phase ?? "", brand: item.brand ?? "", system: item.system ?? "", connection: item.connection ?? "",
  diameter: mm(item.diameter ?? null), length: mm(item.length ?? null), placedOn: item.placedOn ?? "",
  torque: item.torque == null ? "" : String(item.torque), isq: item.isq == null ? "" : String(item.isq),
  productId: item.productId ? String(item.productId) : "", note: item.note ?? "",
});

/** Lleva la ficha abierta a lo último guardado: lo que no se tocó desde `from` sigue a `saved`; lo escrito queda pendiente. */
const rebase = (draft: Draft, from: Draft, saved: Draft) => Object.fromEntries((Object.keys(saved) as (keyof Draft)[]).map(key => [key, draft[key] === from[key] ? saved[key] : draft[key]])) as Draft;

const PHASE_COLOR: Record<string, string> = {
  "": "border-[#473a6d] bg-[#e6e4ee] text-[#2a2540]", evaluacion: "border-slate-500 bg-slate-100 text-slate-800", plan: "border-sky-600 bg-sky-100 text-sky-900",
  cirugia: "border-rose-600 bg-rose-100 text-rose-900", osteointegracion: "border-stone-500 bg-stone-100 text-stone-800", conexion: "border-amber-600 bg-amber-100 text-amber-900",
  rehabilitacion: "border-violet-600 bg-violet-100 text-violet-900", mantencion: "border-emerald-600 bg-emerald-100 text-emerald-900",
};
const input = "mt-1 block min-h-11 w-full rounded-lg border border-[#d8d5e4] bg-white px-3 text-base";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";
const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm font-medium ${on ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#d8d5e4] bg-white text-[#473a6d]"}`;

/** Una evolución compilada por una etapa: igual a la evolución general, pero con el implante y la fase de donde vino. */
type StageEvolutionNote = EvolutionHistoryNote & { implantId: number | null; stagePhase: string | null };

const usable = (file: File) => /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 12 * 1024 * 1024;
const UNUSABLE = "Usa imágenes JPG, PNG o WebP de hasta 12 MB. Los archivos DICOM no se cargan: captura el corte.";

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

export function ImplantologyPanel({ patient, teeth, crowns, images, showCapturer, onUploadImage, onRemoveImage, onImageGone, onChanged,
  evolutionRail, odontogram = emptyOdontogram(), onSyncOdontogram = async () => {}, onEditEvolution, onAnnulEvolution = () => {} }: {
  patient: { id: number; name: string };
  /** Estados del odontograma actual: de ahí salen las propuestas de fichas. */
  teeth: Record<number, string>;
  crowns?: Record<number, { foundation?: string }>;
  images: ClinicalImage[];
  /** Si se ofrece la capturadora de prueba (sin firmar). Solo se ve además en Windows. */
  showCapturer: boolean;
  onUploadImage: (file: File, kind: "Radiografía" | "Captura CBCT" | "Foto clínica" | "Producto biomédico", note: string) => Promise<ClinicalImage>;
  onRemoveImage: (id: number) => Promise<void>;
  /** La foto de una etiqueta se borró junto con su producto. */
  onImageGone: (id: number) => void;
  onChanged: () => void;
  /**
   * Lo que hace que la evolución de una etapa funcione igual que la evolución general (misma barra de accesos
   * directos, mismo anular/editar, mismo odontograma). Todos opcionales, con valores por defecto que no hacen
   * nada: así esta pantalla sigue funcionando sola (por ejemplo en el arnés de pruebas) sin toda la ficha detrás.
   */
  evolutionRail?: (note: EvolutionHistoryNote, latest: boolean) => ReactNode;
  odontogram?: OdontogramData;
  onSyncOdontogram?: (note: EvolutionHistoryNote) => void | Promise<void>;
  onEditEvolution?: (note: EvolutionHistoryNote, title: string, body: string) => Promise<void>;
  onAnnulEvolution?: (note: EvolutionHistoryNote) => void;
}) {
  const [implants, setImplants] = useState<Implant[] | null>(null);
  const [labels, setLabels] = useState<ImplantLabel[]>([]);
  /** Conexiones ya confirmadas por marca y sistema, de la más reciente a la más antigua. */
  const [known, setKnown] = useState<KnownConnection[]>([]);
  /** Evoluciones que compilaron las etapas de los implantes de este paciente (una por cada vez que se guardó algo). */
  const [evolutions, setEvolutions] = useState<StageEvolutionNote[]>([]);
  /** La ficha de la ventana abierta; null = ventana cerrada. */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [tab, setTab] = useState<SheetTab>("etapas");
  /** Cambia al abrir la ventana o pasar a otro implante: lo que había dentro no se arrastra. */
  const [visit, setVisit] = useState(0);
  /** Tipo con que entra lo que se sube o captura en «Imágenes»; las fotos clínicas se agregan dentro de su etapa. */
  const [view, setView] = useState<CaptureView>("Transversal");
  /** Etapa cuya pantalla está abierta, con lo que se está escribiendo en ella. */
  const [stage, setStage] = useState<StageEdit | null>(null);
  /** Lo mínimo de cada producto del paciente, para el resumen de las etapas. */
  const [pieces, setPieces] = useState<Piece[]>([]);
  /** Tipos de pieza que la cuenta ya usó. */
  const [kinds, setKinds] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "saving" | "image">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<ClinicalImage | null>(null);
  const [windows, setWindows] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const working = useRef(false);
  /** Cambia cada vez que se abre o cierra una ficha: una respuesta tardía no pisa la que está en pantalla. */
  const session = useRef(0);
  /** Cambia con cada guardado hecho aquí: una lectura pedida antes no lo deshace. */
  const written = useRef(0);
  /** Capturas retenidas por nombre distinto, aún sin decidir. */
  const held = useRef(0);
  const productTool = useRef<ProductTool | null>(null);
  /** Imágenes subidas que son una ventana de Blue Sky y esperan que se elija qué guardar. */
  const [offers, setOffers] = useState<Offer[]>([]);
  /** Se está revisando una imagen o guardando los cortes elegidos: no se cambia de implante. */
  const cutting = useRef(false);
  const offered = useRef(0);
  /** Vistas previas en memoria: se liberan al decidir, al cambiar de implante o al salir de la pestaña. */
  const previews = useRef(new Set<string>());
  const preview = (file: File) => { const url = URL.createObjectURL(file); previews.current.add(url); return url; };
  const release = (urls: string[]) => urls.forEach(url => { URL.revokeObjectURL(url); previews.current.delete(url); });
  useEffect(() => { const urls = previews.current; return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }; }, []);
  const dropOffers = useCallback(() => {
    previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current.clear(); setOffers([]);
  }, []);

  useEffect(() => { setWindows(/Windows/i.test(navigator.userAgent)); }, []);
  const load = useCallback(async () => {
    try {
      let data: { implants: Implant[]; labels: ImplantLabel[]; connections?: KnownConnection[]; pieces?: Piece[]; kinds?: string[]; evolutions?: StageEvolutionNote[] }, before: number;
      do {
        before = written.current;
        data = await call(`/api/implantes?patientId=${patient.id}`, { cache: "no-store" });
      } while (before !== written.current);
      setImplants(data.implants); setLabels(data.labels); setKnown(data.connections ?? []); setPieces(data.pieces ?? []); setKinds(data.kinds ?? []); setEvolutions(data.evolutions ?? []); setError("");
      return data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudieron cargar los implantes."); return null; }
  }, [patient.id]);
  /** Pone en pantalla un implante recién guardado. */
  const apply = useCallback((implant: Implant) => {
    written.current++;
    setImplants(previous => [...(previous ?? []).filter(item => item.id !== implant.id), implant].sort((a, b) => a.tooth.localeCompare(b.tooth) || a.id - b.id));
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    // La tecla es solo para la imagen: la ventana del implante que quede debajo no se cierra con ella.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const current = draft?.id ? implants?.find(item => item.id === draft.id) ?? null : null;
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  // Si el implante de la ficha abierta cambió (aquí o en otro equipo), la ficha se pone al día sin perder lo escrito.
  useEffect(() => {
    const saved = draft?.id ? implants?.find(item => item.id === draft.id) : undefined;
    if (!draft || !saved || !baseline) return;
    const next = toDraft(saved), serialized = JSON.stringify(next);
    if (serialized === baseline) return;
    setDraft(rebase(draft, JSON.parse(baseline) as Draft, next)); setBaseline(serialized);
  }, [implants, draft, baseline]);
  const dismiss = () => { session.current++; dropOffers(); setStage(null); setDraft(null); setBaseline(""); setError(""); setNotice(""); };
  useEffect(() => {
    if (!draft?.id || !implants || implants.some(item => item.id === draft.id)) return;
    productTool.current?.discard(); session.current++; dropOffers();
    setDraft(null); setBaseline(""); setNotice(""); setError("Ese implante ya no está: su ficha se eliminó desde otro equipo.");
  }, [implants, draft, dropOffers]);

  /** Abre la ventana (o cambia su contenido) con otra ficha. */
  const show = (next: Draft, section: SheetTab) => {
    session.current++; setVisit(value => value + 1); dropOffers(); setStage(null);
    setDraft(next); setBaseline(JSON.stringify(next)); setTab(section); setError(""); setNotice("");
  };
  /** Antes de cerrar o cambiar de implante: si queda algo sin guardar, se pregunta. */
  const leave = (): boolean => {
    // Con un guardado en curso se espera: un error no puede perderse junto con lo escrito.
    if (busy === "saving" || productTool.current?.saving()) { setNotice("Se está guardando. Espera un momento."); return false; }
    if (cutting.current) { setNotice("Se está revisando o guardando una imagen. Espera un momento."); return false; }
    const pending = [
      dirty && "los cambios sin guardar de este implante",
      productTool.current?.pending() && "el producto a medio registrar, con su foto",
      current && stagePending(current, stage, today()) && "la fecha, la nota o la imagen pegada sin guardar de la etapa",
      offers.length > 0 && "las imágenes aún sin guardar",
      held.current > 0 && "las capturas retenidas por nombre distinto (siguen en la carpeta Imágenes\\SpeakDent del computador)",
    ].filter(Boolean);
    if (pending.length && !window.confirm(`¿Descartar ${pending.join("; ")}?`)) return false;
    productTool.current?.discard();
    return true;
  };
  /** Etiqueta que puso la aplicación al abrir la ficha nueva (no elegida a mano): una recién registrada la reemplaza. */
  const autoLabel = useRef("");
  /** Ficha nueva: si hay una etiqueta de esa pieza sin usar, viene prellenada. */
  const startNew = (tooth: string, extra: Partial<ImplantFields> = {}) => {
    const used = new Set((implants ?? []).map(item => item.productId));
    const label = labels.find(item => item.tooth === tooth && !used.has(item.id));
    const next = toDraft({ tooth, ...(label ? { brand: label.brand, placedOn: label.placedOn, productId: label.id, phase: "cirugia", ...labelMeasures(label) } : {}), ...extra });
    autoLabel.current = next.productId;
    show(next, "datos");
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

  /** Antes de cerrar el lienzo de una etapa o pasar a otra: si queda algo sin guardar, se pregunta. */
  const releaseStage = (): boolean => {
    if (busy === "saving" || productTool.current?.saving()) { setNotice("Se está guardando. Espera un momento."); return false; }
    const pending = [productTool.current?.pending() && "lo que estás anotando, con su foto", current && stagePending(current, stage, today()) && "la fecha, la nota o la imagen pegada sin guardar"].filter(Boolean);
    if (pending.length && !window.confirm(`¿Descartar ${pending.join(" y ")}?`)) return false;
    productTool.current?.discard();
    return true;
  };
  const closeStage = () => { if (releaseStage()) { setStage(null); setError(""); setNotice(""); } };
  const openStage = (phase: RecordedPhase) => {
    if (stage?.phase === phase || (stage && !releaseStage())) return;
    setStage({ phase, date: null, note: null }); setError(""); setNotice("");
  };

  const save = async () => {
    if (!draft || busy) return;
    // La ficha nueva pasa a sus etapas: un producto a medio registrar se termina antes.
    if (!draft.id && productTool.current?.pending()) { setError(""); setNotice("Primero guarda o descarta el producto que estás registrando."); return; }
    setBusy("saving"); setError("");
    const opened = session.current;
    try {
      const { id, ...fields } = draft;
      const { implant } = await send<{ implant: Implant }>(id ? "PATCH" : "POST", { ...fields, ...(id ? { id, base: JSON.parse(baseline) as Draft } : { patientId: patient.id }) });
      apply(implant);
      if (implant.connection && implant.brand) setKnown(previous => [{ brand: implant.brand, system: implant.system, connection: implant.connection }, ...previous]);
      const next = toDraft(implant);
      // Si mientras se guardaba se abrió otra ficha, no se reemplaza lo que hay en pantalla.
      if (session.current === opened) {
        // Lo que se haya escrito mientras se guardaba se conserva como cambio pendiente.
        setDraft(previous => previous ? rebase(previous, draft, next) : next); setBaseline(JSON.stringify(next));
      }
      if (!id && session.current === opened) setTab("etapas");
      setNotice(id ? `Cambios guardados en el implante ${implant.tooth}.` : `Implante ${implant.tooth} guardado. Marca sus etapas o agrega imágenes.`);
      onChanged();
    } catch (reason) {
      // Con un cambio hecho en otro lado, se recarga para que la ficha muestre lo vigente junto a lo escrito.
      if (draft.id) await load();
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el implante.");
    }
    finally { setBusy(""); }
  };

  const remove = async () => {
    if (!draft?.id || busy) return;
    if (productTool.current?.saving()) { setNotice("Se está guardando. Espera un momento."); return; }
    if (!window.confirm(`¿Desea eliminar la ficha del implante ${draft.tooth}? Se borran sus etapas y notas. Sus imágenes y productos seguirán en la ficha del paciente.`)) return;
    setError("");
    try {
      await call("/api/implantes?id=" + draft.id, { method: "DELETE" });
      productTool.current?.discard(); written.current++;
      setImplants(previous => (previous ?? []).filter(item => item.id !== draft.id));
      dismiss(); setNotice("Ficha del implante eliminada."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar el implante."); }
  };

  const addFiles = useCallback(async (files: File[], as: ImplantView = view, phase?: RecordedPhase): Promise<"saved" | "busy" | "failed"> => {
    const target = current;
    if (working.current) return "busy";
    if (!files.length) return "failed";
    if (!target) { setNotice(""); setError("Guarda el implante y luego pega o sube la imagen."); return "failed"; }
    if (!files.every(usable)) { setError(UNUSABLE); return "failed"; }
    working.current = true; setBusy("image"); setError(""); setNotice("");
    let added = 0;
    try {
      for (const original of files) {
        const extension = original.type === "image/png" ? "png" : original.type === "image/webp" ? "webp" : "jpg";
        const file = new File([original], `Implante ${target.tooth} ${as} ${today()}.${extension}`, { type: original.type });
        const image = await onUploadImage(file, imageKindForView(as), [`Implante ${target.tooth}`, phase && phaseLabel(phase), as].filter(Boolean).join(" · "));
        try {
          const { implant } = await send<{ implant: Implant }>("PATCH", { id: target.id, addImage: { imageId: image.id, view: as, ...(phase ? { stage: phase } : {}) } });
          apply(implant);
        } catch (reason) { await onRemoveImage(image.id).catch(() => undefined); throw reason; }
        added++;
      }
      setNotice(`${added === 1 ? "Imagen guardada" : `${added} imágenes guardadas`} en el implante ${target.tooth} de ${patient.name} · ${phase ? `${phaseLabel(phase)} · ` : ""}${as}.`);
      onChanged();
      return "saved";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la imagen."); return "failed"; }
    finally { working.current = false; setBusy(""); }
  }, [current, view, apply, onUploadImage, onRemoveImage, onChanged, patient.name]);

  /**
   * Lo que se sube, pega o arrastra. Si es la ventana completa de Blue Sky Plan, se ofrecen sus cortes antes de guardar;
   * lo demás se guarda como siempre. La capturadora no pasa por aquí: ya recorta sola.
   */
  const receive = useCallback(async (files: File[]) => {
    const target = current;
    if (working.current || cutting.current) return;
    // Dentro de una etapa lo pegado queda en ella: primero se dice si es radiografía o foto clínica.
    if (stage && tab === "etapas") {
      if (!files.length) return;
      if (!files.every(usable)) { setError(UNUSABLE); return; }
      // Lo que ya esperaba respuesta se conserva.
      setError(""); setNotice("Imagen pegada: elige qué es, en «Radiografías y fotos»."); setStage(previous => previous ? { ...previous, pasted: [...(previous.pasted ?? []), ...files] } : previous);
      return;
    }
    // Una radiografía no se recorta; sin implante o con un archivo no admitido, el aviso lo da el guardado.
    if (!target || !files.length || !isCutView(view) || !files.every(usable)) { await addFiles(files); return; }
    const opened = session.current;
    cutting.current = true; working.current = true; setBusy("image"); setError(""); setNotice("");
    const plain: File[] = [], found: Offer[] = [];
    try {
      for (const original of files) {
        // Sin fecha ni nombre en el rótulo: de una imagen subida no se sabe cuándo se tomó ni se puede leer el visor.
        const cuts = await cutViews(original, "all", null, { date: null, partsOnly: true });
        if (session.current !== opened) return;
        if (!cuts.length) { plain.push(original); continue; }
        found.push({ id: ++offered.current, target: target.id, original, url: preview(original), cuts: cuts.map(cut => ({ ...cut, url: preview(cut.file) })),
          chosen: [cuts.find(cut => cut.view === view)?.view ?? cuts[0].view] });
      }
    } finally { cutting.current = false; working.current = false; setBusy(""); }
    if (found.length) { setOffers(list => [...list, ...found]); setTab("imagenes"); }
    if (plain.length) await addFiles(plain);
  }, [current, view, addFiles, stage, tab]);

  const closeOffer = (offer: Offer) => {
    release([offer.url, ...offer.cuts.map(cut => cut.url)]);
    setOffers(list => list.filter(item => item.id !== offer.id));
  };
  const toggleCut = (offer: Offer, cut: DetectedView) => setOffers(list => list.map(item => item.id !== offer.id ? item
    : { ...item, chosen: item.chosen.includes(cut) ? item.chosen.filter(other => other !== cut) : [...item.chosen, cut] }));
  const saveCuts = async (offer: Offer) => {
    if (cutting.current || working.current || offer.target !== current?.id) return;
    cutting.current = true;
    try {
      const wanted = offer.cuts.filter(cut => offer.chosen.includes(cut.view));
      for (const cut of wanted) {
        if (await addFiles([cut.file], cut.view) !== "saved") return;
        // Lo ya guardado sale de la propuesta: reintentar no lo duplica.
        setOffers(list => list.map(item => item.id !== offer.id ? item
          : { ...item, cuts: item.cuts.filter(other => other.view !== cut.view), chosen: item.chosen.filter(other => other !== cut.view) }));
      }
      if (wanted.length > 1) setNotice(`${wanted.length} cortes guardados en el implante ${current.tooth} de ${patient.name}.`);
      closeOffer(offer);
    } finally { cutting.current = false; }
  };
  const saveWhole = async (offer: Offer) => {
    if (cutting.current || working.current || offer.target !== current?.id) return;
    cutting.current = true;
    try { if (await addFiles([offer.original]) === "saved") closeOffer(offer); } finally { cutting.current = false; }
  };
  const offer = offers.find(item => item.target === current?.id);

  // Ctrl+V con la ventana de un implante abierta. El texto pegado en los campos no se intercepta.
  useEffect(() => {
    if (!draft) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
      if (!files.length) return;
      // Texto copiado de Word o Excel suele traer además una imagen: en un campo de texto se pega como texto.
      if (event.target instanceof Element && event.target.closest("input, textarea") && event.clipboardData?.getData("text/plain")) return;
      event.preventDefault();
      void receive(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [draft, receive]);

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
      await receive(files);
    } catch { setError("El navegador no permitió leer lo copiado. Presiona Ctrl+V (en Mac, ⌘V)."); }
  };

  const removeImage = async (imageId: number) => {
    if (!current || busy || working.current) return;
    if (!window.confirm("¿Desea eliminar esta imagen? Se borrará de la ficha del paciente y no se puede deshacer.")) return;
    working.current = true; setBusy("image"); setError("");
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { id: current.id, removeImageId: imageId });
      apply(implant);
      await onRemoveImage(imageId);
      setNotice("Imagen eliminada."); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo quitar la imagen."); }
    finally { working.current = false; setBusy(""); }
  };

  /** Lo último en pantalla: la respuesta de guardar un producto puede llegar después de abrir otra ficha. */
  const screen = useRef({ draft, dirty });
  useEffect(() => { screen.current = { draft, dirty }; });

  /**
   * Al corregir la pieza o el tipo de una etiqueta ya unida, se ofrece quitarla del implante donde quedó mal.
   * Devuelve true si se quitó de alguno (entonces se puede unir al de la pieza correcta).
   */
  const releaseWrong = async (product: ProductView, list: Implant[]) => {
    const wrong = (item: { tooth: string; productId: number | string | null }) => String(item.productId) === String(product.id) && (item.tooth !== product.tooth || product.category !== "implante");
    // Lo que vino de la etiqueta (marca y medidas tal como eran antes de corregirla) se quita junto con ella.
    const old = labels.find(item => item.id === product.id), measures = labelMeasures(old);
    let released = false;
    const open = screen.current.draft;
    if (open && open.id === null && wrong(open)) {
      setDraft(previous => previous && previous.id === null && wrong(previous) ? { ...previous, productId: "",
        brand: previous.brand === old?.brand ? "" : previous.brand, diameter: previous.diameter === mm(measures.diameter) ? "" : previous.diameter, length: previous.length === mm(measures.length) ? "" : previous.length } : previous);
      released = true;
    }
    for (const item of list.filter(wrong)) {
      if (!window.confirm(`Esta etiqueta sigue unida al implante ${item.tooth}. ¿Desea quitarla de ese implante? También se quitan la marca y las medidas que vinieron de ella.`)) continue;
      try {
        const { implant } = await send<{ implant: Implant }>("PATCH", { ...toDraft(item), id: item.id, base: toDraft(item), productId: "", brand: item.brand === old?.brand ? "" : item.brand,
          diameter: item.diameter === measures.diameter ? "" : mm(item.diameter), length: item.length === measures.length ? "" : mm(item.length) });
        apply(implant);
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
    const { draft: open, dirty: pending } = screen.current;
    const measures = labelMeasures(product);
    const here = open && open.tooth === product.tooth ? open : null;
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
      const { implant } = await send<{ implant: Implant }>("PATCH", { ...toDraft(target), id: target.id, base: toDraft(target), productId: String(product.id), brand: target.brand || product.brand, diameter: mm(target.diameter ?? measures.diameter), length: mm(target.length ?? measures.length) });
      apply(implant);
      setNotice(`Etiqueta vinculada al implante ${implant.tooth}.`); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "El producto se guardó, pero no se pudo vincular al implante."); }
  };

  /** Marca, corrige o quita una etapa desde la ventana. */
  const changeStage = async (change: StageChange): Promise<boolean> => {
    if (!current || busy) return false;
    setBusy("saving"); setError(""); setNotice("");
    const opened = session.current;
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { id: current.id, markStage: change });
      apply(implant);
      if (session.current === opened) {
        // La fecha de la cirugía es la de instalación: vale la que se acaba de confirmar.
        if (change.phase === "cirugia") setDraft(previous => previous && previous.id === implant.id ? { ...previous, placedOn: implant.placedOn } : previous);
        setNotice(implant.phase ? `Guardado. Etapa actual: ${phaseLabel(implant.phase)}.` : "Guardado. El implante quedó sin etapa registrada.");
      }
      onChanged();
      return true;
    } catch (reason) {
      await load();
      if (session.current === opened) setError(reason instanceof Error ? reason.message : "No se pudo guardar la etapa.");
      return false;
    } finally { setBusy(""); }
  };

  /**
   * Lo nuevo anotado en una etapa la marca, si aún no estaba marcada. Se pide con la ficha recién leída:
   * si ya la marcaron en otro lado, no se toca. Una fecha de instalación ya registrada nunca se reemplaza desde aquí.
   */
  const ensureMarked = async (id: number, phase: RecordedPhase, date: string) => {
    const data = await load();
    const target = data?.implants.find(item => item.id === id);
    if (!target || stageMarks(target.history, target.phase, target.placedOn)[phase] !== undefined) return data;
    const day = phase === "cirugia" && target.placedOn ? target.placedOn : date;
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { id, markStage: { phase, was: null, date: day } });
      apply(implant);
      if (phase === "cirugia") setDraft(previous => previous && previous.id === implant.id ? { ...previous, placedOn: implant.placedOn } : previous);
      // Una fecha distinta que se estaba escribiendo sigue pendiente de guardar.
      setStage(previous => previous?.phase !== phase ? previous : previous.date === day ? { ...previous, date: null } : { ...previous, dateFrom: day });
      return { ...data!, implants: data!.implants.map(item => item.id === id ? implant : item) };
    } catch (reason) { setError(reason instanceof Error ? `Se guardó, pero la etapa no se pudo marcar: ${reason.message}` : "Se guardó, pero la etapa no se pudo marcar."); return data; }
  };

  /**
   * Una pieza guardada dentro de una etapa. Si es nueva en ella (`added`), la marca con la fecha en que se usó.
   * Corregir una pieza no vuelve a marcar una etapa a la que se quitó la marca. Si es el implante de la cirugía, lo une a la ficha;
   * si dejó de ser un implante, se ofrece quitar esa unión.
   */
  const pieceSaved = async (product: ProductView, added: boolean) => {
    let data = await load();
    if (data && await releaseWrong(product, data.implants)) data = await load();
    const id = product.implantId, phase = product.stage as RecordedPhase;
    if (!data || !id || !phase) return;
    if (added) data = await ensureMarked(id, phase, product.placedOn);
    const target = data?.implants.find(item => item.id === id);
    if (!data || !target || phase !== "cirugia" || product.category !== "implante" || target.productId) return;
    const measures = labelMeasures(product);
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { ...toDraft(target), id: target.id, base: toDraft(target), productId: String(product.id), brand: target.brand || product.brand, diameter: mm(target.diameter ?? measures.diameter), length: mm(target.length ?? measures.length) });
      apply(implant); await load(); onChanged();
    } catch (reason) { setError(reason instanceof Error ? `La pieza se guardó, pero no se pudo unir a la ficha del implante: ${reason.message}` : "La pieza se guardó, pero no se pudo unir a la ficha del implante."); }
  };

  /** Agrega lo escrito o dictado en la etapa como una evolución más (nunca reemplaza lo ya guardado). */
  const saveNote = async () => {
    if (!current || !stage || stage.note === null || !stage.note.trim() || busy) return;
    const { phase } = stage, date = stageDate(current, stage, today()), id = current.id;
    const was = stage.noteFrom ?? current.stageNotes[phase] ?? "";
    const note = was ? `${was}\n\n${stage.note.trim()}` : stage.note.trim();
    setBusy("saving"); setError(""); setNotice("");
    try {
      const { implant } = await send<{ implant: Implant }>("PATCH", { id, stageNote: { phase, was, note } });
      apply(implant);
      setStage(previous => previous?.phase !== phase ? previous : { ...previous, note: null, noteFrom: undefined });
      await ensureMarked(id, phase, date);
      await load();
      setNotice("Agregado a la evolución de esta etapa."); onChanged();
    } catch (reason) {
      await load();
      setError(reason instanceof Error ? reason.message : "No se pudo agregar a la evolución.");
    } finally { setBusy(""); }
  };

  const addStageImages = async (files: File[], as: ImplantView) => {
    if (!current || !stage) return;
    const { phase } = stage, date = stageDate(current, stage, today()), id = current.id;
    let saved = 0;
    for (const file of files) {
      if (await addFiles([file], as, phase) !== "saved") break;
      saved++;
      // Cada una sale de las pendientes al guardarse: reintentar no la duplica.
      setStage(previous => previous?.phase === phase && previous.pasted ? { ...previous, pasted: previous.pasted.filter(other => other !== file) } : previous);
    }
    if (!saved) return;
    if (saved > 1) setNotice(`${saved} imágenes guardadas en el implante ${current.tooth} de ${patient.name} · ${phaseLabel(phase)} · ${as}.`);
    await ensureMarked(id, phase, date);
  };

  const ordered = archOrder(implants ?? []);
  const at = current ? ordered.findIndex(item => item.id === current.id) : -1;
  const step = (direction: 1 | -1) => {
    const next = ordered[at + direction];
    if (!next || !leave()) return false;
    show(toDraft(next), tab);
    return true;
  };

  const suggestions = implants ? implantSuggestions({ implants, labels, teeth, crowns }) : [];
  const label = current?.productId ? labels.find(item => item.id === current.productId) : undefined;
  const trace = current ? [label?.lot && `Lote ${label.lot}`, label?.serial && `Serie ${label.serial}`, label?.reference && `Ref. ${label.reference}`].filter(Boolean).join(" · ") : "";
  const sameTooth = draft && !draft.id ? (implants ?? []).filter(item => item.tooth === draft.tooth).length : 0;
  const proposed = draft && !draft.connection ? suggestConnection(known, draft.brand, draft.system) : "";

  const arch = (codes: number[]) => <div className="grid grid-cols-8 gap-1 lg:grid-cols-16">{codes.map(code => {
    const tooth = fdi(code), found = (implants ?? []).filter(item => item.tooth === tooth), last = found.at(-1);
    const suggested = last ? undefined : suggestions.find(item => item.tooth === tooth);
    return <button key={code} type="button" disabled={!implants} onClick={() => last ? show(toDraft(last), "etapas") : startNew(tooth, suggested?.draft)} data-testid={`implant-tooth-${code}`}
      aria-label={last ? `Implante ${tooth}, ${phaseLabel(last.phase)}` : `Registrar implante en ${tooth}${suggested ? `, sugerido desde ${suggested.source === "etiqueta" ? "la etiqueta" : "el odontograma"}` : ""}`}
      className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${last ? `${PHASE_COLOR[last.phase]} border-2` : suggested ? "border-2 border-dashed border-[#473a6d] bg-white text-[#473a6d]" : "border-[#e0dde9] bg-white text-[#6b6a7c] hover:border-[#473a6d]"}`}>
      <span>{tooth}</span>
      {last ? <svg viewBox="0 0 16 22" className="mt-0.5 h-5 w-4" aria-hidden="true"><path d="M4 1h8v4H4zM5 6h6l-1.5 14h-3z" fill="currentColor"/><path d="M3 9h10M3.5 12h9M4 15h8" stroke="currentColor" strokeWidth="1.2"/></svg> : <span className="h-5 text-xs leading-5" aria-hidden="true">{suggested ? "+" : ""}</span>}
      {found.length > 1 && <span className="text-[10px]">×{found.length}</span>}
    </button>;
  })}</div>;

  const messages: ReactNode = <>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && !error && <p role="status" className="rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d]">{notice}</p>}
  </>;
  const mustSave = draft !== null && (draft.id === null || dirty);
  /** El lienzo de una etapa está a la vista. */
  const canvas = stage !== null && tab === "etapas";

  /** Datos propios del implante: en la ficha nueva y dentro de Cirugía. */
  const dataFields = draft && <>
        <div className="grid grid-cols-2 items-end gap-3 @2xl:grid-cols-4">
          <label className="min-w-0 text-sm font-semibold">Pieza (FDI)<select value={draft.tooth} onChange={e => set("tooth", e.target.value)} className={input}>{[...UPPER_ARCH, ...LOWER_ARCH].map(code => <option key={code} value={fdi(code)}>{fdi(code)}</option>)}</select></label>
          {draft.id === null && <label className="min-w-0 text-sm font-semibold">Instalación<input type="date" max={today()} value={draft.placedOn} onChange={e => set("placedOn", e.target.value)} className={`${input} min-w-0 max-w-full appearance-none`}/></label>}
          <label className="min-w-0 text-sm font-semibold">Marca<input list="implant-brand-list" value={draft.brand} maxLength={80} onChange={e => set("brand", e.target.value)} className={input} data-testid="implant-brand"/></label>
          <label className="min-w-0 text-sm font-semibold">Sistema o modelo<input value={draft.system} maxLength={80} onChange={e => set("system", e.target.value)} className={input}/></label>
          <label className="min-w-0 text-sm font-semibold">Diámetro (mm)<input list="implant-diameter-list" inputMode="decimal" value={draft.diameter} maxLength={6} onChange={e => set("diameter", e.target.value)} className={input} data-testid="implant-diameter"/></label>
          <label className="min-w-0 text-sm font-semibold">Largo (mm)<input list="implant-length-list" inputMode="decimal" value={draft.length} maxLength={6} onChange={e => set("length", e.target.value)} className={input} data-testid="implant-length"/></label>
          <label className="min-w-0 text-sm font-semibold">Torque (Ncm)<input inputMode="numeric" value={draft.torque} maxLength={3} onChange={e => set("torque", e.target.value)} className={input}/></label>
          <label className="min-w-0 text-sm font-semibold">ISQ<input inputMode="numeric" value={draft.isq} maxLength={3} onChange={e => set("isq", e.target.value)} className={input}/></label>
        </div>
        <datalist id="implant-brand-list">{BRANDS.map(brand => <option key={brand} value={brand}/>)}</datalist>
        <datalist id="implant-diameter-list">{COMMON_DIAMETERS.map(value => <option key={value} value={mm(value)}/>)}</datalist>
        <datalist id="implant-length-list">{COMMON_LENGTHS.map(value => <option key={value} value={mm(value)}/>)}</datalist>
        <fieldset data-testid="implant-connection"><legend className="text-sm font-semibold">Tipo de conexión</legend><div className="mt-1 flex flex-wrap gap-2">{IMPLANT_CONNECTIONS.map(item => <button key={item.id} type="button" aria-pressed={draft.connection === item.id} className={chip(draft.connection === item.id)} onClick={() => set("connection", draft.connection === item.id ? "" : item.id)}>{item.label}</button>)}</div>
          {proposed && <button type="button" onClick={() => set("connection", proposed)} data-testid="implant-connection-proposal" className="mt-2 min-h-11 rounded-xl border border-dashed border-[#473a6d] bg-white px-3 py-2 text-left text-sm font-semibold text-[#473a6d]">Usar «{IMPLANT_CONNECTIONS.find(item => item.id === proposed)?.label}», la que ya registraste para {[draft.brand.trim(), draft.system.trim()].filter(Boolean).join(" ")}</button>}
        </fieldset>
        <label className="block text-sm font-semibold">Etiqueta (trazabilidad)<select value={draft.productId} onChange={e => chooseLabel(e.target.value)} className={input} data-testid="implant-label"><option value="">Sin etiqueta vinculada</option>{labels.map(item => <option key={item.id} value={item.id}>{[item.tooth || "sin pieza", item.brand, item.lot && `lote ${item.lot}`, item.serial && `serie ${item.serial}`, dayLabel(item.placedOn)].filter(Boolean).join(" · ")}</option>)}</select></label>
  </>;
  const noteField = draft && <label className="block text-sm font-semibold">{draft.id === null ? "Nota (opcional)" : "Nota general del implante (opcional)"}<textarea rows={2} value={draft.note} maxLength={600} onChange={e => set("note", e.target.value)} className={`${input} py-2`} data-testid="implant-note"/></label>;
  const noteAndRemove = draft && draft.id !== null && <>
    {noteField}
    <button type="button" disabled={busy !== ""} className="inline-flex min-h-11 w-full items-center justify-center gap-2 text-sm font-semibold text-rose-800" onClick={() => void remove()} data-testid="implant-delete"><Trash2 className="size-4" aria-hidden="true"/>Eliminar implante</button>
  </>;

  return <section className="space-y-4" data-testid="implantology">
    <div className="surface space-y-3">
      <div><h3 className="font-semibold">Implantología</h3><p className="mt-1 text-sm text-[#615f73]">Toca un diente para abrir su implante.</p></div>
      <div className="space-y-2" role="group" aria-label="Implantograma">{arch(UPPER_ARCH)}<div className="border-t border-dashed border-[#d8d5e4]"/>{arch(LOWER_ARCH)}</div>
      <div className="flex flex-wrap gap-2 text-xs" data-testid="implant-legend">{stageOptions((implants ?? []).map(item => item.phase)).map(item => <span key={item.id} className={`rounded-full border px-2 py-1 ${PHASE_COLOR[item.id]}`}>{item.label}</span>)}
        {suggestions.length > 0 && <span className="rounded-full border border-dashed border-[#473a6d] px-2 py-1 text-[#473a6d]">Sugerido, sin ficha</span>}</div>
      {implants === null && !error && <p role="status" className="text-sm text-[#615f73]">Cargando implantes…</p>}
      {implants === null && error && <button type="button" className={secondary} onClick={() => { setError(""); void load(); }}>Volver a intentar</button>}
      {!draft && messages}
    </div>

    {draft && <ImplantSheet title={draft.id === null ? `Nuevo implante ${draft.tooth}` : `Implante ${current?.tooth ?? draft.tooth}`} patientName={patient.name}
      position={at >= 0 ? { at, total: ordered.length } : null} summary={current && <ImplantIdBox item={current} extra={trace}/>}
      tabs={current ? [{ id: "etapas", label: "Etapas" }, { id: "imagenes", label: current.images.length ? `Imágenes (${current.images.length})` : "Imágenes" }] : null}
      tab={tab} onTab={next => { setTab(next); setNotice(""); }} wide={stage !== null} canvas={canvas}
      onEscape={() => { if (!canvas) return false; closeStage(); return true; }} scrollKey={`${visit}-${tab}-${stage?.phase ?? ""}`} covered={open !== null} locked={busy !== ""} onStep={step} canClose={leave} onClosed={dismiss}
      footer={(error || notice || mustSave) ? <>{messages}
        {mustSave && <button type="button" className={`${primary} w-full`} disabled={busy !== ""} onClick={() => void save()} data-testid="implant-save">{busy === "saving" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>}{draft.id ? "Guardar cambios" : "Guardar implante"}</button>}
      </> : null}>

      {current && <div hidden={tab !== "etapas"} className={canvas ? "md:flex md:h-full" : ""}>
        {/* Las etapas siguen a la vista; en el teléfono, con un lienzo abierto, quedan arriba de él. */}
        <div className={`space-y-4 ${stage ? "max-md:hidden md:w-72 md:shrink-0 md:overflow-y-auto md:overscroll-contain md:pr-3" : ""}`} data-testid="implant-stage-column">
          <StageList item={current} pieces={pieces} open={stage?.phase} onOpen={openStage}/>
          {noteAndRemove}
        </div>
        {stage && <div key={`${current.id}-${stage.phase}`} className="gd-implant-canvas md:min-w-0 md:flex-1 md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain md:border-l md:border-[#ebe9f2] md:pl-4" data-testid="implant-canvas">
        <StageStrip item={current} pieces={pieces} open={stage.phase} onOpen={openStage}/>
        <StagePage key={`${current.id}-${stage.phase}`} item={current} edit={stage} today={today()} busy={busy !== ""} images={images}
          evolutions={evolutions.filter(n => n.implantId === current.id && n.stagePhase === stage.phase)}
          allEvolutions={evolutions.filter(n => n.implantId === current.id)}
          odontogram={odontogram} evolutionRail={evolutionRail} onSyncOdontogram={onSyncOdontogram} onEditEvolution={onEditEvolution} onAnnulEvolution={onAnnulEvolution}
          onEdit={change => setStage(previous => previous ? { ...previous, ...change } : previous)} onBack={closeStage} onChange={changeStage} onNote={() => void saveNote()}
          onImages={(files, as) => void addStageImages(files, as)} onOpenImage={setOpen} onRemoveImage={id => void removeImage(id)}>
          <BiomedicalProducts key={`${visit}-${stage.phase}`} embedded compact tool={productTool} patient={patient} startTooth={current.tooth}
            slot={{ implant: current, implants: implants ?? [], phase: stage.phase, date: stageDate(current, stage, today()), kinds }}
            onSaved={(product, added) => void pieceSaved(product, added)}
            onUploadImage={onUploadImage} onRemoveImage={onRemoveImage} onImageGone={onImageGone} onChanged={() => { void load(); onChanged(); }}/>
          {stage.phase === "cirugia" && <details className="rounded-xl border border-[#e6e4ee] px-3" data-testid="implant-data"><summary className="cursor-pointer py-3 text-sm font-semibold text-[#473a6d]">Datos del implante (medidas, conexión, torque, ISQ)</summary><div className="space-y-4 pb-3" data-testid="implant-form">{dataFields}</div></details>}
        </StagePage>
        </div>}
      </div>}

      {draft.id === null && <div className="@container space-y-4" data-testid="implant-form">
        {/* Mientras se guarda el implante no se empieza un producto: al terminar, la ficha cambia a sus etapas. */}
        <fieldset disabled={busy === "saving"} className="min-w-0">
          <BiomedicalProducts key={visit} embedded compact tool={productTool} patient={patient} startTooth={draft.tooth} onSaved={(product, created, implantKnown) => void productSaved(product, created, implantKnown)}
            onUploadImage={onUploadImage} onRemoveImage={onRemoveImage} onImageGone={onImageGone} onChanged={() => { void load(); onChanged(); }}/>
        </fieldset>
        {sameTooth > 0 && <p className="text-sm text-[#7a5a12]">Ya hay una ficha de implante en la {draft.tooth}. Guarda otra solo si es un implante distinto.</p>}
        {dataFields}
        {noteField}
        {draft.phase && <p className="text-sm text-[#615f73]">Se guardará en etapa «{phaseLabel(draft.phase)}». Después puedes cambiarla en Etapas.</p>}
      </div>}

      {current && <div hidden={tab !== "imagenes"} className="space-y-3" data-testid="implant-images"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void receive([...e.dataTransfer.files]); }}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de imagen">{IMPLANT_VIEWS.filter((item): item is CaptureView => item !== "Foto clínica").map(item => <button key={item} type="button" aria-pressed={view === item} className={chip(view === item)} onClick={() => setView(item)}>{item}</button>)}</div>
        {showCapturer && windows && <CaptureLink key={current.id} target={`implante ${current.tooth}`} patientName={patient.name} view={view} busy={busy === "image"} onHeld={count => { held.current = count; }}
          onCapture={(file, as) => addFiles([file], as)} onProblem={message => { setNotice(""); setError(message); }}/>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={primary} disabled={busy !== ""} onClick={() => fileRef.current?.click()}>{busy === "image" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <ImagePlus className="size-4" aria-hidden="true"/>}{busy === "image" ? "Guardando…" : "Subir imagen"}</button>
          <button type="button" className={secondary} disabled={busy !== ""} onClick={() => void pasteButton()} data-testid="implant-paste"><ClipboardPaste className="size-4" aria-hidden="true"/>Pegar</button>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void receive([...(e.target.files ?? [])]); e.target.value = ""; }} data-testid="implant-file"/>
        </div>
        {offer && <CutOffer key={offer.id} offer={offer} waiting={offers.length - 1} patientName={patient.name} view={view} busy={busy !== ""}
          onToggle={cut => toggleCut(offer, cut)} onSaveCuts={() => void saveCuts(offer)} onSaveWhole={() => void saveWhole(offer)} onDiscard={() => closeOffer(offer)}/>}
        {current.images.length ? <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">{current.images.map(item => {
          const image = images.find(found => found.id === item.imageId);
          return <li key={item.imageId} className="overflow-hidden rounded-xl border border-[#e6e4ee] bg-white">
            {image ? <button type="button" className="block h-36 w-full bg-[#1f1b30]" onClick={() => setOpen(image)} aria-label={`Abrir ${item.view}`}><img src={thumbUrl(image.url)} loading="lazy" alt={`${item.view}, implante ${current.tooth}`} className="h-36 w-full object-contain"/></button> : <p className="flex h-36 items-center justify-center text-xs text-[#615f73]">Cargando…</p>}
            <div className="flex items-center justify-between gap-2 px-2 py-1"><span className="min-w-0 text-sm font-medium">{item.view}{item.stage && <span className="block truncate text-xs font-normal text-[#615f73]">{phaseLabel(item.stage)}</span>}</span><button type="button" className="rounded-lg p-2 text-rose-800 hover:bg-rose-50" aria-label={`Eliminar imagen ${item.view}`} onClick={() => void removeImage(item.imageId)}><Trash2 className="size-4"/></button></div>
          </li>;
        })}</ul> : <p className="text-sm text-[#6b6a7c]">Aún no hay imágenes de este implante.</p>}
        {showCapturer && windows && <details className="rounded-xl border border-[#e6e4ee] px-3" data-testid="implant-capturer">
          <summary className="cursor-pointer py-3 text-sm font-semibold text-[#473a6d]">Instalar capturadora (Windows, versión de prueba)</summary>
          <p className="text-sm text-[#615f73]">Versión 0.3: con este implante abierto, captura un corte o «Capturar todo»; SpeakDent ubica solo las vistas de Blue Sky Plan. Si tenías la anterior, ciérrala antes de abrir esta. Aún no está firmada; se descarga solo desde un computador con Windows.</p>
          <a href="/descargas/capturadora-speakdent-prueba.zip" download className={`${secondary} my-3`}><Download className="size-4" aria-hidden="true"/>Descargar capturadora</a>
        </details>}
        <p className="text-xs text-[#615f73]">Las capturas no sustituyen el estudio original para diagnóstico.</p>
      </div>}
    </ImplantSheet>}

    {/* Va al <body>, por encima de la ventana del implante. */}
    {open && createPortal(<div role="dialog" aria-modal="true" aria-label={open.name} className="fixed inset-0 z-[90] flex flex-col bg-[#2a2540]/95 p-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3"><strong>{open.note || open.name}</strong><button type="button" className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar imagen" onClick={() => setOpen(null)}><X/></button></div>
      <img src={open.url} alt={open.note || open.name} className="min-h-0 flex-1 object-contain"/>
    </div>, document.body)}
  </section>;
}
