"use client";
/**
 * Firma o timbre del profesional, en su identificación (Configuración → Profesionales y «Mi identificación»).
 * Se dibuja con el dedo (iPhone) o se sube una imagen; se guarda recortada al trazo y se usa sola en todos sus
 * documentos: certificados, recetas, consentimientos y presupuestos.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Save, Trash2 } from "lucide-react";
import { inkBounds, outputScale, worthTrimming } from "@/lib/signature-image";

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

export function SignatureEditor({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const [mark, setMark] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/documentos/imagen", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { documentMark?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer tu firma.");
      let current = data.documentMark ?? "";
      // Migración: la firma antigua (cuadro de 200 px con mucho blanco) se guarda recortada al trazo, una sola vez.
      if (current) {
        const image = await loadImage(current);
        const c = document.createElement("canvas"); c.width = image.naturalWidth; c.height = image.naturalHeight;
        const x = c.getContext("2d");
        if (x) {
          x.drawImage(image, 0, 0);
          const bounds = inkBounds(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (bounds && worthTrimming(bounds, c.width, c.height)) {
            const trimmed = trimToDataUrl(image);
            if (trimmed) current = await saveMark(trimmed).catch(() => current);
          }
        }
      }
      if (alive) setMark(current);
    }).catch(reason => { if (alive) { setMark(""); setError(reason instanceof Error ? reason.message : "No se pudo leer tu firma."); } });
    return () => { alive = false; };
  }, []);

  // Dibuja la firma guardada en el cuadro (centrada, llenándolo).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mark === null) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!mark) return;
    void loadImage(mark).then(image => {
      const scale = Math.min((canvas.width - 40) / image.naturalWidth, (canvas.height - 40) / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      setHasImage(true); setDirty(false);
    }).catch(() => undefined);
  }, [mark]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, ctx = canvas.getContext("2d");
    if (!ctx) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId); drawing.current = true;
    const at = point(event); ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1f1c33"; ctx.lineWidth = 7; ctx.lineTo(at.x + .01, at.y + .01); ctx.stroke();
    setHasImage(true); setDirty(true); setError(""); setNotice("");
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d"); if (!ctx) return;
    const at = point(event); ctx.lineTo(at.x, at.y); ctx.stroke();
  };
  const stop = () => { drawing.current = false; };
  const pickFile = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) { setError("Elige una imagen PNG, JPG o WebP de hasta 8 MB."); return; }
    try {
      const url = URL.createObjectURL(file);
      const image = await loadImage(url).finally(() => URL.revokeObjectURL(url));
      const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("No se pudo abrir el cuadro de firma.");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min((canvas.width - 40) / image.naturalWidth, (canvas.height - 40) / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      setHasImage(true); setDirty(true); setError(""); setNotice("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo leer la imagen."); }
  };
  const clear = () => { const canvas = canvasRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setHasImage(false); setDirty(true); setError(""); setNotice(""); };
  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      let documentMark = hasImage ? trimToDataUrl(canvas) : "";
      if (hasImage && !documentMark) throw new Error("El cuadro está vacío: dibuja tu firma o sube una imagen.");
      if (documentMark.length > 400_000) {
        // Imagen subida con mucho detalle: se guarda como JPG sobre blanco.
        const image = await loadImage(documentMark);
        const flat = document.createElement("canvas"); flat.width = image.naturalWidth; flat.height = image.naturalHeight;
        const fctx = flat.getContext("2d"); if (!fctx) throw new Error("No se pudo preparar la imagen.");
        fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, flat.width, flat.height); fctx.drawImage(image, 0, 0);
        documentMark = flat.toDataURL("image/jpeg", 0.85);
        if (documentMark.length > 400_000) throw new Error("La imagen tiene demasiados detalles. Dibuja la firma o sube una imagen más simple.");
      }
      const saved = await saveMark(documentMark);
      setMark(saved); setDirty(false);
      setNotice(saved ? "Firma guardada. Se usa sola en tus certificados, recetas, consentimientos y presupuestos." : "Firma quitada de tus documentos.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la firma."); }
    finally { setSaving(false); }
  };

  return <section className={compact ? "space-y-2" : "rounded-xl border border-[#e6e4ee] bg-white p-4"} data-testid="signature-editor">
    <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eeebf3] text-[#473a6d]"><Pencil className="size-4" aria-hidden="true"/></span><div><h3 className="font-semibold">Mi firma o timbre</h3><p className="mt-0.5 text-sm text-[#615f73]">Fírmala con el dedo en el cuadro o sube una foto/imagen. Se recorta sola y se imprime grande (≈ 6,5 × 2,7 cm) en todos tus documentos.</p></div></div>
    <canvas ref={canvasRef} width={1200} height={440} aria-label="Cuadro para dibujar la firma o el timbre" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} className="mt-3 block h-44 w-full touch-none select-none cursor-crosshair rounded-lg border-2 border-dashed border-[#bcb5cc] bg-white sm:h-52" style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}/>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#473a6d] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><ImagePlus className="size-4" aria-hidden="true"/>Subir imagen</button>
      <button type="button" onClick={clear} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#dddbe6] px-3 text-sm font-semibold text-[#615f73] hover:bg-[#f7f6fa]"><Trash2 className="size-4" aria-hidden="true"/>Limpiar</button>
      <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="signature-save"><Save className="size-4" aria-hidden="true"/>{saving ? "Guardando…" : "Guardar firma"}</button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void pickFile(event.target.files?.[0]); event.target.value = ""; }}/>
    </div>
    {mark === null && <p className="mt-2 text-xs text-[#615f73]" role="status">Cargando tu firma…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}{notice && !error && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
