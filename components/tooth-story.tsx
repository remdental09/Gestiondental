"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PhotoStack } from "@/components/photo-stack";
import { CariesOverlay } from "@/components/caries-overlay";
import { toothStory, type StoryStage } from "@/lib/tooth-story";
import { formatFdi, type ToothHistoryEvent } from "@/app/clinical-data";

const shown = (day: string) => (day ? day.split("-").reverse().join("-") : "sin fecha");

function StageImage({ stage, tooth, large }: { stage: StoryStage; tooth: number; large: boolean }) {
  const alt = `Pieza ${formatFdi(tooth)} · ${stage.label} · ${shown(stage.day)}`;
  if (!stage.photo) return <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-[#6b6a7c]" data-testid="story-nophoto">{stage.label}</div>;
  return <div className={`relative h-full w-full ${stage.absent ? "opacity-30" : ""}`}><PhotoStack photo={stage.photo} alt={alt} eager={large} /><CariesOverlay spots={stage.photo.lesions} labels={large} cover /></div>;
}

/** «Película de la pieza»: cada etapa con su fecha y su imagen del banco, de la más antigua a la actual. Las imágenes son referenciales. */
export function ToothStory({ tooth, history, endoNow = false, size = "compact", actions }: { tooth: number; history: ToothHistoryEvent[]; endoNow?: boolean; size?: "compact" | "large"; actions?: ReactNode }) {
  const stages = useMemo(() => toothStory(history, tooth, { endoNow }), [history, tooth, endoNow]);
  const large = size === "large";
  const [index, setIndex] = useState(Math.max(0, stages.length - 1));
  const [playing, setPlaying] = useState(false);
  const [compare, setCompare] = useState(false);
  useEffect(() => { setIndex(Math.max(0, stages.length - 1)); setPlaying(false); }, [tooth, stages.length]);
  useEffect(() => {
    if (!playing) return;
    if (index >= stages.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(i => Math.min(i + 1, stages.length - 1)), 1400);
    return () => clearTimeout(timer);
  }, [playing, index, stages.length]);

  if (!stages.length) return <section className="mt-4 rounded-xl border border-dashed border-[#dddbe6] bg-white p-4" data-testid="tooth-story-empty"><h5 className="text-sm font-semibold text-[#3b3355]">Película de la pieza</h5><p className="mt-1 text-xs text-[#6b6a7c]">Cuando esta pieza tenga cambios registrados (caries, obturación, corona, implante…) irá armando aquí su historia, etapa por etapa y con fecha.</p>{actions&&<div className="mt-3">{actions}</div>}</section>;

  const stage = stages[Math.min(index, stages.length - 1)];
  const first = stages[0];
  // Imágenes chicas: lo que importa leer es la etapa y su fecha (la foto grande ya está arriba en «Ver pieza»).
  const box = large ? "w-28 sm:w-32" : "w-24 sm:w-28";
  return <section className={`mt-4 rounded-xl border border-[#dddbe6] bg-white ${large ? "p-3" : "p-4"}`} data-testid="tooth-story" data-size={size}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h5 className="text-sm font-semibold text-[#3b3355]">Película de la pieza · FDI {formatFdi(tooth)}</h5>
      <div className="flex flex-wrap gap-2">
        {actions}
        {stages.length > 1 && <button type="button" data-testid="story-play" onClick={() => { if (playing) setPlaying(false); else { if (index >= stages.length - 1) setIndex(0); setPlaying(true); } }} className="h-8 rounded-lg bg-[#473a6d] px-3 text-xs font-semibold text-white">{playing ? "Pausar" : "Reproducir"}</button>}
        {stages.length > 1 && <button type="button" data-testid="story-compare" aria-pressed={compare} onClick={() => setCompare(v => !v)} className={`h-8 rounded-lg border px-3 text-xs font-semibold ${compare ? "border-[#473a6d] bg-[#efeaf8] text-[#473a6d]" : "border-[#d8d3e3] bg-white text-[#473a6d]"}`}>Antes / ahora</button>}
      </div>
    </div>
    <div className="mt-3 flex items-start gap-3" data-testid="story-body">
      {compare && stages.length > 1
        ? <div className="flex shrink-0 gap-2" data-testid="story-compare-view">{[first, stages[stages.length - 1]].map((item, i) => <figure key={item.id} className="m-0"><div className={`${box} aspect-[420/576] overflow-hidden rounded-lg border border-[#ebe9f2] bg-[#f7f6fa]`}><StageImage stage={item} tooth={tooth} large={large} /></div><figcaption className="mt-1 text-xs font-semibold text-[#3b3355]">{i === 0 ? "Antes" : "Ahora"} · {shown(item.day)}</figcaption></figure>)}</div>
        : <figure className="m-0 shrink-0" data-testid="story-selected" data-stage={stage.id}><div className={`${box} aspect-[420/576] overflow-hidden rounded-lg border border-[#ebe9f2] bg-[#f7f6fa]`}><StageImage stage={stage} tooth={tooth} large={large} /></div></figure>}
      <div className="min-w-[9rem] flex-1 text-sm leading-snug">
        <p className="font-semibold text-[#3b3355]" data-testid="story-label">{stage.label}</p>
        <p className="text-xs text-[#6b6a7c]">{shown(stage.day)}{stage.current ? " · estado actual" : ""}</p>
        {stage.lesion && stage.lesion !== stage.label && <p className="mt-1 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">{stage.lesion}</p>}
        {stage.detail && <p className="mt-2 text-xs text-[#57566a]">{stage.detail}</p>}
        <p className="mt-2 text-[11px] text-[#6b6a7c]">Imagen referencial, no es el paciente.</p>
      </div>
    </div>
    <ol className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Etapas de la pieza" data-testid="story-strip">
      {stages.map((item, i) => <li key={item.id} className="shrink-0"><button type="button" data-testid="story-stage" aria-current={i === index} onClick={() => { setPlaying(false); setCompare(false); setIndex(i); }} className={`block w-16 rounded-lg border p-1 text-left ${i === index ? "border-[#473a6d] ring-2 ring-[#473a6d]/30" : "border-[#dddbe6]"}`}><span className="block aspect-[420/576] overflow-hidden rounded bg-[#f7f6fa]"><StageImage stage={item} tooth={tooth} large={false} /></span><span className="mt-1 block text-[10px] font-semibold leading-tight text-[#3b3355]">{shown(item.day)}</span><span className="block truncate text-[10px] text-[#6b6a7c]">{item.current ? "Hoy" : item.label}</span></button></li>)}
    </ol>
  </section>;
}
