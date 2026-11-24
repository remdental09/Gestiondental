"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Save } from "lucide-react";
import { DEFAULT_STAMP_LAYOUT, SIGNATURE_CENTER_ABOVE_SLOT_CM, STAMP_LIMITS, isDefaultStampLayout, normalizeStampLayout, type StampLayout } from "@/lib/stamp-layout";
import { SIGNATURE_BOX_CM, STAMP_BOX_CM, SIGNATURE_MAX_WIDTH, validSignature } from "@/lib/signature-image";
import { knockoutBackground } from "@/lib/stamp-knockout";

/** Timbre sin fondo: se redibuja en un canvas dejando transparente todo lo que se parece al fondo de la foto. Devuelve null si no se pudo. */
async function cleanStamp(source: string): Promise<string | null> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new window.Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("imagen")); el.src = source; });
  let scale = Math.min(1, SIGNATURE_MAX_WIDTH / image.naturalWidth);
  for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const result = knockoutBackground(pixels.data, width, height);
    // Si casi no se quitó nada (la foto ya no tenía fondo) o se quitó todo, no sirve.
    if (result.removed < 0.02 || result.removed > 0.97) return null;
    const output = ctx.createImageData(width, height); output.data.set(result.data); ctx.putImageData(output, 0, 0);
    const url = canvas.toDataURL("image/png");
    if (validSignature(url)) return url;
  }
  return null;
}

/** Zona que se ve en la vista (cm, medidos desde el centro del lugar de siempre del timbre: x a la derecha, y hacia abajo desde su borde superior). */
const VIEW = { x0: -13, x1: 13, y0: -25, y1: 10 } as const;
const VIEW_W = VIEW.x1 - VIEW.x0, VIEW_H = VIEW.y1 - VIEW.y0;
const STEP = 0.5;

/**
 * El profesional arrastra su timbre sobre una hoja en miniatura (o usa las flechas), lo agranda o achica y lo guarda.
 * Vale para todos sus documentos: la posición se mide desde su firma, así que se ve igual en la receta, el certificado, el consentimiento y el presupuesto.
 */
export function StampPlacement({ image }: { image: string }) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; layout: StampLayout } | null>(null);
  const [layout, setLayout] = useState<StampLayout>(DEFAULT_STAMP_LAYOUT);
  // Timbre sin fondo para mostrar (cleanUrl) y si hay uno nuevo por subir al guardar (uploadClean).
  const [signature, setSignature] = useState("");
  const [cleanUrl, setCleanUrl] = useState<string | null>(null);
  const [uploadClean, setUploadClean] = useState(false);
  const [saved, setSaved] = useState<StampLayout>(DEFAULT_STAMP_LAYOUT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/documentos/imagen", { cache: "no-store" }).then(async response => {
      if (!response.ok || !alive) return;
      const data = await response.json() as { stampLayout?: StampLayout | null; documentMark?: string };
      if (alive) setSignature(data.documentMark ?? "");
      const loaded = normalizeStampLayout(data.stampLayout ?? DEFAULT_STAMP_LAYOUT);
      setLayout(loaded); setSaved(loaded);
      if (loaded.knockout) void cleanStamp(image).then(url => { if (alive) setCleanUrl(url); }).catch(() => undefined);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [image]);

  const toggleKnockout = async (on: boolean) => {
    setError(""); setNotice("");
    if (!on) { change({ knockout: false }); setUploadClean(false); return; }
    setBusy(true);
    try {
      const url = await cleanStamp(image);
      if (!url) { setError("No pude quitar el fondo de esta foto (casi no hay fondo que quitar, o la tinta se parece al fondo). Prueba con una foto con más contraste."); return; }
      setCleanUrl(url); setUploadClean(true); change({ knockout: true });
    } catch { setError("No pude leer la imagen del timbre."); }
    finally { setBusy(false); }
  };

  const chooseAnchor = async (onSignature: boolean) => {
    if (layout.onSignature === onSignature) return;
    change({ onSignature, dx: 0, dy: 0 });
    // Sobre la firma solo se ve bien si el timbre son letras sueltas: se prepara el fondo transparente de inmediato.
    if (onSignature && !layout.knockout) await toggleKnockout(true);
  };

  const change = useCallback((next: Partial<StampLayout>) => { setLayout(current => normalizeStampLayout({ ...current, ...next })); setNotice(""); setError(""); }, []);
  const dirty = JSON.stringify(layout) !== JSON.stringify(saved) || (layout.knockout && uploadClean);
  const shown = layout.knockout && cleanUrl ? cleanUrl : image;

  const pxPerCm = () => (areaRef.current?.clientWidth ?? 1) / VIEW_W;
  const start = (event: ReactPointerEvent) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, layout }; };
  const move = (event: ReactPointerEvent) => {
    const origin = drag.current; if (!origin) return;
    const ppc = pxPerCm();
    change({ dx: origin.layout.dx + (event.clientX - origin.x) / ppc, dy: origin.layout.dy + (event.clientY - origin.y) / ppc });
  };
  const stop = () => { drag.current = null; };

  const persist = async (value: StampLayout | null) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/documentos/imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stampLayout: value, ...(value?.knockout && uploadClean && cleanUrl ? { stampClean: cleanUrl } : {}) }) });
      const result = await response.json() as { stampLayout?: StampLayout; error?: string; locked?: boolean };
      if (response.status === 403 && result.locked) throw new Error((result.error || "Pide el código a tu correo.") + " Pulsa «Cambiar timbre» más arriba, confirma el código y vuelve a guardar aquí.");
      if (!response.ok || !result.stampLayout) throw new Error(result.error || "No se pudo guardar la posición del timbre.");
      const confirmed = normalizeStampLayout(result.stampLayout);
      setLayout(confirmed); setSaved(confirmed); setUploadClean(false); if (!confirmed.knockout) setCleanUrl(null);
      setNotice(value === null ? "Listo: el timbre volvió a su lugar de siempre." : "Listo: tus documentos usarán esta posición.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la posición del timbre."); }
    finally { setBusy(false); }
  };

  const width = STAMP_BOX_CM.width * layout.scale, height = STAMP_BOX_CM.height * layout.scale;
  const pct = (cm: number, total: number) => `${(cm / total) * 100}%`;
  const slotLeft = -STAMP_BOX_CM.width / 2 - VIEW.x0, slotTop = -VIEW.y0;
  // Centro de la firma en la miniatura (arriba del lugar de siempre del timbre) y esquina superior izquierda del timbre según dónde esté anclado.
  const signatureY = -SIGNATURE_CENTER_ABOVE_SLOT_CM;
  const stampLeft = layout.dx - width / 2, stampTop = layout.onSignature ? signatureY + layout.dy - height / 2 : layout.dy;
  const arrow = "inline-flex size-11 items-center justify-center rounded-xl border border-[#dddbe6] bg-white text-[#473a6d] hover:bg-[#f7f6fa] disabled:opacity-40";
  const limits = STAMP_LIMITS;

  return <div className="mt-4 rounded-xl border border-[#e6e4ee] bg-[#faf9fc] p-3" data-testid="stamp-placement">
    <h4 className="font-semibold">Dónde va tu timbre</h4>
    <p className="mt-0.5 text-sm text-[#615f73]">Arrástralo donde quieras (incluso sobre tu firma). Vale para todos tus documentos: se mide desde tu firma, así que queda igual en recetas, certificados, consentimientos y presupuestos.</p>
    <div ref={areaRef} className="relative mt-3 w-full max-w-[420px] touch-none select-none overflow-hidden rounded-lg border border-[#dddbe6] bg-white" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }} data-testid="stamp-placement-area" aria-label="Hoja en miniatura: arrastra el timbre para ubicarlo">
      {/* Hoja de referencia: texto del documento arriba y, sobre el lugar de siempre del timbre, la firma y los datos del profesional. */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(row => <span key={row} aria-hidden="true" className="absolute rounded-full bg-[#ecebf2]" style={{ left: "10%", width: row % 3 === 2 ? "45%" : "80%", top: pct(-24 + row * 1.6 - VIEW.y0, VIEW_H), height: "0.9%" }}/>)}
      {signature && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={signature} alt="Tu firma" draggable={false} className="pointer-events-none absolute object-contain" data-testid="stamp-placement-signature" style={{ left: pct(-SIGNATURE_BOX_CM.width / 2 - VIEW.x0, VIEW_W), top: pct(signatureY - SIGNATURE_BOX_CM.height / 2 - VIEW.y0, VIEW_H), width: pct(SIGNATURE_BOX_CM.width, VIEW_W), height: pct(SIGNATURE_BOX_CM.height, VIEW_H) }}/></>}
      <span aria-hidden="true" className="absolute border-t border-[#9a93ad]" style={{ left: pct(-5 - VIEW.x0, VIEW_W), width: pct(10, VIEW_W), top: pct(-1.6 - VIEW.y0, VIEW_H) }}/>
      {[[-1.25, 7], [-0.8, 5], [-0.35, 6]].map(([top, wide]) => <span key={top} aria-hidden="true" className="absolute rounded-full bg-[#d9d6e4]" style={{ left: pct(-(wide ?? 5) / 2 - VIEW.x0, VIEW_W), width: pct(wide ?? 5, VIEW_W), top: pct((top ?? 0) - VIEW.y0, VIEW_H), height: "0.9%" }}/>)}
      <span aria-hidden="true" className="absolute rounded border border-dashed border-[#b8b1d6]" style={{ left: pct(slotLeft, VIEW_W), top: pct(slotTop, VIEW_H), width: pct(STAMP_BOX_CM.width, VIEW_W), height: pct(STAMP_BOX_CM.height, VIEW_H) }}/>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown} alt="Tu timbre" draggable={false} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} data-testid="stamp-draggable" className="absolute cursor-grab touch-none object-contain active:cursor-grabbing" style={{ left: pct(stampLeft - VIEW.x0, VIEW_W), top: pct(stampTop - VIEW.y0, VIEW_H), width: pct(width, VIEW_W), height: pct(height, VIEW_H), opacity: layout.opacity }}/>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Dónde se ancla el timbre">
      {([[false, "Bajo mi firma"], [true, "Sobre mi firma"]] as const).map(([onSignature, label]) => <button key={label} type="button" disabled={busy} aria-pressed={layout.onSignature === onSignature} onClick={() => void chooseAnchor(onSignature)} className={`inline-flex min-h-11 items-center justify-center rounded-xl border-2 px-3 text-sm font-semibold ${layout.onSignature === onSignature ? "border-[#473a6d] bg-[#efeef4] text-[#473a6d]" : "border-[#dddbe6] bg-white text-[#57566a] hover:bg-[#f7f6fa]"}`} data-testid={onSignature ? "stamp-on-signature-button" : "stamp-under-signature-button"}>{label}</button>)}
    </div>
    {layout.onSignature && !layout.knockout && <p className="mt-2 text-xs text-[#8a4b00]">Para que tu firma se vea a través del timbre activa «Quitar el fondo de la foto»; si no, el timbre la tapa.</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Mover el timbre con flechas">
        <span/><button type="button" className={arrow} aria-label="Subir" onClick={() => change({ dy: layout.dy - STEP })} disabled={layout.dy <= limits.dy[0]}><ArrowUp className="size-4" aria-hidden="true"/></button><span/>
        <button type="button" className={arrow} aria-label="Izquierda" onClick={() => change({ dx: layout.dx - STEP })} disabled={layout.dx <= limits.dx[0]}><ArrowLeft className="size-4" aria-hidden="true"/></button>
        <button type="button" className={arrow} aria-label="Bajar" onClick={() => change({ dy: layout.dy + STEP })} disabled={layout.dy >= limits.dy[1]}><ArrowDown className="size-4" aria-hidden="true"/></button>
        <button type="button" className={arrow} aria-label="Derecha" onClick={() => change({ dx: layout.dx + STEP })} disabled={layout.dx >= limits.dx[1]}><ArrowRight className="size-4" aria-hidden="true"/></button>
      </div>
      <label className="min-w-[180px] flex-1 text-sm font-medium text-[#615f73]">Tamaño: {Math.round(layout.scale * 100)} %
        <input type="range" min={limits.scale[0]} max={limits.scale[1]} step={0.05} value={layout.scale} onChange={event => change({ scale: Number(event.target.value) })} className="mt-1 block w-full accent-[#473a6d]" data-testid="stamp-scale"/>
      </label>
    </div>
    <label className="mt-3 block text-sm font-medium text-[#615f73]">Intensidad de la tinta: {Math.round(layout.opacity * 100)} %
      <input type="range" min={limits.opacity[0]} max={limits.opacity[1]} step={0.05} value={layout.opacity} onChange={event => change({ opacity: Number(event.target.value) })} className="mt-1 block w-full accent-[#473a6d]" data-testid="stamp-opacity"/>
    </label>
    <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dddbe6] bg-white px-3 text-sm font-medium text-[#35343f]">
      <input type="checkbox" checked={layout.knockout} disabled={busy} onChange={event => void toggleKnockout(event.target.checked)} className="size-5 accent-[#473a6d]" data-testid="stamp-knockout"/>
      <span>Quitar el fondo de la foto <span className="block text-xs font-normal text-[#615f73]">Deja solo la tinta, sin el recuadro gris o blanco. Para guardarlo se pide el código al correo, igual que para cambiar el timbre.</span></span>
    </label>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" disabled={busy || isDefaultStampLayout(layout) && isDefaultStampLayout(saved)} onClick={() => void persist(null)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-[#dddbe6] bg-white px-3 text-base font-semibold text-[#57566a] hover:bg-[#f7f6fa] disabled:opacity-50" data-testid="stamp-reset"><RotateCcw className="size-5" aria-hidden="true"/>Lugar de siempre</button>
      <button type="button" disabled={busy || !dirty} onClick={() => void persist(layout)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-3 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="stamp-layout-save"><Save className="size-5" aria-hidden="true"/>{busy ? "Guardando…" : "Guardar posición"}</button>
    </div>
    <p className="mt-2 text-xs text-[#615f73]">Vista aproximada: el recuadro punteado es el lugar de siempre (bajo tu firma y tus datos). Si lo mueves, ya no reserva espacio ahí.</p>
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}{notice && !error && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
  </div>;
}
