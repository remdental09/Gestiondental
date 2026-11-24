"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeCard } from "@/lib/evolution-changes";

export type ChangesDecision = { action: "apply"; ids: string[] } | { action: "skip" } | { action: "cancel" };

/** Hoja emergente al guardar una evolución: qué va a cambiar en el odontograma, para aceptarlo con un toque. */
export function EvolutionChangesSheet({ cards, patientName, extra = [], busy = false, escape = true, onDecide }: { cards: ChangeCard[]; patientName: string; extra?: string[]; busy?: boolean; escape?: boolean; onDecide: (decision: ChangesDecision) => void }) {
  const [off, setOff] = useState<Set<string>>(() => new Set(cards.filter((card) => card.review).map((card) => card.ids.join("|"))));
  const key = (card: ChangeCard) => card.ids.join("|");
  const chosen = useMemo(() => cards.filter((card) => !off.has(key(card))), [cards, off]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (escape && event.key === "Escape" && !busy) onDecide({ action: "cancel" }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, escape, onDecide]);
  const toggle = (card: ChangeCard) => setOff((previous) => { const next = new Set(previous); if (next.has(key(card))) next.delete(key(card)); else next.add(key(card)); return next; });
  if (typeof document === "undefined") return null;
  // Va al <body> y aísla los eventos: si se abre sobre otro diálogo, ese no debe leerlos como un toque «afuera».
  const isolate = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" style={{ pointerEvents: "auto" }} data-testid="changes-sheet" onPointerDown={isolate} onPointerUp={isolate} onMouseDown={isolate} onFocus={isolate} onKeyDown={isolate}>
      <style>{`
        @keyframes gd-sheet-in{from{transform:translateY(32px) scale(.98);opacity:0}to{transform:none;opacity:1}}
        @keyframes gd-fade-in{from{opacity:0}to{opacity:1}}
        .gd-sheet{animation:gd-sheet-in .38s cubic-bezier(.2,.9,.25,1)}
        .gd-backdrop{animation:gd-fade-in .25s ease-out}
        @media (prefers-reduced-motion:reduce){.gd-sheet,.gd-backdrop{animation:none}}
      `}</style>
      <button type="button" aria-label="Volver a la evolución" disabled={busy} onClick={() => onDecide({ action: "cancel" })} className="gd-backdrop absolute inset-0 bg-black/35 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label="Cambios en el odontograma" className="gd-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-xl sm:max-w-xl sm:rounded-3xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[#d8d3e3] sm:hidden" />
        <div className="px-5 pb-2 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">{patientName}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-[#2b2540]">Esto va a cambiar en el odontograma</h2>
        </div>
        <ul className="flex-1 space-y-3 overflow-y-auto px-5 pb-3">
          {cards.map((card) => {
            const on = !off.has(key(card));
            return (
              <li key={key(card)} className={`rounded-2xl border p-4 transition ${on ? "border-[#473a6d] bg-[#f5f2fb]" : "border-[#dddbe6] bg-white opacity-70"}`}>
                <button type="button" disabled={busy} onClick={() => toggle(card)} aria-pressed={on} className="flex w-full items-center justify-between gap-3 text-left">
                  <span className="text-xl font-bold text-[#2b2540]">{card.title}</span>
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold ${on ? "bg-[#473a6d] text-white" : "border border-[#c9c5d8] text-transparent"}`} aria-hidden>✓</span>
                </button>
                <div className="mt-2 space-y-2">
                  {card.lines.map((line) => (
                    <div key={line.label} className="text-base">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">{line.label}</p>
                      <p className="text-[#6b6a7c] line-through decoration-[#c9c5d8]">{line.before}</p>
                      <p className="text-lg font-semibold text-[#2b2540]">{line.after}</p>
                    </div>
                  ))}
                </div>
                {card.note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{card.note}</p>}
              </li>
            );
          })}
          {extra.length > 0 && <li className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4 text-sm text-teal-900">{extra.map((line) => <p key={line}>{line}</p>)}</li>}
        </ul>
        <div className="space-y-2 border-t border-[#ece9f3] px-5 pb-6 pt-4">
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => onDecide({ action: "apply", ids: chosen.flatMap((card) => card.ids) })} className="h-14 w-full rounded-2xl bg-[#473a6d] text-lg font-bold text-white shadow-lg transition active:scale-[.98] disabled:opacity-50" data-testid="changes-accept">
            {busy ? "Guardando…" : chosen.length === cards.length ? "Aceptar y guardar" : `Aceptar ${chosen.length} y guardar`}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => onDecide({ action: "skip" })} className="h-11 rounded-xl border border-[#d8d3e3] text-sm font-semibold text-[#473a6d] disabled:opacity-50" data-testid="changes-skip">Guardar sin cambiar</button>
            <button type="button" disabled={busy} onClick={() => onDecide({ action: "cancel" })} className="h-11 rounded-xl text-sm font-semibold text-[#6b6a7c] disabled:opacity-50">Volver a editar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
