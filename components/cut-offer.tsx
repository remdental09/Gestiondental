"use client";
/* eslint-disable @next/next/no-img-element -- Son vistas previas en memoria, aún sin guardar. */
/**
 * Imagen subida o pegada que resultó ser la ventana de Blue Sky Plan: se muestran los cortes encontrados y el profesional
 * elige qué se guarda. Nada se guarda sin que toque un botón.
 */
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { Cut } from "@/lib/capture-crop";
import type { DetectedView } from "@/lib/capture-detect";

export type Offer = {
  id: number;
  /** Implante para el que se subió: nunca se guarda en otro. */
  target: number;
  original: File;
  url: string;
  cuts: (Cut & { url: string })[];
  chosen: DetectedView[];
};

const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c9c4da] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

export function CutOffer({ offer, waiting, patientName, view, busy, onToggle, onSaveCuts, onSaveWhole, onDiscard }: {
  offer: Offer;
  /** Cuántas imágenes más esperan decisión después de esta. */
  waiting: number;
  patientName: string;
  /** Tipo marcado arriba: con él se guarda la imagen completa. */
  view: string;
  busy: boolean;
  onToggle: (view: DetectedView) => void;
  onSaveCuts: () => void;
  onSaveWhole: () => void;
  onDiscard: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [offer.id]);
  const count = offer.chosen.length;
  return <div ref={box} className="space-y-3 rounded-xl border border-[#473a6d] bg-[#f7f5fb] p-3" data-testid="cut-offer">
    <p className="break-words text-sm font-semibold text-[#2a2540]">Es una ventana de Blue Sky. Comprueba que sea de {patientName}.</p>
    <a href={offer.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir la imagen completa en grande" className="block"><img src={offer.url} alt="Imagen completa sin guardar" className="max-h-40 w-full rounded-lg bg-[#1f1b30] object-contain"/></a>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cortes encontrados">{offer.cuts.map(cut => {
      const on = offer.chosen.includes(cut.view);
      return <button key={cut.view} type="button" aria-pressed={on} disabled={busy} onClick={() => onToggle(cut.view)} className={`overflow-hidden rounded-xl border-2 bg-white text-left ${on ? "border-[#473a6d]" : "border-transparent"}`}>
        <img src={cut.url} alt="" className="h-28 w-full bg-[#1f1b30] object-contain"/>
        <span className="flex min-h-9 items-center justify-between gap-2 px-2 text-sm font-medium">{cut.view}{on && <Check className="size-4 text-[#473a6d]" aria-hidden="true"/>}</span>
      </button>;
    })}</div>
    {/* A la vista sin tener que bajar, aunque haya cuatro cortes. */}
    <div className="sticky -bottom-3 -mx-3 grid gap-2 border-t border-[#e6e4ee] bg-[#f7f5fb] px-3 py-2">
      <button type="button" className={primary} disabled={busy || !count} onClick={onSaveCuts} data-testid="cut-offer-save">{count === 1 ? `Guardar corte «${offer.chosen[0]}»` : count ? `Guardar ${count} cortes` : "Toca el corte que quieras guardar"}</button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={secondary} disabled={busy} onClick={onSaveWhole} aria-label={`Guardar la imagen completa como ${view}`} data-testid="cut-offer-whole">Guardar completa</button>
        <button type="button" className={secondary} disabled={busy} onClick={onDiscard} data-testid="cut-offer-discard">No guardar</button>
      </div>
    </div>
    {waiting > 0 && <p className="text-xs text-[#615f73]">{waiting === 1 ? "Queda 1 imagen más por decidir." : `Quedan ${waiting} imágenes más por decidir.`}</p>}
  </div>;
}
