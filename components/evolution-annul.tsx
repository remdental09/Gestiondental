"use client";

import { useState } from "react";
import { Ban, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WordDiffView, useTextCorrection } from "@/components/text-correction";
import { resolveCommandTarget, type CommandNote, type VoiceCommand } from "@/lib/dictation/voice-command";

export type AnnulReplacement = { title: string; body: string };
/** «delete»: error del sistema, se borra definitivamente. «annul»: error clínico, queda tachada. */
export type RemovalMode = "delete" | "annul";
export type AnnulHandler = (evolutionId: number, mode: RemovalMode, reason: string, replacement: AnnulReplacement | null) => Promise<void>;

const preview = (text: string, max = 160) => text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
const noteDay = (note: CommandNote) => note.date ?? (note.clinicalDate ? note.clinicalDate.split("-").reverse().join("-") : "");
/** Evoluciones guardadas desde el dictado (llevan la transcripción completa o el título por defecto). */
export const isDictatedNote = (note: CommandNote) => /Transcripción completa/.test(note.body) || note.title === "Evolución dictada";

/** Las dos salidas: el dentista decide. */
function ModeChoice({ mode, onChange, name }: { mode: RemovalMode | null; onChange: (mode: RemovalMode) => void; name: string }) {
  const option = (value: RemovalMode, title: string, detail: string) => <label className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-lg border p-3 ${mode === value ? "border-[#a43542] bg-rose-50" : "border-[#ddd6f0] bg-white"}`}>
    <input type="radio" name={name} className="mt-0.5 size-5 shrink-0 accent-[#a43542]" checked={mode === value} onChange={() => onChange(value)} data-testid={`${name}-${value}`} />
    <span><span className="block font-semibold">{title}</span><span className="block text-xs font-normal leading-5 text-[#625e82]">{detail}</span></span>
  </label>;
  return <fieldset className="min-w-0 space-y-2" aria-label="Cómo eliminar">
    {option("delete", "Error del sistema — eliminar definitivamente", "Se borra la evolución y sus diagnósticos; no queda en la ficha.")}
    {option("annul", "Anular (error clínico)", "Queda tachada en la historia, con motivo y fecha.")}
  </fieldset>;
}

const KEEP_NOTE = "Los cambios que esta evolución hizo en el odontograma se deshacen y cada pieza se recalcula con las demás evoluciones. Pagos, citas y presupuestos no cambian; revísalos aparte si corresponde.";

/** Editor del texto nuevo con «Corregir texto» y las palabras cambiadas marcadas. */
function ReplacementEditor({ value, onChange, testId }: { value: string; onChange: (value: string) => void; testId: string }) {
  const correction = useTextCorrection();
  const [before, setBefore] = useState("");
  return <div className="space-y-2">
    <Textarea className="bg-white text-base sm:text-sm" rows={4} value={value} onChange={(event) => { onChange(event.target.value); correction.reset(); }} data-testid={`${testId}-text`} aria-label="Texto de la evolución nueva" />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-10 bg-white" disabled={correction.correcting || value.trim().length < 3} onClick={async () => { const source = value; const next = await correction.correct(source); if (next) { setBefore(source); onChange(next.text); } }} data-testid={`${testId}-correct`}>
        <Sparkles className="mr-1.5 size-4" aria-hidden="true" />{correction.correcting ? "Corrigiendo…" : "Corregir texto"}
      </Button>
      {correction.error && <span role="alert" className="text-xs text-[#a43542]">{correction.error}</span>}
    </div>
    <p className="text-xs leading-5 text-[#625e82]">Al corregir, este texto se envía a OpenAI si está configurada la clave; si no, a Workers AI cuando está habilitado. No se guarda hasta que lo revises y confirmes.</p>
    {correction.result && <>
      {correction.result.provider && <p className="text-xs text-[#625e82]">Proveedor: {correction.result.provider === "openai" ? "API de OpenAI" : correction.result.provider === "workers-ai" ? "Cloudflare Workers AI" : "diccionario local"}.</p>}
      {correction.result.openAiNotConfigured && <p className="text-xs text-amber-900">La clave de OpenAI aún no está configurada en Cloudflare.</p>}
      {correction.result.aiError && <p className="text-xs text-amber-900">La IA no respondió ({correction.result.aiError}); se corrigió solo con el diccionario.</p>}
      <WordDiffView before={before} after={correction.result.text} testId={`${testId}-diff`} />
    </>}
  </div>;
}

/** Botón «Eliminar evolución» de la historia clínica: el dentista elige borrar o anular y confirma. */
export function AnnulEvolutionDialog({ note, onClose, onConfirm }: { note: CommandNote | null; onClose: () => void; onConfirm: AnnulHandler }) {
  const [mode, setMode] = useState<RemovalMode | null>(null);
  const [reason, setReason] = useState("");
  const [replace, setReplace] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shownFor, setShownFor] = useState<number | null>(null);
  // Al abrir: si vino del dictado se preselecciona «eliminar definitivamente».
  if (note && note.id !== shownFor) { setShownFor(note.id); setMode(isDictatedNote(note) ? "delete" : null); }
  const reset = () => { setMode(null); setReason(""); setReplace(false); setBody(""); setError(""); setSaving(false); setShownFor(null); };
  const submit = async () => {
    if (!note || !mode) return;
    setSaving(true);
    setError("");
    try {
      await onConfirm(note.id, mode, reason.trim(), replace && body.trim() ? { title: note.title || "Evolución clínica", body: body.trim() } : null);
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar.");
      setSaving(false);
    }
  };
  const ready = !!mode && (mode === "delete" || reason.trim().length >= 3) && (!replace || body.trim().length >= 3);
  return <Dialog open={!!note} onOpenChange={(next) => { if (!next && !saving) { reset(); onClose(); } }}>
    <DialogContent className="max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] overflow-y-auto bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-xl" data-testid="annul-dialog">
      <DialogHeader>
        <DialogTitle>Eliminar evolución</DialogTitle>
        <DialogDescription>Elige qué pasó con este registro.</DialogDescription>
      </DialogHeader>
      {note && <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-[#e4def3] bg-[#f7f4ff] p-3"><p className="text-xs font-medium uppercase tracking-wide text-[#6e6a8c]">{noteDay(note)}{isDictatedNote(note) ? " · dictada" : ""}</p><p className="font-semibold">{note.title}</p><p className="mt-1 whitespace-pre-wrap text-[#565277]">{preview(note.body, 400)}</p></div>
        <ModeChoice mode={mode} onChange={setMode} name="annul-mode" />
        {mode === "annul" && <label className="block space-y-1 font-medium">Motivo *
          <Input className="text-base sm:text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: pieza equivocada, dato clínico erróneo" data-testid="annul-reason" />
        </label>}
        {mode && <label className="flex min-h-11 items-start gap-2 font-medium">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#6a3fc8]" checked={replace} onChange={(event) => setReplace(event.target.checked)} data-testid="annul-replace" />
          <span>Escribir una evolución nueva en su lugar</span>
        </label>}
        {mode && replace && <ReplacementEditor value={body} onChange={setBody} testId="annul-replacement" />}
        {mode && <p className="text-xs text-[#625e82]">{KEEP_NOTE}</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-900">{error}</p>}
      </div>}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => { reset(); onClose(); }}>Cancelar</Button>
        <Button type="button" className="min-h-11 bg-[#a43542] hover:bg-[#8a2c37]" disabled={saving || !ready} onClick={() => void submit()} data-testid="annul-confirm">
          <Ban className="mr-2 size-4" aria-hidden="true" />{saving ? "Guardando…" : mode === "annul" ? (replace ? "Anular y guardar la nueva" : "Anular evolución") : mode === "delete" ? (replace ? "Eliminar y guardar la nueva" : "Eliminar definitivamente") : "Elige una opción"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/**
 * Tarjeta de una orden dictada («elimina el último dictado… y pon solamente que…»).
 * Propone eliminar definitivamente la evolución y el texto nuevo; nada pasa hasta dos toques explícitos.
 */
export function VoiceCommandCard({ command, notes, patientName, onConfirm, onDismiss }: { command: VoiceCommand; notes: CommandNote[]; patientName: string; onConfirm: AnnulHandler; onDismiss?: () => void }) {
  const target = resolveCommandTarget(command.target, notes);
  const [mode, setMode] = useState<RemovalMode>("delete");
  const [reason, setReason] = useState(`Orden dictada: «${preview(command.evidence, 140)}»`);
  const [withReplacement, setWithReplacement] = useState(!!command.replacement);
  const [body, setBody] = useState(command.replacement ?? "");
  const [step, setStep] = useState<"review" | "confirm" | "saving" | "done">("review");
  const [error, setError] = useState("");
  const note = target.note;
  const replacing = withReplacement && body.trim().length >= 3;
  const verb = mode === "delete" ? "Eliminar" : "Anular";
  const confirm = async () => {
    if (!note) return;
    setStep("saving");
    setError("");
    try {
      await onConfirm(note.id, mode, reason.trim(), replacing ? { title: note.title || "Evolución clínica", body: body.trim() } : null);
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar.");
      setStep("review");
    }
  };
  if (step === "done") return <section role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" data-testid="voice-command-done">
    <p className="font-semibold">Evolución del {note ? noteDay(note) : ""} {mode === "delete" ? "eliminada" : "anulada"}{replacing ? " y nueva evolución guardada" : ""}.</p>
    <p className="mt-1 text-xs leading-5">Ficha de {patientName}.{mode === "annul" ? " La anulada se ve tachada con «Ver anuladas»." : ""}</p>
  </section>;
  return <section className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3 sm:p-4" data-testid="voice-command-card">
    <div>
      <h3 className="text-base font-semibold text-amber-950">Orden dictada: eliminar{command.replacement ? " y reemplazar" : ""} una evolución</h3>
      <p className="mt-1 text-xs text-amber-900">Dicho: «{preview(command.evidence, 200)}»</p>
    </div>
    {note ? <div className="rounded-lg border border-rose-200 bg-white p-3" data-testid="voice-command-target">
      <p className="text-sm font-semibold text-rose-900"><Ban className="mr-1 inline size-4 align-[-3px]" aria-hidden="true" />{verb} evolución del {noteDay(note)}</p>
      <p className="mt-1 text-sm"><strong>{note.title}</strong> — <span className="text-[#565277]">{preview(note.body)}</span></p>
      {target.sameDay > 1 && <p className="mt-1 text-xs text-amber-900">Hay {target.sameDay} evoluciones ese día; se propone la más reciente. Si es otra, elimínala desde la historia clínica.</p>}
    </div> : <p role="alert" className="rounded-lg bg-white p-3 text-sm text-rose-900">{target.message}</p>}
    {note && <>
      <ModeChoice mode={mode} onChange={(next) => { setMode(next); setStep("review"); }} name="voice-command-mode" />
      {mode === "annul" && <label className="block space-y-1 text-sm font-medium">Motivo
        <Input className="bg-white text-base sm:text-sm" value={reason} onChange={(event) => { setReason(event.target.value); setStep("review"); }} data-testid="voice-command-reason" />
      </label>}
      <label className="flex min-h-11 items-start gap-2 text-sm font-medium">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#6a3fc8]" checked={withReplacement} onChange={(event) => { setWithReplacement(event.target.checked); setStep("review"); }} data-testid="voice-command-with-replacement" />
        <span>Nueva evolución{command.replacement ? " (lo que pediste dejar)" : ""}</span>
      </label>
      {withReplacement && <ReplacementEditor value={body} onChange={(value) => { setBody(value); setStep("review"); }} testId="voice-command-replacement" />}
      <p className="text-xs leading-5 text-[#625e82]">{KEEP_NOTE}</p>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      {step === "review" && <Button type="button" size="lg" className="h-auto min-h-12 w-full whitespace-normal bg-[#a43542] hover:bg-[#8a2c37]" disabled={(mode === "annul" && reason.trim().length < 3) || (withReplacement && !replacing)} onClick={() => setStep("confirm")} data-testid="voice-command-review">
        {replacing ? `${verb} la del ${noteDay(note)} y guardar la nueva…` : `${verb} la evolución del ${noteDay(note)}…`}
      </Button>}
      {(step === "confirm" || step === "saving") && <div className="space-y-2 rounded-lg border border-rose-300 bg-white p-3" data-testid="voice-command-confirm-step">
        <p className="text-sm font-medium text-rose-950">¿Confirmas? Se {mode === "delete" ? "eliminará definitivamente" : "anulará"} «{note.title}» del {noteDay(note)}{replacing ? " y se guardará la evolución nueva de hoy" : ""}.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-auto min-h-11 flex-1 whitespace-normal bg-[#a43542] hover:bg-[#8a2c37]" disabled={step === "saving"} onClick={() => void confirm()} data-testid="voice-command-confirm">{step === "saving" ? "Guardando…" : "Sí, confirmar"}</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={step === "saving"} onClick={() => setStep("review")}>Volver</Button>
        </div>
      </div>}
    </>}
    {onDismiss && step !== "saving" && <Button type="button" variant="ghost" size="sm" className="h-auto w-full whitespace-normal" onClick={onDismiss} data-testid="voice-command-dismiss">No es una orden: tratarlo como dictado clínico</Button>}
  </section>;
}
