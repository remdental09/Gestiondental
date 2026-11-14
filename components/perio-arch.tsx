"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatFdi, type PerioTooth } from "@/app/clinical-data";
import { PERIO_ARCH_IMAGES } from "@/app/perio-arch-assets";
import { archCurves, archSlots, CROWN_MD_MM, depthTone, PX_PER_MM, sampleCurve, siteXs, toothLevels, toothType, type ArchFace, type Jaw, type ToothLevels, type ToothSlot } from "@/app/perio-arch-layout";

const OCC = 34;      // px entre el borde del lienzo y el borde incisal/oclusal
const ROOT_PAD = 52; // px bajo la raíz más larga
const GUM_SCALE = 0.238, GUM_W = 1120, GUM_H = 350, GUM_BAND = 84;
const IMAGE_FILES = ["gum", "bone", "implante", ...["upper", "lower"].flatMap(jaw => ["incisivo-central", "incisivo-lateral", "canino", "premolar-1", "premolar-2", "molar-1", "molar-2", "molar-3"].map(t => `${jaw}-${t}`))];

type Images = Record<string, HTMLImageElement>;
const TONE_STYLE = {
  none: "border-slate-400/70 text-slate-300",
  ok: "border-emerald-400 text-white",
  warn: "border-amber-400 text-white",
  crit: "border-rose-400 text-white",
} as const;

function useArchImages(): Images | null {
  const [images, setImages] = useState<Images | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loaded: Images = {};
    let left = IMAGE_FILES.length;
    IMAGE_FILES.forEach(name => {
      const img = new Image();
      const done = () => { loaded[name] = img; if (--left === 0 && !cancelled) setImages(loaded); };
      img.onload = done; img.onerror = done;
      img.src = `/perio/${name}.webp`;
    });
    return () => { cancelled = true; };
  }, []);
  return images;
}

/** Geometría fija de una arcada: no depende de las mediciones. */
function jawGeometry(jaw: Jaw, face: ArchFace) {
  const { slots, width } = archSlots(jaw, face);
  const parts = slots.map(slot => {
    const key = `${jaw}-${toothType(slot.tooth)}`;
    const meta = PERIO_ARCH_IMAGES[key];
    const scale = (CROWN_MD_MM[jaw][(slot.tooth % 10) - 1] * PX_PER_MM) / meta.crownW;
    return { key, scale, dw: meta.w * scale, dh: meta.h * scale, cej: OCC + meta.cej * scale };
  });
  const H = Math.ceil(OCC + Math.max(...parts.map(p => p.dh)) + ROOT_PAD);
  return { slots, width, parts, H };
}
type Geometry = ReturnType<typeof jawGeometry>;
type View = { levels: ToothLevels[]; gumY: Float32Array; boneY: Float32Array; curves: ReturnType<typeof archCurves> };

function buildView(geo: Geometry, levels: ToothLevels[]): View {
  const curves = archCurves(geo.slots, levels, geo.parts.map(p => p.cej), geo.width);
  return { levels, curves, gumY: sampleCurve(curves.gum, 0, geo.width), boneY: sampleCurve(curves.bone, 0, geo.width) };
}

function drawJaw(canvas: HTMLCanvasElement, jaw: Jaw, face: ArchFace, geo: Geometry, view: View, images: Images, gumOpacity: number) {
  const { slots, width, parts, H } = geo, flip = jaw === "upper";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const setT = (c: CanvasRenderingContext2D) => (flip ? c.setTransform(dpr, 0, 0, -dpr, 0, H * dpr) : c.setTransform(dpr, 0, 0, dpr, 0, 0));
  const trace = (c: CanvasRenderingContext2D, ys: Float32Array, off: number) => { c.beginPath(); for (let x = 0; x < ys.length; x += 2) { if (x === 0) c.moveTo(x, ys[x] + off); else c.lineTo(x, ys[x] + off); } };
  const roundedX = (x: number) => Math.max(0, Math.min(view.gumY.length - 1, Math.round(x)));

  // Hueso detrás de las raíces
  setT(ctx);
  trace(ctx, view.boneY, 0); ctx.lineTo(width, H + 4); ctx.lineTo(0, H + 4); ctx.closePath();
  if (images.bone?.naturalWidth) { const pat = ctx.createPattern(images.bone, "repeat"); if (pat) { try { pat.setTransform(new DOMMatrix().scale(0.34)); } catch { /* sin transformación de patrón */ } ctx.fillStyle = "#7d6a58"; ctx.fill(); ctx.globalAlpha = 0.78; ctx.fillStyle = pat; ctx.fill(); ctx.globalAlpha = 1; } }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(40,22,26,.18)"); shade.addColorStop(1, "rgba(13,10,22,.62)");
  ctx.fillStyle = shade; ctx.fill();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  trace(ctx, view.boneY, 1); ctx.strokeStyle = "rgba(255,248,230,.85)"; ctx.lineWidth = 2.2; ctx.stroke();

  // Dientes e implantes
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = (flip ? -3 : 3) * dpr;
  slots.forEach((slot, i) => {
    const lv = view.levels[i];
    if (lv.excluded === "absent") return;
    const quadrant = Math.floor(slot.tooth / 10), mirror = (quadrant === 2 || quadrant === 3) !== (face === "lingual");
    let key = parts[i].key, dw = parts[i].dw, dh = parts[i].dh, top = OCC;
    if (lv.excluded === "implant") {
      const meta = PERIO_ARCH_IMAGES.implante, s = (5.5 * PX_PER_MM) / meta.w;
      key = "implante"; dw = meta.w * s; dh = meta.h * s; top = parts[i].cej - meta.cej * s;
    }
    const img = images[key];
    if (!img?.naturalWidth) return;
    ctx.save();
    ctx.translate(slot.cx, 0);
    if (mirror && key !== "implante") ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, top, dw, dh);
    ctx.restore();
  });
  ctx.restore();

  // Sombra del margen gingival sobre el diente
  [[14, 0.1], [8, 0.14], [4, 0.2]].forEach(([w, a]) => { trace(ctx, view.gumY, -3); ctx.strokeStyle = `rgba(50,8,18,${a})`; ctx.lineWidth = w; ctx.stroke(); });

  // Encía: cada columna de la foto sigue el margen medido
  const gc = document.createElement("canvas"); gc.width = canvas.width; gc.height = canvas.height;
  const g = gc.getContext("2d");
  if (g && images.gum?.naturalWidth) {
    setT(g);
    const step = 2;
    for (let x = 0; x < width; x += step) {
      const y = view.gumY[roundedX(x)] - 2, u = (x / GUM_SCALE) % (GUM_W - 12);
      g.drawImage(images.gum, u, 0, (step + 0.4) / GUM_SCALE, GUM_BAND, x, y, step + 0.4, GUM_BAND * GUM_SCALE);
      g.drawImage(images.gum, u, GUM_BAND, (step + 0.4) / GUM_SCALE, GUM_H - GUM_BAND, x, y + GUM_BAND * GUM_SCALE - 0.3, step + 0.4, Math.max(H - y, 120));
    }
    g.globalCompositeOperation = "source-atop";
    slots.forEach((slot, i) => {
      const xs = siteXs(slot);
      view.levels[i].sites.forEach((site, k) => {
        if (!site.bleeding || view.levels[i].excluded) return;
        const y = view.gumY[roundedX(xs[k])] + 8, grd = g.createRadialGradient(xs[k], y, 2, xs[k], y, 24);
        grd.addColorStop(0, "rgba(205,14,44,.34)"); grd.addColorStop(1, "rgba(205,14,44,0)");
        g.fillStyle = grd; g.fillRect(xs[k] - 26, y - 26, 52, 52);
      });
    });
    g.globalCompositeOperation = "destination-out";
    for (let k = 0; k < 14; k++) {
      g.beginPath(); g.moveTo(0, view.boneY[0] + k * 3.4);
      for (let x = 2; x < width; x += 2) g.lineTo(x, view.boneY[roundedX(x)] + k * 3.4);
      g.lineTo(width, H + 40); g.lineTo(0, H + 40); g.closePath();
      g.fillStyle = k === 13 ? "#000" : "rgba(0,0,0,.13)"; g.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = gumOpacity; ctx.drawImage(gc, 0, 0); ctx.globalAlpha = 1;
  }

  // Reborde brillante del margen y sondas
  setT(ctx);
  trace(ctx, view.gumY, 1.5); ctx.strokeStyle = "rgba(255,225,230,.4)"; ctx.lineWidth = 1.2; ctx.stroke();
  slots.forEach((slot, i) => {
    const lv = view.levels[i];
    if (lv.excluded) return;
    const xs = siteXs(slot);
    lv.sites.forEach((site, k) => {
      if (site.depth === null) return;
      const y0 = view.gumY[roundedX(xs[k])], y1 = y0 + site.depth * PX_PER_MM;
      const color = { ok: "#4fc79a", warn: "#e8b04a", crit: "#f0647a", none: "#94a3b8" }[depthTone(site.depth)];
      ctx.beginPath(); ctx.moveTo(xs[k], y0); ctx.lineTo(xs[k], y1); ctx.strokeStyle = "rgba(13,10,22,.55)"; ctx.lineWidth = 4.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xs[k], y0); ctx.lineTo(xs[k], y1); ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
      for (let m = 1; m < site.depth; m++) { ctx.beginPath(); ctx.moveTo(xs[k] - 2.4, y0 + m * PX_PER_MM); ctx.lineTo(xs[k] + 2.4, y0 + m * PX_PER_MM); ctx.strokeStyle = "rgba(13,10,22,.7)"; ctx.lineWidth = 0.9; ctx.stroke(); }
      if (site.suppuration) { ctx.beginPath(); ctx.arc(xs[k] + 5, y1 - 2, 2.6, 0, 6.2832); ctx.fillStyle = "#f5d142"; ctx.fill(); }
    });
  });

  // Los bordes se funden con el fondo
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  const fade = (x0: number, y0: number, x1: number, y1: number, rect: [number, number, number, number]) => {
    const f = ctx.createLinearGradient(x0, y0, x1, y1);
    f.addColorStop(0, "rgba(0,0,0,1)"); f.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = f; ctx.fillRect(...rect);
  };
  const W = canvas.width, Hd = canvas.height, ew = 34 * dpr, eh = 46 * dpr;
  fade(0, 0, ew, 0, [0, 0, ew, Hd]); fade(W, 0, W - ew, 0, [W - ew, 0, ew, Hd]);
  if (flip) fade(0, 0, 0, eh, [0, 0, W, eh]); else fade(0, Hd, 0, Hd - eh, [0, Hd - eh, W, eh]);
  ctx.globalCompositeOperation = "source-over";
}

function ArchRow({ jaw, face, geo, view, images, gumOpacity, selected, teeth, onOpen }: { jaw: Jaw; face: ArchFace; geo: Geometry; view: View; images: Images | null; gumOpacity: number; selected: number; teeth: Record<number, PerioTooth | undefined>; onOpen: (tooth: number, element: HTMLElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { slots, width, H } = geo, flip = jaw === "upper";
  useEffect(() => { if (ref.current && images) drawJaw(ref.current, jaw, face, geo, view, images, gumOpacity); }, [jaw, face, geo, view, images, gumOpacity]);
  const pctX = (x: number) => `${(x / width) * 100}%`;
  const pctY = (y: number) => `${((flip ? H - y : y) / H) * 100}%`;
  return <div className="relative" style={{ aspectRatio: `${width} / ${H}` }}>
    <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    {slots.map((slot: ToothSlot, i) => {
      const lv = view.levels[i], data = teeth[slot.tooth], isSel = selected === slot.tooth;
      const note = [data?.mobility && data.mobility !== "0" ? `M ${data.mobility}` : "", data?.furcation ? `F ${data.furcation}` : ""].filter(Boolean).join(" · ");
      const label = lv.excluded === "absent" ? "ausente" : lv.excluded === "implant" ? "implante" : null;
      return <button key={slot.tooth} type="button" disabled={lv.excluded === "absent"} onClick={event => onOpen(slot.tooth, event.currentTarget)}
        aria-label={`Pieza FDI ${formatFdi(slot.tooth)}${label ? `, ${label}` : "; seis sitios periodontales"}`} aria-pressed={isSel}
        className={`absolute top-0 h-full rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#ef895f] ${isSel ? "bg-white/10 ring-1 ring-[#ef895f]/80" : "hover:bg-white/[.06]"}`}
        style={{ left: pctX(slot.cx - slot.width / 2), width: pctX(slot.width) }}>
        <span className={`pointer-events-none absolute inset-x-0 flex flex-col items-center text-[11px] font-semibold leading-tight text-white/85 ${flip ? "bottom-1" : "top-1"}`}>{formatFdi(slot.tooth)}{note && <span className="text-[9px] font-medium text-amber-300">{note}</span>}{label && <span className="text-[9px] font-medium text-white/50">{label}</span>}</span>
      </button>;
    })}
    {slots.map((slot, i) => {
      const lv = view.levels[i];
      if (lv.excluded) return null;
      const xs = siteXs(slot);
      return lv.sites.map((site, k) => {
        const y = view.gumY[Math.max(0, Math.min(view.gumY.length - 1, Math.round(xs[k])))] - 14;
        const tone = depthTone(site.depth);
        return <span key={`${slot.tooth}-${k}`} aria-hidden="true" title={site.depth === null ? "Sin medir" : `${site.depth} mm${site.bleeding ? ", sangrado" : ""}${site.suppuration ? ", supuración" : ""}`}
          className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-[#130f1e]/90 font-bold leading-none ${site.depth === null ? "size-2 border-slate-500/60" : `size-[18px] text-[10px] ${TONE_STYLE[tone]}`}`}
          style={{ left: pctX(xs[k]), top: pctY(y) }}>{site.depth ?? ""}{site.bleeding && site.depth !== null && <i className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[#ff4057]" />}</span>;
      });
    })}
  </div>;
}

export function PerioArch({ teeth, toothStatuses, selected, onOpen }: { teeth: Record<number, PerioTooth | undefined>; toothStatuses: Record<number, string>; selected: number; onOpen: (tooth: number, element: HTMLElement) => void }) {
  const [face, setFace] = useState<ArchFace>("vestibular");
  const [gumPct, setGumPct] = useState(72);
  const images = useArchImages();
  const geos = useMemo(() => ({ upper: jawGeometry("upper", face), lower: jawGeometry("lower", face) }), [face]);
  const levelsFor = (jaw: Jaw) => geos[jaw].slots.map(slot => toothLevels(slot.tooth, teeth[slot.tooth], face, toothStatuses[slot.tooth]));
  const upperLevels = levelsFor("upper"), lowerLevels = levelsFor("lower");
  const signature = JSON.stringify([upperLevels, lowerLevels]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la firma resume los niveles; evita redibujar si no cambió ninguna medida
  const views = useMemo(() => ({ upper: buildView(geos.upper, upperLevels), lower: buildView(geos.lower, lowerLevels) }), [geos, signature]);
  const faceLabel = face === "vestibular" ? "Vestibular" : "Lingual / palatino";
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Cara de la arcada" className="inline-flex rounded-full border border-[#dddbe6] bg-white p-1 text-sm">
        {(["vestibular", "lingual"] as const).map(option => <button key={option} type="button" aria-pressed={face === option} onClick={() => setFace(option)} className={`rounded-full px-4 py-1.5 font-medium transition-colors ${face === option ? "bg-[#473a6d] text-white" : "text-[#57566a] hover:bg-[#efeef4]"}`}>{option === "vestibular" ? "Vestibular" : "Lingual / palatino"}</button>)}
      </div>
      <label className="flex items-center gap-2 text-xs text-[#57566a]">Encía translúcida
        <input type="range" min={0} max={100} value={gumPct} onChange={event => setGumPct(Number(event.target.value))} aria-label="Opacidad de la encía" className="w-32 accent-[#473a6d]" />
      </label>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-[#2a2142] bg-[radial-gradient(60%_45%_at_85%_0%,rgba(239,137,95,.18),transparent_70%),radial-gradient(70%_55%_at_10%_8%,rgba(120,96,196,.26),transparent_70%),linear-gradient(#171127,#0d0a16)]">
      <div className="min-w-[1100px] px-2 py-3 text-white">
        <p className="px-4 text-[11px] font-semibold uppercase tracking-wider text-white/55">Maxilar · {faceLabel}</p>
        <ArchRow jaw="upper" face={face} geo={geos.upper} view={views.upper} images={images} gumOpacity={gumPct / 100} selected={selected} teeth={teeth} onOpen={onOpen} />
        <div className="mx-auto my-1 h-px w-[70%] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <ArchRow jaw="lower" face={face} geo={geos.lower} view={views.lower} images={images} gumOpacity={gumPct / 100} selected={selected} teeth={teeth} onOpen={onOpen} />
        <p className="px-4 text-[11px] font-semibold uppercase tracking-wider text-white/55">Mandíbula · {faceLabel}</p>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#615f73]">
      <span className="text-emerald-800">0–3 mm</span><span className="text-amber-900">4–5 mm</span><span className="text-rose-800">≥6 mm</span><span>punto rojo: sangrado · punto amarillo: supuración · punto gris: sin medir</span>
      <span>La cresta ósea es una estimación (inserción + 2 mm); la altura real se confirma con radiografía. Pulsa una pieza para acercarla.</span>
    </div>
  </div>;
}
