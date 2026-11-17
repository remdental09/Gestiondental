"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { arancelFor } from "@/components/budget-plan";
import { createAudioTranscription, AUDIO_DICTATION_NOTICE } from "@/lib/dictation/audio-transcription";
import { parseQuickBudget, quickRowToItem, QUICK_BUDGET_EXAMPLE, type QuickRow } from "@/lib/quick-budget";
import { prestacionByCode, prestacionLabel } from "@/lib/prestaciones-catalog";
import { zoneSummary } from "@/lib/treatment-zones";
import { formatFdiTooth, fdiToChile, type ToothNumbering } from "@/lib/tooth-numbering";
import type { BudgetItem } from "@/lib/budget-plans";

type Own = { name: string; price: number | null };
const money = (amount: number) => "$" + amount.toLocaleString("es-CL");
const whereOf = (row: QuickRow) => row.zone ? zoneSummary(row.zone) : row.teeth.length ? `FDI ${row.teeth.map(formatFdiTooth).join(", ")} · Ch. ${row.teeth.map(fdiToChile).join(", ")}` : "General";

export function QuickBudgetDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (title: string, items: BudgetItem[]) => Promise<void> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <QuickBudgetBody onClose={() => onOpenChange(false)} onCreate={onCreate} />}</Dialog>;
}

function QuickBudgetBody({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, items: BudgetItem[]) => Promise<void> }) {
  const engine = useRef(createAudioTranscription());
  const [text, setText] = useState("");
  const [numbering, setNumbering] = useState<ToothNumbering>("fdi");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [customs, setCustoms] = useState<Own[]>([]);
  // Cambios del profesional sobre lo entendido: prestación elegida y filas quitadas.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const live = engine.current;
    fetch("/api/aranceles").then(r => r.ok ? r.json() as Promise<{ prices?: Record<string, number> }> : null).then(r => { if (!cancelled && r?.prices) setPrices(r.prices); }).catch(() => {});
    fetch("/api/aranceles/custom").then(r => r.ok ? r.json() as Promise<{ items?: Own[] }> : null).then(r => { if (!cancelled && r?.items) setCustoms(r.items); }).catch(() => {});
    return () => { cancelled = true; live.abort(); };
  }, []);

  const parsed = useMemo(() => parseQuickBudget(text, numbering), [text, numbering]);
  const rows = useMemo(() => parsed.rows.filter(row => !removed.has(row.id)).map(row => {
    const code = picked[row.id] ?? row.code;
    const found = code ? prestacionByCode(code) : undefined;
    return { ...row, code: found ? found.code : null, label: found ? prestacionLabel(found.name) : row.label, needsChoice: !found };
  }), [parsed, picked, removed]);
  const items = rows.map(row => { const base = quickRowToItem(row, 0); return { ...base, amount: arancelFor(base, prices, customs) ?? 0 }; });
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const undefinedCount = items.filter(item => item.amount === 0).length;

  const start = () => {
    setError("");
    if (!engine.current.isSupported()) { setError(engine.current.unsupportedMessage()); return; }
    setListening(true);
    engine.current.start(text, {
      onStatus: status => { setTranscribing(status === "transcribing"); setListening(status === "starting" || status === "recording"); },
      onTranscript: value => setText(value),
      onError: message => { setError(message); setListening(false); setTranscribing(false); },
      onEnd: () => { setListening(false); setTranscribing(false); },
    });
  };
  const stop = () => { setTranscribing(true); setListening(false); engine.current.stop(); };

  const create = async () => {
    if (!items.length) { setError("Dicta al menos una pieza con su tratamiento."); return; }
    setSaving(true); setError("");
    try {
      const date = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Santiago" }).format(new Date());
      await onCreate(`Presupuesto rápido · ${date}`, items);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el presupuesto."); setSaving(false); }
  };

  return <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader>
      <DialogTitle>Presupuesto rápido por dictado</DialogTitle>
      <DialogDescription>Di dónde y qué, tramo a tramo: «{QUICK_BUDGET_EXAMPLE}». Puedes saltarte piezas. Los valores salen de tus aranceles; si falta uno queda «por definir».</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="lg" className={`min-h-12 ${listening ? "fx-mic-live bg-[#a43542] hover:bg-[#8a2c37]" : "bg-[#473a6d] hover:bg-[#3a2f5a]"}`} disabled={transcribing || saving} onClick={listening ? stop : start}>
          {listening ? <MicOff className="mr-2 size-5" /> : <Mic className="mr-2 size-5" />}{listening ? "Detener" : text ? "Seguir dictando" : "Empezar a dictar"}
        </Button>
        <div role="radiogroup" aria-label="Numeración de las piezas" className="flex overflow-hidden rounded-lg border border-[#dddbe6]">
          {([["fdi", "FDI"], ["chile", "Chilena"]] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={numbering === value} onClick={() => setNumbering(value)} className={"min-h-12 px-3 " + (numbering === value ? "bg-[#473a6d] text-white" : "bg-white")}>{label}</button>)}
        </div>
      </div>
      {transcribing && <p role="status" className="rounded-lg bg-sky-50 p-3 font-medium text-sky-950">Transcribiendo el audio…</p>}
      {listening && <p role="status" className="font-medium text-[#473a6d]">Escuchando… di «36 exodoncia», «14 15 resina dos caras»; con puntos (3.6) siempre es FDI.</p>}
      <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950">{AUDIO_DICTATION_NOTICE}</p>
      <label className="block space-y-1.5 font-medium">Lo dictado (editable)
        <Textarea rows={4} lang="es-CL" spellCheck={false} className="field-sizing-fixed text-base sm:text-sm" value={text} onChange={event => setText(event.target.value)} placeholder={QUICK_BUDGET_EXAMPLE} />
      </label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950">{error}</p>}
      {parsed.leftovers.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-amber-950">Faltó el tratamiento en: {parsed.leftovers.join("; ")}.</p>}
      {rows.length > 0 && <ul className="space-y-2" aria-label="Prestaciones entendidas">
        {rows.map((row, index) => {
          const options = row.options.filter(option => option.code !== row.code);
          return <li key={row.id} className="rounded-xl border border-[#dddbe6] bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-xs text-[#6b6a7c]">{whereOf(row)}</p><p className="font-medium">{row.needsChoice ? <span className="text-[#a43542]">Elige la prestación: «{row.label}»</span> : row.label}</p></div>
              <div className="flex shrink-0 items-center gap-2"><span className={items[index].amount ? "font-semibold" : "text-xs text-[#6b6a7c]"}>{items[index].amount ? money(items[index].amount) : "Por definir"}</span>
                <button type="button" aria-label="Quitar esta prestación" className="rounded p-1 text-[#6b6a7c] hover:bg-[#f1f0f5]" onClick={() => setRemoved(previous => new Set(previous).add(row.id))}><Trash2 className="size-4" /></button></div>
            </div>
            {options.length > 0 && <label className="mt-2 block text-xs text-[#6b6a7c]">{row.needsChoice ? "Prestación del arancel" : "Cambiar por otra"}
              <select className="mt-1 w-full rounded-lg border border-[#dddbe6] bg-white p-2 text-sm text-[#35343f]" value="" onChange={event => { if (event.target.value) setPicked(previous => ({ ...previous, [row.id]: event.target.value })); }}>
                <option value="">{row.needsChoice ? "Elegir…" : "Mantener"}</option>
                {options.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
              </select></label>}
          </li>;
        })}
      </ul>}
      {rows.length > 0 && <p className="text-right font-semibold">Total: {money(total)}{undefinedCount ? <span className="ml-2 text-xs font-normal text-[#6b6a7c]">({undefinedCount} por definir)</span> : null}</p>}
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
      <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving || !rows.length || rows.some(row => row.needsChoice)} onClick={() => void create()}>{saving ? "Creando…" : "Crear presupuesto"}</Button>
    </DialogFooter>
  </DialogContent>;
}
