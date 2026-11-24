"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Save } from "lucide-react";
import { DEFAULT_STAMP_LAYOUT, SIGNATURE_CENTER_ABOVE_SLOT_CM, STAMP_LIMITS, fittedRectCm, isDefaultStampLayout, normalizeStampLayout, unionBox, type MergedBox, type StampLayout } from "@/lib/stamp-layout";
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
type Target = "timbre" | "firma";

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const el = new window.Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("imagen")); el.src = src; });

/**
 * Une la firma y el timbre en una sola imagen (PNG con transparencia), con las posiciones y tamaños que el profesional dejó.
 * Devuelve la imagen y dónde cae (cm, respecto del centro de la firma de siempre) para que cada documento la dibuje como una pieza.
 */
async function buildMerged(signatureSrc: string, stampSrc: string, layout: StampLayout): Promise<{ url: string; box: MergedBox } | null> {
  const [signature, stamp] = await Promise.all([loadImage(signatureSrc), loadImage(stampSrc)]);
  const sigRect = fittedRectCm(signature.naturalWidth / signature.naturalHeight, SIGNATURE_BOX_CM.width * layout.sigScale, SIGNATURE_BOX_CM.height * layout.sigScale, layout.sigDx, layout.sigDy);
  const stampRect = fittedRectCm(stamp.naturalWidth / stamp.naturalHeight, STAMP_BOX_CM.width * layout.scale, STAMP_BOX_CM.height * layout.scale, layout.sigDx + layout.dx, layout.sigDy + layout.dy);
  const box = unionBox(sigRect, stampRect);
  if (box.w > 40 || box.h > 40) return null;
  let ppc = Math.min(150, SIGNATURE_MAX_WIDTH / box.w, SIGNATURE_MAX_WIDTH / box.h);
  for (let attempt = 0; attempt < 4; attempt++, ppc *= 0.75) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * ppc)); canvas.height = Math.max(1, Math.round(box.h * ppc));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    const draw = (image: HTMLImageElement, rect: MergedBox, alpha = 1) => { ctx.globalAlpha = alpha; ctx.drawImage(image, (rect.x - box.x) * ppc, (rect.y - box.y) * ppc, rect.w * ppc, rect.h * ppc); };
    draw(signature, sigRect); draw(stamp, stampRect, layout.opacity);
    const url = canvas.toDataURL("image/png");
    if (validSignature(url)) return { url, box };
  }
  return null;
}

/**
 * El profesional arrastra su firma y su timbre sobre una hoja en miniatura (o usa las flechas), los agranda o achica y, si quiere, los une
 * en una sola imagen. Vale para todos sus documentos: las posiciones se miden desde la firma de siempre, así que se ven igual en la receta,
 * el certificado, el consentimiento y el presupuesto.
 */
export function StampPlacement({ image }: { image: string }) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; layout: StampLayout; target: Target } | null>(null);
  const [layout, setLayout] = useState<StampLayout>(DEFAULT_STAMP_LAYOUT);
  const [saved, setSaved] = useState<StampLayout>(DEFAULT_STAMP_LAYOUT);
  const [target, setTarget] = useState<Target>("timbre");
  const [signature, setSignature] = useState("");
  // Timbre sin fondo para mostrar (cleanUrl) y si hay uno nuevo por subir al guardar (uploadClean).
  const [cleanUrl, setCleanUrl] = useState<string | null>(null);
  const [uploadClean, setUploadClean] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const change = useCallback((next: Partial<StampLayout>) => { setLayout(current => normalizeStampLayout({ ...current, ...next })); setNotice(""); setError(""); }, []);

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

  const toggleKnockout = async (on: boolean): Promise<boolean> => {
    setError(""); setNotice("");
    if (!on) { change({ knockout: false }); setUploadClean(false); return true; }
    setBusy(true);
    try {
      const url = await cleanStamp(image);
      if (!url) { setError("No pude quitar el fondo de esta foto (casi no hay fondo que quitar, o la tinta se parece al fondo). Prueba con una foto con más contraste."); return false; }
      setCleanUrl(url); setUploadClean(true); change({ knockout: true });
      return true;
    } catch { setError("No pude leer la imagen del timbre."); return false; }
    finally { setBusy(false); }
  };

  const chooseAnchor = async (onSignature: boolean) => {
    if (layout.onSignature === onSignature) return;
    change({ onSignature, dx: 0, dy: 0, ...(onSignature ? {} : { merged: false, mergedBox: null }) });
    // Sobre la firma solo se ve bien si el timbre son letras sueltas: se prepara el fondo transparente de inmediato.
    if (onSignature && !layout.knockout) await toggleKnockout(true);
  };

  const toggleMerged = async (on: boolean) => {
    setError(""); setNotice("");
    if (!on) { change({ merged: false, mergedBox: null }); return; }
    if (!signature) { setError("Primero guarda tu firma (más arriba) para poder unirla con el timbre."); return; }
    // Unidos, el timbre queda sobre la firma y con fondo transparente: es lo que hace que la firma se vea debajo de las letras.
    if (!layout.onSignature) change({ onSignature: true, dx: 0, dy: 0 });
    if (!layout.knockout && !await toggleKnockout(true)) return;
    // La caja se calcula al guardar (con las posiciones finales); aquí solo se marca la intención con una caja provisoria.
    change({ merged: true, mergedBox: { x: -3.25, y: -1.35, w: 6.5, h: 2.7 } });
  };

  const dirty = JSON.stringify(layout) !== JSON.stringify(saved) || (layout.knockout && uploadClean);
  const shown = layout.knockout && cleanUrl ? cleanUrl : image;

  const pxPerCm = () => (areaRef.current?.clientWidth ?? 1) / VIEW_W;
  const start = (which: Target) => (event: ReactPointerEvent) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, layout, target: which }; };
  const move = (event: ReactPointerEvent) => {
    const origin = drag.current; if (!origin) return;
    const ppc = pxPerCm(), moveX = (event.clientX - origin.x) / ppc, moveY = (event.clientY - origin.y) / ppc;
    if (origin.target === "firma") change({ sigDx: origin.layout.sigDx + moveX, sigDy: origin.layout.sigDy + moveY });
    else change({ dx: origin.layout.dx + moveX, dy: origin.layout.dy + moveY });
  };
  const stop = () => { drag.current = null; };
  const nudge = (axis: "x" | "y", amount: number) => {
    if (target === "firma") change(axis === "x" ? { sigDx: layout.sigDx + amount } : { sigDy: layout.sigDy + amount });
    else change(axis === "x" ? { dx: layout.dx + amount } : { dy: layout.dy + amount });
  };

  const persist = async (value: StampLayout | null) => {
    setBusy(true); setError(""); setNotice("");
    try {
      let toSave = value, mergedMark: string | undefined;
      if (value?.merged) {
        // La pieza unida se arma ahora, con las posiciones finales: lo que ves en la miniatura es lo que se imprime.
        const built = await buildMerged(signature, shown, value);
        if (!built) throw new Error("No pude unir la firma con el timbre (la imagen salió muy grande). Achica alguno e intenta de nuevo.");
        toSave = { ...value, mergedBox: built.box }; mergedMark = built.url;
      }
      const response = await fetch("/api/documentos/imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stampLayout: toSave, ...(toSave?.knockout && uploadClean && cleanUrl ? { stampClean: cleanUrl } : {}), ...(mergedMark ? { mergedMark } : {}) }) });
      const result = await response.json() as { stampLayout?: StampLayout; error?: string; locked?: boolean };
      if (response.status === 403 && result.locked) throw new Error((result.error || "Pide el código a tu correo.") + " Pulsa «Cambiar timbre» más arriba, confirma el código y vuelve a guardar aquí.");
      if (!response.ok || !result.stampLayout) throw new Error(result.error || "No se pudo guardar la posición.");
      const confirmed = normalizeStampLayout(result.stampLayout);
      setLayout(confirmed); setSaved(confirmed); setUploadClean(false); if (!confirmed.knockout) setCleanUrl(null);
      setNotice(value === null ? "Listo: firma y timbre volvieron a su lugar de siempre." : confirmed.merged ? "Listo: tus documentos llevarán la firma y el timbre unidos en una sola imagen." : "Listo: tus documentos usarán estas posiciones.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la posición."); }
    finally { setBusy(false); }
  };

  const stampW = STAMP_BOX_CM.width * layout.scale, stampH = STAMP_BOX_CM.height * layout.scale;
  const sigW = SIGNATURE_BOX_CM.width * layout.sigScale, sigH = SIGNATURE_BOX_CM.height * layout.sigScale;
  const pct = (cm: number, total: number) => `${(cm / total) * 100}%`;
  const slotLeft = -STAMP_BOX_CM.width / 2 - VIEW.x0, slotTop = -VIEW.y0;
  // Centro de la firma de siempre en la miniatura (arriba del lugar de siempre del timbre); firma y timbre se miden desde ahí.
  const signatureY = -SIGNATURE_CENTER_ABOVE_SLOT_CM;
  const sigCenterX = layout.sigDx, sigCenterY = signatureY + layout.sigDy;
  const stampLeft = layout.onSignature ? sigCenterX + layout.dx - stampW / 2 : layout.dx - stampW / 2;
  const stampTop = layout.onSignature ? sigCenterY + layout.dy - stampH / 2 : layout.dy;
  const arrow = "inline-flex size-11 items-center justify-center rounded-xl border border-[#dddbe6] bg-white text-[#473a6d] hover:bg-[#f7f6fa] disabled:opacity-40";
  const limits = STAMP_LIMITS;
  const scaleKey = target === "firma" ? "sigScale" : "scale";
  const moving = target === "firma" ? { x: layout.sigDx, y: layout.sigDy, xLim: limits.sigDx, yLim: limits.sigDy } : { x: layout.dx, y: layout.dy, xLim: limits.dx, yLim: limits.dy };

  return <div className="mt-4 rounded-xl border border-[#e6e4ee] bg-[#faf9fc] p-3" data-testid="stamp-placement">
    <h4 className="font-semibold">Dónde van tu firma y tu timbre</h4>
    <p className="mt-0.5 text-sm text-[#615f73]">Elige cuál mover y arrástralo donde quieras (incluso uno sobre el otro). Vale para todos tus documentos: se mide desde el lugar de siempre de tu firma, así que queda igual en recetas, certificados, consentimientos y presupuestos.</p>
    <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Qué se mueve">
      {([["timbre", "Mover el timbre"], ["firma", "Mover la firma"]] as const).map(([which, label]) => <button key={which} type="button" aria-pressed={target === which} disabled={which === "firma" && !signature} onClick={() => setTarget(which)} className={`inline-flex min-h-11 items-center justify-center rounded-xl border-2 px-3 text-sm font-semibold disabled:opacity-50 ${target === which ? "border-[#473a6d] bg-[#efeef4] text-[#473a6d]" : "border-[#dddbe6] bg-white text-[#57566a] hover:bg-[#f7f6fa]"}`} data-testid={`stamp-target-${which}`}>{label}</button>)}
    </div>
    <div ref={areaRef} className="relative mt-3 w-full max-w-[420px] touch-none select-none overflow-hidden rounded-lg border border-[#dddbe6] bg-white" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }} data-testid="stamp-placement-area" aria-label="Hoja en miniatura: arrastra la firma o el timbre para ubicarlos">
      {/* Hoja de referencia: texto del documento arriba y, bajo la firma, la línea con los datos del profesional. */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(row => <span key={row} aria-hidden="true" className="absolute rounded-full bg-[#ecebf2]" style={{ left: "10%", width: row % 3 === 2 ? "45%" : "80%", top: pct(-24 + row * 1.6 - VIEW.y0, VIEW_H), height: "0.9%" }}/>)}
      <span aria-hidden="true" className="absolute border-t border-[#9a93ad]" style={{ left: pct(-5 - VIEW.x0, VIEW_W), width: pct(10, VIEW_W), top: pct(-1.6 - VIEW.y0, VIEW_H) }}/>
      {[[-1.25, 7], [-0.8, 5], [-0.35, 6]].map(([top, wide]) => <span key={top} aria-hidden="true" className="absolute rounded-full bg-[#d9d6e4]" style={{ left: pct(-(wide ?? 5) / 2 - VIEW.x0, VIEW_W), width: pct(wide ?? 5, VIEW_W), top: pct((top ?? 0) - VIEW.y0, VIEW_H), height: "0.9%" }}/>)}
      <span aria-hidden="true" className="absolute rounded border border-dashed border-[#b8b1d6]" style={{ left: pct(slotLeft, VIEW_W), top: pct(slotTop, VIEW_H), width: pct(STAMP_BOX_CM.width, VIEW_W), height: pct(STAMP_BOX_CM.height, VIEW_H) }}/>
      {signature && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={signature} alt="Tu firma" draggable={false} onPointerDown={target === "firma" ? start("firma") : undefined} onPointerMove={target === "firma" ? move : undefined} onPointerUp={stop} onPointerCancel={stop} data-testid="stamp-placement-signature" className={`absolute object-contain ${target === "firma" ? "z-20 cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"}`} style={{ left: pct(sigCenterX - sigW / 2 - VIEW.x0, VIEW_W), top: pct(sigCenterY - sigH / 2 - VIEW.y0, VIEW_H), width: pct(sigW, VIEW_W), height: pct(sigH, VIEW_H) }}/></>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown} alt="Tu timbre" draggable={false} onPointerDown={target === "timbre" ? start("timbre") : undefined} onPointerMove={target === "timbre" ? move : undefined} onPointerUp={stop} onPointerCancel={stop} data-testid="stamp-draggable" className={`absolute object-contain ${target === "timbre" ? "z-20 cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none z-10"}`} style={{ left: pct(stampLeft - VIEW.x0, VIEW_W), top: pct(stampTop - VIEW.y0, VIEW_H), width: pct(stampW, VIEW_W), height: pct(stampH, VIEW_H), opacity: layout.opacity }}/>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Dónde se ancla el timbre">
      {([[false, "Timbre bajo mi firma"], [true, "Timbre sobre mi firma"]] as const).map(([onSignature, label]) => <button key={label} type="button" disabled={busy} aria-pressed={layout.onSignature === onSignature} onClick={() => void chooseAnchor(onSignature)} className={`inline-flex min-h-11 items-center justify-center rounded-xl border-2 px-2 text-sm font-semibold ${layout.onSignature === onSignature ? "border-[#473a6d] bg-[#efeef4] text-[#473a6d]" : "border-[#dddbe6] bg-white text-[#57566a] hover:bg-[#f7f6fa]"}`} data-testid={onSignature ? "stamp-on-signature-button" : "stamp-under-signature-button"}>{label}</button>)}
    </div>
    {layout.onSignature && !layout.knockout && <p className="mt-2 text-xs text-[#8a4b00]">Para que tu firma se vea a través del timbre activa «Quitar el fondo de la foto»; si no, el timbre la tapa.</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={`Mover ${target === "firma" ? "la firma" : "el timbre"} con flechas`}>
        <span/><button type="button" className={arrow} aria-label="Subir" onClick={() => nudge("y", -STEP)} disabled={moving.y <= moving.yLim[0]}><ArrowUp className="size-4" aria-hidden="true"/></button><span/>
        <button type="button" className={arrow} aria-label="Izquierda" onClick={() => nudge("x", -STEP)} disabled={moving.x <= moving.xLim[0]}><ArrowLeft className="size-4" aria-hidden="true"/></button>
        <button type="button" className={arrow} aria-label="Bajar" onClick={() => nudge("y", STEP)} disabled={moving.y >= moving.yLim[1]}><ArrowDown className="size-4" aria-hidden="true"/></button>
        <button type="button" className={arrow} aria-label="Derecha" onClick={() => nudge("x", STEP)} disabled={moving.x >= moving.xLim[1]}><ArrowRight className="size-4" aria-hidden="true"/></button>
      </div>
      <label className="min-w-[180px] flex-1 text-sm font-medium text-[#615f73]">Tamaño {target === "firma" ? "de la firma" : "del timbre"}: {Math.round(layout[scaleKey] * 100)} %
        <input type="range" min={limits[scaleKey][0]} max={limits[scaleKey][1]} step={0.05} value={layout[scaleKey]} onChange={event => change({ [scaleKey]: Number(event.target.value) })} className="mt-1 block w-full accent-[#473a6d]" data-testid="stamp-scale"/>
      </label>
    </div>
    <label className="mt-3 block text-sm font-medium text-[#615f73]">Intensidad de la tinta del timbre: {Math.round(layout.opacity * 100)} %
      <input type="range" min={limits.opacity[0]} max={limits.opacity[1]} step={0.05} value={layout.opacity} onChange={event => change({ opacity: Number(event.target.value) })} className="mt-1 block w-full accent-[#473a6d]" data-testid="stamp-opacity"/>
    </label>
    <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dddbe6] bg-white px-3 text-sm font-medium text-[#35343f]">
      <input type="checkbox" checked={layout.knockout} disabled={busy} onChange={event => void toggleKnockout(event.target.checked)} className="size-5 accent-[#473a6d]" data-testid="stamp-knockout"/>
      <span>Quitar el fondo de la foto <span className="block text-xs font-normal text-[#615f73]">Deja solo la tinta, sin el recuadro gris o blanco. Para guardarlo se pide el código al correo, igual que para cambiar el timbre.</span></span>
    </label>
    <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dddbe6] bg-white px-3 text-sm font-medium text-[#35343f]">
      <input type="checkbox" checked={layout.merged} disabled={busy || !signature} onChange={event => void toggleMerged(event.target.checked)} className="size-5 accent-[#473a6d]" data-testid="stamp-merge"/>
      <span>Unir firma y timbre en una sola imagen <span className="block text-xs font-normal text-[#615f73]">Al guardar se juntan tal como los dejaste y se imprimen como una sola pieza. Si prefieres verlos por separado, déjalo apagado. También pide el código al correo.</span></span>
    </label>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" disabled={busy || isDefaultStampLayout(layout) && isDefaultStampLayout(saved)} onClick={() => void persist(null)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-[#dddbe6] bg-white px-3 text-base font-semibold text-[#57566a] hover:bg-[#f7f6fa] disabled:opacity-50" data-testid="stamp-reset"><RotateCcw className="size-5" aria-hidden="true"/>Lugar de siempre</button>
      <button type="button" disabled={busy || !dirty} onClick={() => void persist(layout)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-3 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="stamp-layout-save"><Save className="size-5" aria-hidden="true"/>{busy ? "Guardando…" : "Guardar posiciones"}</button>
    </div>
    <p className="mt-2 text-xs text-[#615f73]">Vista aproximada: el recuadro punteado es el lugar de siempre del timbre (bajo tu firma y tus datos). Si lo mueves, ya no reserva espacio ahí.</p>
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}{notice && !error && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
  </div>;
}
