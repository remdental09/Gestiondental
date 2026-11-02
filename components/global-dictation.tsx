"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Sparkles, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createWebSpeechTranscription, IOS_DICTATION_HINT, MIC_DENIED, micAllowed } from "@/lib/dictation/transcription";
import type { PatientDecision } from "@/lib/dictation/patient-identify";
import { hasFourNameParts } from "@/app/patient-identity";
import { WordDiffView, useTextCorrection } from "@/components/text-correction";
import { VoiceCommandCard, type AnnulReplacement, type RemovalMode } from "@/components/evolution-annul";
import { chileTodayIso, parseVoiceCommand, type CommandNote } from "@/lib/dictation/voice-command";

const fourNames = (value: string): boolean => hasFourNameParts(value);

type PatientOption = { id: number; name: string; rut?: string | null };
export type NewPatientFields = { name: string; rut: string; birthDate: string; phone: string; email: string };


/**
 * Dictado desde Inicio: escucha, decide en el servidor (sin IA) a qué ficha va —o propone crear una—,
 * pide confirmar con un toque y entrega el texto a la ficha, donde la IA lo corrige y se revisa todo.
 */
export function GlobalDictation({ patients, notes = [], onUsePatient, onCreatePatient, onAnnul }: {
  patients: PatientOption[];
  /** Evoluciones (con su paciente) para proponer qué anular cuando se dicta una orden. */
  notes?: (CommandNote & { patientId: number })[];
  onUsePatient: (patientId: number, transcript: string, options?: { ignoreCommand?: boolean; incorporate?: boolean }) => void;
  onCreatePatient: (fields: NewPatientFields) => Promise<number>;
  onAnnul?: (patientId: number, evolutionId: number, mode: RemovalMode, reason: string, replacement: AnnulReplacement | null) => Promise<void>;
}) {
  const engine = useRef(createWebSpeechTranscription());
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [decision, setDecision] = useState<PatientDecision | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<string>("");
  const [otherSearch, setOtherSearch] = useState("");
  const [fields, setFields] = useState<NewPatientFields>({ name: "", rut: "", birthDate: "", phone: "", email: "" });
  const [creating, setCreating] = useState(false);
  const autoPending = useRef(false);
  const heard = useRef({ text: "", interim: "" });
  const stopFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correction = useTextCorrection();
  const [commandDismissed, setCommandDismissed] = useState(false);
  // «Incorporar a la ficha» pedido desde Inicio: al elegir la ficha se abre directo el resumen para confirmar.
  const [incorporateAsked, setIncorporateAsked] = useState(false);
  const decisionRef = useRef<HTMLElement | null>(null);
  const command = useMemo(() => listening || commandDismissed ? null : parseVoiceCommand(transcript, chileTodayIso()), [transcript, listening, commandDismissed]);

  useEffect(() => () => engine.current.abort(), []);

  const identify = async (text: string) => {
    setIdentifying(true);
    setError("");
    setDecision(null);
    try {
      const response = await fetch("/api/dictation/identify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text }) });
      const data = await response.json() as PatientDecision & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo identificar al paciente.");
      setDecision(data);
      setChoice(data.suggestedPatientId ? String(data.suggestedPatientId) : data.decision === "new" || data.identity.newPatientHint ? "new" : "");
      setFields({ name: data.identity.name ?? "", rut: data.identity.rut ?? "", birthDate: data.identity.birthDate ?? "", phone: data.identity.phone ?? "", email: data.identity.email ?? "" });
    } catch (cause) {
      setError(`${cause instanceof Error && !/failed to fetch|load failed|network/i.test(cause.message) ? cause.message : "Sin conexión con el servidor"}. Nada se guardó.`);
    } finally {
      setIdentifying(false);
    }
  };

  const afterDictation = () => {
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    if (!autoPending.current) return;
    autoPending.current = false;
    const text = [heard.current.text, heard.current.interim].filter(Boolean).join(" ").trim();
    if (text.length < 3) return;
    setTranscript(text);
    void identify(text);
  };

  const start = async () => {
    setSpeechError("");
    setDecision(null);
    setError("");
    if (!engine.current.isSupported()) { setSpeechError(engine.current.unsupportedMessage()); return; }
    if (!(await micAllowed())) { setSpeechError(MIC_DENIED); return; }
    setListening(true);
    autoPending.current = true;
    heard.current = { text: transcript, interim: "" };
    engine.current.start(transcript, {
      onTranscript: (text, spoken) => { heard.current = { text, interim: spoken }; setTranscript(text); setInterim(spoken); },
      onError: (message) => { setSpeechError(message); setListening(false); setInterim(""); },
      onEnd: () => { setListening(false); setInterim(""); afterDictation(); },
    });
  };

  const stop = () => {
    engine.current.stop();
    setListening(false);
    setInterim("");
    if (autoPending.current && !stopFallback.current) stopFallback.current = setTimeout(() => { stopFallback.current = null; afterDictation(); }, 1500);
  };

  const quietStop = () => {
    autoPending.current = false;
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    engine.current.stop();
    setListening(false);
    setInterim("");
  };

  const close = () => {
    quietStop();
    engine.current.abort();
    setOpen(false);
    setDecision(null);
    setError("");
    setSpeechError("");
    setTranscript("");
    setChoice("");
    setOtherSearch("");
    setCommandDismissed(false);
    setIncorporateAsked(false);
    correction.reset();
  };

  const finalText = () => transcript.trim();

  const continueWith = (patientId: number, incorporate = incorporateAsked) => {
    const text = finalText();
    const ignoreCommand = commandDismissed;
    close();
    const options = { ...(ignoreCommand ? { ignoreCommand } : {}), ...(incorporate ? { incorporate } : {}) };
    onUsePatient(patientId, text, Object.keys(options).length ? options : undefined);
  };

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const id = await onCreatePatient(fields);
      continueWith(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el paciente.");
    } finally {
      setCreating(false);
    }
  };

  const candidates = decision?.candidates ?? [];
  const others = otherSearch.trim().length >= 2
    ? patients.filter((item) => !candidates.some((c) => c.id === item.id) && `${item.name} ${item.rut ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(otherSearch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim())).slice(0, 6)
    : [];
  const chosenId = choice && choice !== "new" ? Number(choice) : null;
  const chosenName = chosenId ? (candidates.find((c) => c.id === chosenId)?.name ?? patients.find((p) => p.id === chosenId)?.name ?? "") : "";
  const canCreate = fourNames(fields.name) && /^\d{4}-\d{2}-\d{2}$/.test(fields.birthDate);

  /** Lleva el texto a la ficha elegida y abre ahí el resumen «Se incorporará a la ficha». */
  const incorporate = () => {
    setIncorporateAsked(true);
    if (chosenId && decision) { continueWith(chosenId, true); return; }
    if (!decision && !identifying) void identify(finalText());
    setTimeout(() => decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} data-testid="global-dictation-open" className="flex w-full items-center gap-4 rounded-2xl bg-[#087f83] p-4 text-left text-white shadow-sm transition hover:bg-[#07676b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087f83] sm:p-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15"><Mic className="size-6" aria-hidden="true" /></span>
      <span className="min-w-0"><strong className="block text-lg">Dictar</strong><span className="block text-sm text-white/85">Dicta la atención de cualquier paciente, nuevo o con ficha. La app elige la ficha y la IA ordena la nota; tú confirmas.</span></span>
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogContent className="max-h-[92vh] supports-[height:1dvh]:max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain [&>*]:min-w-0 bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dictar atención</DialogTitle>
          <DialogDescription>Di el nombre o RUT del paciente (o «paciente nuevo, …») y luego todo lo de la atención. Nada se guarda sin tu confirmación.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" className={`min-h-12 flex-1 sm:flex-none ${listening ? "bg-[#a43542] hover:bg-[#8a2c37]" : "bg-[#087f83] hover:bg-[#07676b]"}`} onClick={listening ? stop : () => void start()} aria-pressed={listening} data-testid="global-dictation-mic">
              {listening ? <MicOff className="mr-2 size-5" /> : <Mic className="mr-2 size-5" />}{listening ? "Detener" : transcript ? "Seguir dictando" : "Empezar a dictar"}
            </Button>
            {!listening && transcript.trim().length >= 3 && !identifying && <Button type="button" size="lg" variant="outline" className="min-h-12" onClick={() => void identify(finalText())} data-testid="global-dictation-identify">{decision ? "Volver a buscar la ficha" : "Buscar la ficha"}</Button>}
            {!listening && transcript.trim().length >= 3 && <Button type="button" size="lg" variant="outline" className="min-h-12" disabled={correction.correcting} onClick={() => void correction.correct(finalText())} data-testid="global-dictation-correct"><Sparkles className="mr-2 size-5" aria-hidden="true" />{correction.correcting ? "Corrigiendo…" : "Corregir texto"}</Button>}
          </div>
          {listening && <p role="status" className="font-medium text-[#087f83]">Escuchando en español de Chile… Al detener se busca la ficha y la IA corrige el texto.</p>}
          {speechError && <p role="alert" className="text-[#a43542]">{speechError}</p>}
          <label className="block space-y-1.5 font-medium">Transcripción original, sin corregir (en vivo, editable)
            <Textarea data-testid="global-dictation-transcript" lang="es-CL" rows={5} className="min-h-32 field-sizing-fixed text-base sm:text-sm" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} value={interim ? `${transcript} ${interim}`.trim() : transcript} onChange={(event) => { if (listening) quietStop(); setTranscript(event.target.value); setInterim(""); setDecision(null); setCommandDismissed(false); }} placeholder="Ej.: «Tengo un paciente nuevo, Juan Pérez, RUT 12.345.678-5. Viene por dolor en la 3.6, pieza fracturada. Presupuesto corona 450.000, abona 100.000.»" />
          </label>
          {correction.correcting && <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 font-medium text-sky-950"><span className="size-4 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />Corrigiendo el texto con el diccionario clínico e IA…</p>}
          {transcript.trim().length >= 3 && <p className="text-xs leading-5 text-[#60757a]">Al corregir, se envía la transcripción a OpenAI si está configurada la clave; si no, a Workers AI cuando está habilitado. No se guarda hasta que la revises.</p>}
          {correction.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950">{correction.error}</p>}
          {correction.result && !correction.correcting && <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3" data-testid="global-dictation-corrected">
            <h3 className="font-semibold">Texto corregido</h3>
            {correction.result.provider && <p className="text-xs text-[#60757a]">Proveedor: {correction.result.provider === "openai" ? "API de OpenAI" : correction.result.provider === "workers-ai" ? "Cloudflare Workers AI" : "diccionario local"}.</p>}
            {correction.result.openAiNotConfigured && <p className="text-xs text-amber-900">La clave de OpenAI aún no está configurada en Cloudflare.</p>}
            {correction.result.aiError && <p className="text-xs text-amber-900">La IA no respondió ({correction.result.aiError}); se corrigió solo con el diccionario clínico.</p>}
            {correction.result.source !== finalText() && <p className="text-xs text-amber-900">El dictado cambió después de corregir: vuelve a tocar «Corregir texto».</p>}
            <WordDiffView before={correction.result.source} after={correction.result.text} testId="global-dictation-diff" />
            <p className="text-xs leading-5 text-[#60757a]">Es una vista previa: al seguir con la ficha la IA vuelve a corregir y arma la nota para que la revises. Nada se guardó.</p>
            <Button type="button" size="lg" className="h-auto min-h-12 w-full whitespace-normal bg-[#087f83] text-base hover:bg-[#07676b]" disabled={listening || identifying || finalText().length < 3} onClick={incorporate} data-testid="global-dictation-incorporate">{chosenId && decision ? `Incorporar a la ficha de ${chosenName.split(" ").slice(0, 3).join(" ")}` : "Incorporar a la ficha"}</Button>
            {incorporateAsked && !chosenId && <p className="text-xs font-medium text-[#145b60]" role="status">{decision ? "Elige la ficha abajo y toca «Incorporar»." : "Buscando la ficha…"}</p>}
          </section>}
          {IOS_DICTATION_HINT && !transcript && <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950" role="note">{IOS_DICTATION_HINT}</p>}
          {identifying && <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 font-medium text-sky-950" data-testid="global-dictation-identifying"><span className="size-4 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />Buscando la ficha por RUT y nombre…</p>}
          {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950" data-testid="global-dictation-error"><p>{error}</p>{!decision && transcript.trim().length >= 3 && <Button type="button" size="sm" variant="outline" className="mt-2 bg-white" onClick={() => void identify(finalText())}>Reintentar</Button>}</div>}
          {decision && <section ref={decisionRef} className="scroll-mt-4 space-y-3 rounded-xl border border-[#cfe3e1] bg-[#f5faf9] p-3 sm:p-4" data-testid="global-dictation-decision" data-decision={decision.decision}>
            <h3 className="text-base font-semibold text-[#145b60]">¿De quién es este dictado?</h3>
            <p className="leading-6 text-[#31575b]">{decision.explanation}</p>
            {(decision.identity.name || decision.identity.rut) && <p className="text-xs text-[#60757a]">Se entendió: {[decision.identity.name && `nombre «${decision.identity.name}»`, decision.identity.rut && `RUT ${decision.identity.rut}${decision.identity.rutValid ? "" : " (dígito verificador no válido)"}`].filter(Boolean).join(" · ")}</p>}
            <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">Elige la ficha</legend>
              {candidates.map((item) => <label key={item.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 ${choice === String(item.id) ? "border-[#087f83] ring-2 ring-[#087f83]/30" : "border-[#dbe7e8]"}`}>
                <input type="radio" name="global-dictation-patient" className="size-5 shrink-0 accent-[#087f83]" checked={choice === String(item.id)} onChange={() => setChoice(String(item.id))} />
                <UserRound className="size-5 shrink-0 text-[#087f83]" aria-hidden="true" />
                <span className="min-w-0"><strong className="block break-words">{item.name}</strong><span className="block text-xs text-[#60757a]">{item.rut ? `RUT ${item.rut} · ` : ""}{item.reason}</span></span>
              </label>)}
              {chosenId && !candidates.some((c) => c.id === chosenId) && <p className="rounded-lg border border-[#087f83] bg-white p-3"><strong>{chosenName}</strong> <span className="text-xs text-[#60757a]">(elegida de la búsqueda)</span></p>}
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 ${choice === "new" ? "border-[#087f83] ring-2 ring-[#087f83]/30" : "border-[#dbe7e8]"}`}>
                <input type="radio" name="global-dictation-patient" className="size-5 shrink-0 accent-[#087f83]" checked={choice === "new"} onChange={() => setChoice("new")} data-testid="global-dictation-choose-new" />
                <UserPlus className="size-5 shrink-0 text-[#087f83]" aria-hidden="true" />
                <span><strong>Crear paciente nuevo</strong>{decision.identity.name ? <span className="block text-xs text-[#60757a]">con los datos dictados</span> : null}</span>
              </label>
            </fieldset>
            <label className="block space-y-1 text-xs font-medium text-[#31575b]">¿Es otra ficha? Busca por nombre o RUT
              <Input className="bg-white text-base sm:text-sm" value={otherSearch} onChange={(event) => setOtherSearch(event.target.value)} placeholder="Nombre o RUT" data-testid="global-dictation-search" />
            </label>
            {others.length > 0 && <ul className="space-y-1">{others.map((item) => <li key={item.id}><button type="button" className="min-h-11 w-full rounded-lg border border-[#dbe7e8] bg-white px-3 py-2 text-left hover:border-[#087f83]" onClick={() => { setChoice(String(item.id)); setOtherSearch(""); }}>{item.name}{item.rut ? <span className="text-xs text-[#60757a]"> · RUT {item.rut}</span> : null}</button></li>)}</ul>}
            {choice === "new" && <div className="space-y-2 rounded-lg border border-[#dbe7e8] bg-white p-3" data-testid="global-dictation-new-patient">
              <p className="text-xs leading-5 text-[#60757a]">Para crear la ficha la app pide los dos nombres y los dos apellidos y la fecha de nacimiento. Lo demás es opcional y se puede completar después.</p>
              <label className="block space-y-1 font-medium">Nombre completo *<Input className="text-base sm:text-sm" value={fields.name} onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))} autoCapitalize="words" data-testid="global-dictation-new-name" /></label>
              {fields.name.trim() && !fourNames(fields.name) && <p className="text-xs text-amber-900">Faltan nombres o apellidos (se dictó «{fields.name.trim()}»).</p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block space-y-1 font-medium">Fecha de nacimiento *<Input type="date" className="text-base sm:text-sm" value={fields.birthDate} onChange={(event) => setFields((current) => ({ ...current, birthDate: event.target.value }))} data-testid="global-dictation-new-birth" /></label>
                <label className="block space-y-1 font-medium">RUT<Input className="text-base sm:text-sm" inputMode="text" value={fields.rut} onChange={(event) => setFields((current) => ({ ...current, rut: event.target.value }))} /></label>
                <label className="block space-y-1 font-medium">Teléfono<Input className="text-base sm:text-sm" inputMode="tel" value={fields.phone} onChange={(event) => setFields((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label className="block space-y-1 font-medium">Correo<Input className="text-base sm:text-sm" inputMode="email" value={fields.email} onChange={(event) => setFields((current) => ({ ...current, email: event.target.value }))} /></label>
              </div>
            </div>}
            {command && chosenId && onAnnul && <VoiceCommandCard key={`${chosenId}-${command.evidence}`} command={command} patientName={chosenName} notes={notes.filter((note) => note.patientId === chosenId)} onConfirm={(evolutionId, mode, reason, replacement) => onAnnul(chosenId, evolutionId, mode, reason, replacement)} onDismiss={() => setCommandDismissed(true)} />}
            {choice === "new"
              ? <Button type="button" size="lg" className="min-h-12 w-full bg-[#087f83] hover:bg-[#07676b]" disabled={!canCreate || creating} onClick={() => void create()} data-testid="global-dictation-create">{creating ? "Creando ficha…" : incorporateAsked ? "Crear paciente e incorporar el dictado" : "Crear paciente y revisar el dictado"}</Button>
              : <Button type="button" size="lg" variant={command && chosenId && onAnnul ? "outline" : "default"} className={command && chosenId && onAnnul ? "h-auto min-h-12 w-full whitespace-normal bg-white" : "h-auto min-h-12 w-full whitespace-normal bg-[#087f83] hover:bg-[#07676b]"} disabled={!chosenId} onClick={() => chosenId && continueWith(chosenId)} data-testid="global-dictation-continue">{chosenId ? `${command && onAnnul ? "Solo abrir la ficha de" : incorporateAsked ? "Incorporar a la ficha de" : "Seguir con"} ${chosenName.split(" ").slice(0, 3).join(" ")}` : "Elige una ficha"}</Button>}
            <p className="text-xs leading-5 text-[#60757a]">Luego se abre la ficha: la IA corrige el texto, arma la nota por secciones y propone odontograma, citas, presupuesto y pagos. Revisas y aceptas cada cambio.</p>
          </section>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
