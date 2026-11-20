"use client";
/**
 * Firma o timbre del profesional, en su identificación (Configuración → Profesionales y «Mi identificación»).
 * Se dibuja con el dedo (iPhone) o se sube una imagen; se guarda recortada al trazo y se usa sola en todos sus
 * documentos: certificados, recetas, consentimientos y presupuestos.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Maximize2, Pencil, Save, Trash2 } from "lucide-react";
import { BASELINE_RATIO, backingSize, inkBounds, outputScale, strokeWidth, worthTrimming } from "@/lib/signature-image";

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("No se pudo leer la imagen.")); image.src = src; });

/** Recorta el espacio en blanco alrededor del trazo de un canvas o imagen y devuelve un PNG (o "" si está vacío). */
export function trimToDataUrl(source: HTMLCanvasElement | HTMLImageElement): string {
  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  const work = document.createElement("canvas");
  work.width = width; work.height = height;
  const ctx = work.getContext("2d");
  if (!ctx || !width || !height) return "";
  ctx.drawImage(source, 0, 0);
  const bounds = inkBounds(ctx.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) return "";
  const scale = outputScale(bounds);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(bounds.width * scale)); out.height = Math.max(1, Math.round(bounds.height * scale));
  const octx = out.getContext("2d");
  if (!octx) return "";
  octx.imageSmoothingQuality = "high";
  octx.drawImage(work, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Firma lista para imprimir: la guardada, recortada al trazo (las firmas antiguas traían mucho blanco alrededor). */
export function useTrimmedMark(mark: string): string {
  const [trimmed, setTrimmed] = useState<{ source: string; value: string }>({ source: "", value: "" });
  useEffect(() => {
    if (!mark) return;
    let alive = true;
    void loadImage(mark).then(image => {
      const bounds = (() => { const c = document.createElement("canvas"); c.width = image.naturalWidth; c.height = image.naturalHeight; const x = c.getContext("2d"); if (!x) return null; x.drawImage(image, 0, 0); return inkBounds(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height); })();
      const value = bounds && worthTrimming(bounds, image.naturalWidth, image.naturalHeight) ? trimToDataUrl(image) || mark : mark;
      if (alive) setTrimmed({ source: mark, value });
    }).catch(() => { if (alive) setTrimmed({ source: mark, value: mark }); });
    return () => { alive = false; };
  }, [mark]);
  return trimmed.source === mark ? trimmed.value : mark;
}

async function saveMark(documentMark: string): Promise<string> {
  const response = await fetch("/api/documentos/imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentMark }) });
  const result = await response.json() as { documentMark?: string; error?: string };
  if (!response.ok || typeof result.documentMark !== "string") throw new Error(result.error || "No se pudo guardar la firma.");
  return result.documentMark;
}

type Point = { x: number; y: number };
type Layer = HTMLImageElement | HTMLCanvasElement;
const layerSize = (layer: Layer) => layer instanceof HTMLImageElement ? { width: layer.naturalWidth, height: layer.naturalHeight } : { width: layer.width, height: layer.height };

/** Traza una línea suave (curvas por puntos medios) en coordenadas de pantalla. */
function drawStroke(ctx: CanvasRenderingContext2D, points: Point[], width: number) {
  if (!points.length) return;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1f1c33"; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) { ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01); ctx.stroke(); return; }
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1]; ctx.lineTo(last.x, last.y); ctx.stroke();
}

/**
 * Cuadro de firma grande: casi todo el ancho en iPhone (94vw, ≈235–260 px de alto), hasta 720 px en computador,
 * lienzo a la densidad real de la pantalla (trazo nítido), línea guía «Firme aquí» y modo pantalla completa.
 * Al guardar se recorta al trazo (lo que se imprime es solo la firma).
 */
export function SignatureEditor({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const layer = useRef<Layer | null>(null);
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const size = useRef({ width: 0, height: 0, scale: 1 });
  const [mark, setMark] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** Redibuja todo: la imagen base (firma guardada, subida o trazos anteriores) y los trazos en curso. */
  const render = useCallback(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height, scale } = size.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = "high";
    if (layer.current) {
      const natural = layerSize(layer.current), pad = Math.min(16, width * 0.04);
      const fit = Math.min((width - pad * 2) / natural.width, (height - pad * 2) / natural.height);
      const w = natural.width * fit, h = natural.height * fit;
      // Apoya la firma sobre la línea guía, centrada.
      const y = Math.min(height - pad - h, Math.max(pad, height * BASELINE_RATIO - h * 0.85));
      ctx.drawImage(layer.current, (width - w) / 2, y, w, h);
    }
    const line = strokeWidth(width);
    for (const points of strokes.current) drawStroke(ctx, points, line);
    if (current.current) drawStroke(ctx, current.current, line);
  }, []);

  /** Junta lo dibujado en una sola imagen recortada (para cambiar de tamaño o pantalla completa sin perder nada). */
  const flatten = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.current.length) return;
    const work = document.createElement("canvas"); work.width = canvas.width; work.height = canvas.height;
    work.getContext("2d")?.drawImage(canvas, 0, 0);
    const bounds = inkBounds(work.getContext("2d")?.getImageData(0, 0, work.width, work.height).data ?? [], work.width, work.height, 2);
    strokes.current = [];
    if (!bounds) { layer.current = null; return; }
    const cut = document.createElement("canvas"); cut.width = bounds.width; cut.height = bounds.height;
    cut.getContext("2d")?.drawImage(work, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    layer.current = cut;
  }, []);

  // El lienzo sigue el tamaño en pantalla a la densidad del dispositivo (3× en iPhone): trazo nítido.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (Math.round(rect.width) === Math.round(size.current.width) && Math.round(rect.height) === Math.round(size.current.height)) return;
      flatten();
      const backing = backingSize(rect.width, rect.height, window.devicePixelRatio);
      canvas.width = backing.width; canvas.height = backing.height;
      size.current = { width: rect.width, height: rect.height, scale: backing.scale };
      render();
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(canvas);
    // Safari antiguo: además de touch-action, se bloquea el desplazamiento mientras se firma.
    const block = (event: TouchEvent) => event.preventDefault();
    canvas.addEventListener("touchstart", block, { passive: false }); canvas.addEventListener("touchmove", block, { passive: false });
    return () => { observer.disconnect(); canvas.removeEventListener("touchstart", block); canvas.removeEventListener("touchmove", block); };
  }, [flatten, render]);

  // Pantalla completa: la página de atrás no se mueve; Escape vuelve.
  useEffect(() => {
    if (!full) return;
    const html = document.documentElement, previous = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => { html.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [full]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/documentos/imagen", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { documentMark?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer tu firma.");
      let saved = data.documentMark ?? "";
      // Migración: la firma antigua (cuadro de 200 px con mucho blanco) se guarda recortada al trazo, una sola vez.
      if (saved) {
        const image = await loadImage(saved);
        const c = document.createElement("canvas"); c.width = image.naturalWidth; c.height = image.naturalHeight;
        const x = c.getContext("2d");
        if (x) {
          x.drawImage(image, 0, 0);
          const bounds = inkBounds(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (bounds && worthTrimming(bounds, c.width, c.height)) {
            const trimmed = trimToDataUrl(image);
            if (trimmed) saved = await saveMark(trimmed).catch(() => saved);
          }
        }
      }
      if (alive) setMark(saved);
    }).catch(reason => { if (alive) { setMark(""); setError(reason instanceof Error ? reason.message : "No se pudo leer tu firma."); } });
    return () => { alive = false; };
  }, []);

  // Muestra la firma guardada en el cuadro.
  useEffect(() => {
    if (!mark) return;
    let alive = true;
    void loadImage(mark).then(image => {
      if (!alive) return;
      layer.current = image; strokes.current = []; render();
      setHasImage(true); setDirty(false);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [mark, render]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = [point(event)]; render();
    setHasImage(true); setDirty(true); setError(""); setNotice("");
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!current.current) return;
    event.preventDefault();
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const rect = event.currentTarget.getBoundingClientRect();
    const events = native.getCoalescedEvents?.() ?? [];
    if (events.length) for (const e of events) current.current.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    else current.current.push(point(event));
    render();
  };
  const stop = () => { if (current.current) { strokes.current.push(current.current); current.current = null; } };
  const pickFile = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) { setError("Elige una imagen PNG, JPG o WebP de hasta 8 MB."); return; }
    try {
      const url = URL.createObjectURL(file);
      const image = await loadImage(url).finally(() => URL.revokeObjectURL(url));
      layer.current = image; strokes.current = []; render();
      setHasImage(true); setDirty(true); setError(""); setNotice("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo leer la imagen."); }
  };
  const clear = () => { layer.current = null; strokes.current = []; current.current = null; render(); setHasImage(false); setDirty(true); setError(""); setNotice(""); };
  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      let documentMark = hasImage ? trimToDataUrl(canvas) : "";
      if (hasImage && !documentMark) throw new Error("El cuadro está vacío: firma con el dedo o sube una imagen.");
      if (documentMark.length > 400_000) {
        // Imagen subida con mucho detalle: se guarda como JPG sobre blanco.
        const image = await loadImage(documentMark);
        const flat = document.createElement("canvas"); flat.width = image.naturalWidth; flat.height = image.naturalHeight;
        const fctx = flat.getContext("2d"); if (!fctx) throw new Error("No se pudo preparar la imagen.");
        fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, flat.width, flat.height); fctx.drawImage(image, 0, 0);
        documentMark = flat.toDataURL("image/jpeg", 0.85);
        if (documentMark.length > 400_000) throw new Error("La imagen tiene demasiados detalles. Firma con el dedo o sube una imagen más simple.");
      }
      const saved = await saveMark(documentMark);
      setMark(saved); setDirty(false); setFull(false);
      setNotice(saved ? "Firma guardada. Se usa sola en tus certificados, recetas, consentimientos y presupuestos." : "Firma quitada de tus documentos.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la firma."); }
    finally { setSaving(false); }
  };

  const big = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold disabled:opacity-50";
  return <section className={compact ? "space-y-2" : "rounded-xl border border-[#e6e4ee] bg-white p-4"} data-testid="signature-editor">
    <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eeebf3] text-[#473a6d]"><Pencil className="size-4" aria-hidden="true"/></span><div><h3 className="font-semibold">Mi firma o timbre</h3><p className="mt-0.5 text-sm text-[#615f73]">Firma con el dedo sobre la línea o sube una foto/imagen. Se recorta sola y se imprime grande (≈ 6,5 × 2,7 cm) en todos tus documentos.</p></div></div>
    <div className={full ? "fixed inset-0 z-[70] flex flex-col gap-3 bg-[#f3f1f7] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]" : "mt-3"} data-testid="signature-pad-area" role={full ? "dialog" : undefined} aria-modal={full ? true : undefined} aria-label={full ? "Firma en pantalla completa" : undefined}>
      {full && <p className="text-center text-sm text-[#615f73]">Gira el teléfono para tener más espacio. Firma sobre la línea.</p>}
      <div className={full ? "relative min-h-0 w-full flex-1" : "relative left-1/2 h-[clamp(220px,60vw,260px)] w-[min(94vw,720px)] -translate-x-1/2 sm:left-0 sm:w-full sm:max-w-[720px] sm:translate-x-0 lg:h-[300px]"} data-testid="signature-pad">
        <canvas ref={canvasRef} aria-label="Cuadro para firmar con el dedo" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} className="absolute inset-0 block size-full touch-none select-none cursor-crosshair rounded-xl border-2 border-dashed border-[#bcb5cc] bg-white" style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}/>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 flex items-end gap-2 border-b-2 border-[#9a93ad] pb-1 text-[#9a93ad]" style={{ top: `calc(${BASELINE_RATIO * 100}% - 1.75rem)`, height: "1.75rem" }} data-testid="signature-baseline"><span className="text-xl font-semibold leading-none">✕</span><span className="text-sm font-medium uppercase tracking-wider">Firme aquí</span></div>
      </div>
      <div className={full ? "grid grid-cols-3 gap-2" : "mt-3 grid grid-cols-2 gap-2"}>
        <button type="button" onClick={clear} className={`${big} border-2 border-[#dddbe6] bg-white text-[#57566a] hover:bg-[#f7f6fa]`} data-testid="signature-clear"><Trash2 className="size-5" aria-hidden="true"/>Borrar</button>
        {full && <button type="button" onClick={() => setFull(false)} className={`${big} border-2 border-[#473a6d] bg-white text-[#473a6d] hover:bg-[#f3f1f7]`}><Check className="size-5" aria-hidden="true"/>Listo</button>}
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} className={`${big} bg-[#473a6d] text-white hover:bg-[#3a2f5a]`} data-testid="signature-save"><Save className="size-5" aria-hidden="true"/>{saving ? "Guardando…" : "Guardar"}</button>
      </div>
      {!full && <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setFull(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#473a6d] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]" data-testid="signature-fullscreen"><Maximize2 className="size-4" aria-hidden="true"/>Pantalla completa</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#dddbe6] px-3 text-sm font-semibold text-[#615f73] hover:bg-[#f7f6fa]"><ImagePlus className="size-4" aria-hidden="true"/>Subir imagen</button>
      </div>}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void pickFile(event.target.files?.[0]); event.target.value = ""; }}/>
    </div>
    {mark === null && <p className="mt-2 text-xs text-[#615f73]" role="status">Cargando tu firma…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}{notice && !error && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
