"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Sparkles, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAudioTranscription, AUDIO_DICTATION_NOTICE } from "@/lib/dictation/audio-transcription";
import { validRut } from "@/lib/dictation/patient-check";
import type { DictatedIdentity, PatientDecision } from "@/lib/dictation/patient-identify";
import { hasFourNameParts } from "@/app/patient-identity";
import { WordDiffView, useTextCorrection } from "@/components/text-correction";
import { VoiceCommandCard, type AnnulReplacement, type RemovalMode } from "@/components/evolution-annul";
import { chileTodayIso, parseVoiceCommand, type CommandNote } from "@/lib/dictation/voice-command";

const fourNames = (value: string): boolean => hasFourNameParts(value);

type PatientOption = { id: number; name: string; rut?: string | null; birthDate?: string | null; phone?: string | null; email?: string | null };
export type NewPatientFields = { name: string; rut: string; birthDate: string; phone: string; email: string };


/**
 * Dictado desde Inicio: escucha, decide en el servidor (sin IA) a qué ficha va —o propone crear una—,
 * pide confirmar con un toque y entrega el texto a la ficha, donde la IA lo corrige y se revisa todo.
 */
export function GlobalDictation({ patients, notes = [], onUsePatient, onCreatePatient, onAnnul }: {
  patients: PatientOption[];
  /** Evoluciones (con su paciente) para proponer qué anular cuando se dicta una orden. */
  notes?: (CommandNote & { patientId: number })[];
  onUsePatient: (patientId: number, transcript: string, options?: { ignoreCommand?: boolean; incorporate?: boolean; identity?: DictatedIdentity }) => void | Promise<void>;
  onCreatePatient: (fields: NewPatientFields) => Promise<number>;
  onAnnul?: (patientId: number, evolutionId: number, mode: RemovalMode, reason: string, replacement: AnnulReplacement | null) => Promise<void>;
}) {
  const engine = useRef(createAudioTranscription());
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioRetry, setAudioRetry] = useState<"main" | "answer" | null>(null);
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
    void correction.correct(text);
  };

  const start = async () => {
    setSpeechError("");
    setDecision(null);
    setError("");
    if (!engine.current.isSupported()) { setSpeechError(engine.current.unsupportedMessage()); return; }

    setListening(true);
    autoPending.current = true;
    heard.current = { text: transcript, interim: "" };
    engine.current.start(transcript, {
      onStatus: (status) => { setTranscribing(status === "transcribing"); setListening(status === "starting" || status === "recording"); if (status !== "error") setAudioRetry(null); },
      onTranscript: (text, spoken) => { heard.current = { text, interim: spoken }; setTranscript(text); setInterim(spoken); },
      onError: (message) => { setSpeechError(message); setAudioRetry(engine.current.hasPendingAudio?.() ? "main" : null); setListening(false); setInterim(""); },
      onEnd: () => { setListening(false); setInterim(""); afterDictation(); },
    });
  };

  const stop = () => {
    setTranscribing(true);
    setListening(false);
    engine.current.stop();
  };

  const quietStop = () => {
    autoPending.current = false;
    if (stopFallback.current) { clearTimeout(stopFallback.current); stopFallback.current = null; }
    engine.current.abort();
    setTranscribing(false);
    setAudioRetry(null);
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

  const continueWith = async (patientId: number, incorporate = incorporateAsked, carryIdentity = true) => {
    const text = finalText();
    const ignoreCommand = commandDismissed;
    const identity = carryIdentity && !command ? decision?.identity : undefined;
    const options = {
      ...(ignoreCommand ? { ignoreCommand } : {}),
      ...(incorporate ? { incorporate: true } : {}),
      ...(identity ? { identity } : {}),
    };
    setError("");
    try {
      await onUsePatient(patientId, text, Object.keys(options).length ? options : undefined);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la ficha.");
    }
  };

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const id = await onCreatePatient(fields);
      await continueWith(id, incorporateAsked, false);
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
  const chosenPatient = chosenId ? patients.find((p) => p.id === chosenId) : undefined;
  const validPhoneValue = (value: string) => !value || (/^[+\d()\s.-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 8);
  const validEmailValue = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const validBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(fields.birthDate);
  const canCreate = fourNames(fields.name) && validBirthDate
    && (!fields.rut.trim() || validRut(fields.rut))
    && validPhoneValue(fields.phone.trim())
    && validEmailValue(fields.email.trim());
  const missingRequired = [
    ...(!fourNames(fields.name) ? ["nombre completo (nombre y dos apellidos)"] : []),
    ...(!validBirthDate ? ["fecha de nacimiento"] : []),
  ];
  const missingOptional = [
    ...(!fields.rut.trim() ? ["RUT"] : []),
    ...(!fields.phone.trim() ? ["teléfono"] : []),
    ...(!fields.email.trim() ? ["correo"] : []),
  ];
  const identity = decision?.identity;
  const profileRows = chosenPatient && identity ? [
    { label: "RUT", proposed: identity.rut ?? "", current: chosenPatient.rut ?? "", valid: !identity.rut || identity.rutValid, normalize: (value: string) => value.replace(/[^0-9kK]/g, "").toUpperCase() },
    { label: "Fecha de nacimiento", proposed: identity.birthDate ?? "", current: chosenPatient.birthDate ?? "", valid: true, normalize: (value: string) => value },
    { label: "Teléfono", proposed: identity.phone ?? "", current: chosenPatient.phone ?? "", valid: validPhoneValue(identity.phone ?? ""), normalize: (value: string) => value.replace(/\D/g, "") },
    { label: "Correo", proposed: identity.email ?? "", current: chosenPatient.email ?? "", valid: validEmailValue(identity.email ?? ""), normalize: (value: string) => value.trim().toLowerCase() },
  ] : [];

  /** Lleva el texto a la ficha elegida y abre ahí el resumen «Se incorporará a la ficha». */
  const incorporate = () => {
    setIncorporateAsked(true);
    if (chosenId && decision) { continueWith(chosenId, true); return; }
    if (!decision && !identifying) void identify(finalText());
    setTimeout(() => decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} data-testid="global-dictation-open" className="flex w-full items-center gap-4 rounded-xl bg-[#473a6d] p-4 text-left text-white shadow-sm transition hover:bg-[#3a2f5a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#473a6d] sm:p-5">
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
            <Button type="button" size="lg" className={`min-h-12 flex-1 sm:flex-none ${listening ? "bg-[#a43542] hover:bg-[#8a2c37]" : "bg-[#473a6d] hover:bg-[#3a2f5a]"}`} disabled={transcribing} onClick={listening ? stop : () => void start()} aria-pressed={listening} data-testid="global-dictation-mic">
              {listening ? <MicOff className="mr-2 size-5" /> : <Mic className="mr-2 size-5" />}{listening ? "Detener" : transcript ? "Seguir dictando" : "Empezar a dictar"}
            </Button>
            {!listening && !transcribing && transcript.trim().length >= 3 && !identifying && <Button type="button" size="lg" variant="outline" className="min-h-12" onClick={() => void identify(finalText())} data-testid="global-dictation-identify">{decision ? "Volver a buscar la ficha" : "Buscar la ficha"}</Button>}
            {!listening && !transcribing && transcript.trim().length >= 3 && <Button type="button" size="lg" variant="outline" className="min-h-12" disabled={transcribing || correction.correcting} onClick={() => void correction.correct(finalText())} data-testid="global-dictation-correct"><Sparkles className="mr-2 size-5" aria-hidden="true" />{correction.correcting ? "Redactando…" : "Corregir y redactar"}</Button>}
          </div>
          {listening && <p role="status" className="font-medium text-[#473a6d]">Escuchando en español de Chile… Al detener se busca la ficha y la IA corrige el texto.</p>}
          <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950" role="note">{AUDIO_DICTATION_NOTICE}</p>
          {transcribing && <p role="status" aria-live="polite" className="rounded-lg bg-sky-50 p-3 font-medium text-sky-950">Transcribiendo el audio con OpenAI… Espera que aparezca el texto antes de corregirlo.</p>}
          {audioRetry && <Button type="button" variant="outline" disabled={transcribing} onClick={() => { setSpeechError(""); engine.current.retry?.(); }}>Reintentar la transcripción del audio</Button>}
          {speechError && <p role="alert" className="text-[#a43542]">{speechError}</p>}
          <label className="block space-y-1.5 font-medium">Transcripción del audio, sin corregir (editable)
            <Textarea data-testid="global-dictation-transcript" lang="es-CL" rows={5} className="min-h-32 field-sizing-fixed text-base sm:text-sm" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} value={interim ? `${transcript} ${interim}`.trim() : transcript} onChange={(event) => { if (listening || transcribing) quietStop(); setTranscript(event.target.value); setInterim(""); setDecision(null); setCommandDismissed(false); }} placeholder="Ej.: «Tengo un paciente nuevo, Juan Pérez, RUT 12.345.678-5. Viene por dolor en la 3.6, pieza fracturada. Presupuesto corona 450.000, abona 100.000.»" />
          </label>
          {correction.correcting && <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 font-medium text-sky-950"><span className="size-4 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />Corrigiendo el dictado y redactando una nota clínica para revisar…</p>}
          {transcript.trim().length >= 3 && <p className="text-xs leading-5 text-[#615f73]">Al corregir, se envía la transcripción a OpenAI si está configurada la clave; si no, a Workers AI cuando está habilitado. No se guarda hasta que la revises.</p>}
          {correction.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950">{correction.error}</p>}
          {correction.result && !correction.correcting && <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3" data-testid="global-dictation-corrected">
            <h3 className="font-semibold">Transcripción corregida</h3>
            {correction.result.provider && <p className="text-xs text-[#615f73]">Proveedor: {correction.result.provider === "openai" ? "API de OpenAI" : correction.result.provider === "workers-ai" ? "Cloudflare Workers AI" : "diccionario local"}.</p>}
            {correction.result.openAiNotConfigured && <p className="text-xs text-amber-900">La clave de OpenAI aún no está configurada en Cloudflare.</p>}
            {correction.result.aiError && <p className="text-xs text-amber-900">La IA no respondió ({correction.result.aiError}); se corrigió solo con el diccionario clínico.</p>}
            {correction.result.source !== finalText() && <p className="text-xs text-amber-900">El dictado cambió después de corregir: vuelve a tocar «Corregir texto».</p>}
            <WordDiffView before={correction.result.source} after={correction.result.text} testId="global-dictation-diff" />
            {correction.result.redraftedNote && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="global-dictation-redrafted"><h4 className="font-semibold">Nota clínica redactada</h4><p className="mt-1 text-xs text-[#3b3355]">La IA organiza lo dictado en lenguaje clínico. Revísala en la ficha antes de guardar; la transcripción original sigue separada.</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{correction.result.redraftedNote}</p></div>}
            <p className="text-xs leading-5 text-[#615f73]">Esta redacción es una vista previa. Al seguir con la ficha se prepara de nuevo con el contexto clínico y puedes editarla antes de confirmar. Nada se guardó.</p>
            <Button type="button" size="lg" className="h-auto min-h-12 w-full whitespace-normal bg-[#473a6d] text-base hover:bg-[#3a2f5a]" disabled={transcribing || listening || identifying || finalText().length < 3} onClick={incorporate} data-testid="global-dictation-incorporate">{chosenId && decision ? `Incorporar a la ficha de ${chosenName.split(" ").slice(0, 3).join(" ")}` : "Incorporar a la ficha"}</Button>
            {incorporateAsked && !chosenId && <p className="text-xs font-medium text-[#473a6d]" role="status">{decision ? "Elige la ficha abajo y toca «Incorporar»." : "Buscando la ficha…"}</p>}
          </section>}
          {identifying && <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 font-medium text-sky-950" data-testid="global-dictation-identifying"><span className="size-4 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />Buscando la ficha por RUT y nombre…</p>}
          {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-950" data-testid="global-dictation-error"><p>{error}</p>{!decision && transcript.trim().length >= 3 && <Button type="button" size="sm" variant="outline" className="mt-2 bg-white" onClick={() => void identify(finalText())}>Reintentar</Button>}</div>}
          {decision && <section ref={decisionRef} className="scroll-mt-4 space-y-3 rounded-xl border border-[#ddd9e6] bg-[#f7f6fa] p-3 sm:p-4" data-testid="global-dictation-decision" data-decision={decision.decision}>
            <h3 className="text-base font-semibold text-[#473a6d]">¿De quién es este dictado?</h3>
            <p className="leading-6 text-[#3b3355]">{decision.explanation}</p>
            {(decision.identity.name || decision.identity.rut) && <p className="text-xs text-[#615f73]">Se entendió: {[decision.identity.name && `nombre «${decision.identity.name}»`, decision.identity.rut && `RUT ${decision.identity.rut}${decision.identity.rutValid ? "" : " (dígito verificador no válido)"}`].filter(Boolean).join(" · ")}</p>}
            <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">Elige la ficha</legend>
              {candidates.map((item) => <label key={item.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 ${choice === String(item.id) ? "border-[#473a6d] ring-2 ring-[#473a6d]/30" : "border-[#dddbe6]"}`}>
                <input type="radio" name="global-dictation-patient" className="size-5 shrink-0 accent-[#473a6d]" checked={choice === String(item.id)} onChange={() => setChoice(String(item.id))} />
                <UserRound className="size-5 shrink-0 text-[#473a6d]" aria-hidden="true" />
                <span className="min-w-0"><strong className="block break-words">{item.name}</strong><span className="block text-xs text-[#615f73]">{item.rut ? `RUT ${item.rut} · ` : ""}{item.reason}</span></span>
              </label>)}
              {chosenId && !candidates.some((c) => c.id === chosenId) && <p className="rounded-lg border border-[#473a6d] bg-white p-3"><strong>{chosenName}</strong> <span className="text-xs text-[#615f73]">(elegida de la búsqueda)</span></p>}
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 ${choice === "new" ? "border-[#473a6d] ring-2 ring-[#473a6d]/30" : "border-[#dddbe6]"}`}>
                <input type="radio" name="global-dictation-patient" className="size-5 shrink-0 accent-[#473a6d]" checked={choice === "new"} onChange={() => setChoice("new")} data-testid="global-dictation-choose-new" />
                <UserPlus className="size-5 shrink-0 text-[#473a6d]" aria-hidden="true" />
                <span><strong>Crear paciente nuevo</strong>{decision.identity.name ? <span className="block text-xs text-[#615f73]">con los datos dictados</span> : null}</span>
              </label>
            </fieldset>
            <label className="block space-y-1 text-xs font-medium text-[#3b3355]">¿Es otra ficha? Busca por nombre o RUT
              <Input className="bg-white text-base sm:text-sm" value={otherSearch} onChange={(event) => setOtherSearch(event.target.value)} placeholder="Nombre o RUT" data-testid="global-dictation-search" />
            </label>
            {others.length > 0 && <ul className="space-y-1">{others.map((item) => <li key={item.id}><button type="button" className="min-h-11 w-full rounded-lg border border-[#dddbe6] bg-white px-3 py-2 text-left hover:border-[#473a6d]" onClick={() => { setChoice(String(item.id)); setOtherSearch(""); }}>{item.name}{item.rut ? <span className="text-xs text-[#615f73]"> · RUT {item.rut}</span> : null}</button></li>)}</ul>}
            {choice !== "new" && chosenId && chosenPatient && identity && <section className="space-y-2 rounded-lg border border-[#dddbe6] bg-white p-3" aria-label="Datos identificados automáticamente">
              <p className="text-sm font-semibold text-[#35343f]">Datos detectados para esta ficha</p>
              <p className="text-xs leading-5 text-[#615f73]">Al continuar, se completarán automáticamente los campos vacíos. Los datos existentes se conservan; las diferencias quedan marcadas en rojo.</p>
              <ul className="space-y-1 text-xs">
                {profileRows.map((row) => {
                  const same = Boolean(row.proposed && row.current && row.normalize(row.proposed) === row.normalize(row.current));
                  const missing = !row.current && !row.proposed;
                  const conflict = Boolean(row.current && row.proposed && !same);
                  const problem = !row.valid || conflict || missing;
                  return <li key={row.label} className={problem ? "rounded-md bg-rose-50 px-2 py-1.5 text-rose-800" : "rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-800"}>
                    <strong>{row.label}:</strong> {!row.valid ? "revisar dato dictado" : conflict ? "el dato existente no coincide; no se sobrescribirá" : missing ? "falta en la ficha y no se dictó" : same ? "coincide con la ficha" : row.proposed ? "se completará automáticamente" : "ya registrado"}
                    {row.proposed && <span> · Dictado: {row.proposed}</span>}
                  </li>;
                })}
              </ul>
            </section>}
            {choice === "new" && <div className="space-y-2 rounded-lg border border-[#dddbe6] bg-white p-3" data-testid="global-dictation-new-patient">
              <p className="text-xs leading-5 text-[#615f73]">Para crear la ficha la app pide el nombre y los dos apellidos (el segundo nombre es opcional) y la fecha de nacimiento. Lo demás es opcional y se puede completar después.</p>
              <p className="text-xs leading-5 text-[#615f73]">El dictado ya se distribuyó en los campos detectados. Los datos marcados en rojo quedan pendientes; el RUT, teléfono y correo se pueden completar después.</p>
              <label className="block space-y-1 font-medium">Nombre completo *
                <Input aria-invalid={!fourNames(fields.name)} className={fourNames(fields.name) ? "text-base sm:text-sm" : "border-rose-400 text-base text-rose-900 ring-1 ring-rose-300 sm:text-sm"} value={fields.name} onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))} autoCapitalize="words" data-testid="global-dictation-new-name" />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block space-y-1 font-medium">Fecha de nacimiento *
                  <Input type="date" aria-invalid={!validBirthDate} className={validBirthDate ? "text-base sm:text-sm" : "border-rose-400 text-base text-rose-900 ring-1 ring-rose-300 sm:text-sm"} value={fields.birthDate} onChange={(event) => setFields((current) => ({ ...current, birthDate: event.target.value }))} data-testid="global-dictation-new-birth" />
                </label>
                <label className="block space-y-1 font-medium">RUT
                  <Input aria-invalid={Boolean(fields.rut.trim() && !validRut(fields.rut)) || !fields.rut.trim()} className={fields.rut.trim() && validRut(fields.rut) ? "text-base sm:text-sm" : "border-rose-300 text-base text-rose-900 sm:text-sm"} inputMode="text" value={fields.rut} onChange={(event) => setFields((current) => ({ ...current, rut: event.target.value }))} />
                </label>
                <label className="block space-y-1 font-medium">Teléfono
                  <Input aria-invalid={!fields.phone.trim() || !validPhoneValue(fields.phone.trim())} className={fields.phone.trim() && validPhoneValue(fields.phone.trim()) ? "text-base sm:text-sm" : "border-rose-300 text-base text-rose-900 sm:text-sm"} inputMode="tel" value={fields.phone} onChange={(event) => setFields((current) => ({ ...current, phone: event.target.value }))} />
                </label>
                <label className="block space-y-1 font-medium">Correo
                  <Input aria-invalid={!fields.email.trim() || !validEmailValue(fields.email.trim())} className={fields.email.trim() && validEmailValue(fields.email.trim()) ? "text-base sm:text-sm" : "border-rose-300 text-base text-rose-900 sm:text-sm"} inputMode="email" value={fields.email} onChange={(event) => setFields((current) => ({ ...current, email: event.target.value }))} />
                </label>
              </div>
              {(missingRequired.length > 0 || missingOptional.length > 0 || (fields.rut.trim() && !validRut(fields.rut)) || (fields.phone.trim() && !validPhoneValue(fields.phone.trim())) || (fields.email.trim() && !validEmailValue(fields.email.trim()))) && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                Pendiente en rojo: {[...missingRequired, ...missingOptional.filter((field) => !fields[field === "RUT" ? "rut" : field === "teléfono" ? "phone" : "email"].trim())].join(", ")}
                {(fields.rut.trim() && !validRut(fields.rut)) || (fields.phone.trim() && !validPhoneValue(fields.phone.trim())) || (fields.email.trim() && !validEmailValue(fields.email.trim())) ? " Hay un dato dictado con formato inválido; corrígelo antes de continuar." : ""}
                {missingRequired.length > 0 ? " Completa nombre y fecha para crear la ficha; el dictado clínico no se pierde." : ""}
              </p>}
            </div>}
            {command && chosenId && onAnnul && <VoiceCommandCard key={`${chosenId}-${command.evidence}`} command={command} patientName={chosenName} notes={notes.filter((note) => note.patientId === chosenId)} onConfirm={(evolutionId, mode, reason, replacement) => onAnnul(chosenId, evolutionId, mode, reason, replacement)} onDismiss={() => setCommandDismissed(true)} />}
            {choice === "new"
              ? <Button type="button" size="lg" className="min-h-12 w-full bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={!canCreate || creating} onClick={() => void create()} data-testid="global-dictation-create">{creating ? "Creando ficha…" : incorporateAsked ? "Crear paciente e incorporar el dictado" : "Crear paciente y revisar el dictado"}</Button>
              : <Button type="button" size="lg" variant={command && chosenId && onAnnul ? "outline" : "default"} className={command && chosenId && onAnnul ? "h-auto min-h-12 w-full whitespace-normal bg-white" : "h-auto min-h-12 w-full whitespace-normal bg-[#473a6d] hover:bg-[#3a2f5a]"} disabled={!chosenId} onClick={() => { if (chosenId) void continueWith(chosenId); }} data-testid="global-dictation-continue">{chosenId ? `${command && onAnnul ? "Solo abrir la ficha de" : incorporateAsked ? "Incorporar a la ficha de" : "Seguir con"} ${chosenName.split(" ").slice(0, 3).join(" ")}` : "Elige una ficha"}</Button>}
            <p className="text-xs leading-5 text-[#615f73]">Luego se abre la ficha: la IA corrige el texto, arma la nota por secciones y propone odontograma, citas, presupuesto y pagos. Revisas y aceptas cada cambio.</p>
          </section>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
