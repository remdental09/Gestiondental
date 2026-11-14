"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFdi } from "@/app/clinical-data";
import { createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { describePerioDictation, parsePerioDictation, type PerioDictationResult } from "@/lib/dictation/perio-dictation";

type Phase = "idle" | "starting" | "recording" | "transcribing" | "review";

/**
 * Dictado exclusivo del periodontograma: graba, transcribe y propone las medidas por pieza y sitio.
 * No escribe en la evolución ni guarda nada: el profesional revisa y aplica al examen en curso.
 */
export function PerioDictation({ chileOf, onApply }: { chileOf: (fdi: number) => number; onApply: (result: PerioDictationResult) => void }) {
  const engine = useRef<ReturnType<typeof createAudioTranscription> | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  useEffect(() => () => engine.current?.abort(), []);
  const result = phase === "review" ? parsePerioDictation(text) : null;

  const start = () => {
    engine.current ??= createAudioTranscription();
    setError("");
    if (!engine.current.isSupported()) { setError(engine.current.unsupportedMessage()); setPhase("review"); return; }
    setPhase("starting");
    engine.current.start(phase === "review" ? text : "", {
      onStatus: status => { if (status === "recording") setPhase("recording"); if (status === "transcribing") setPhase("transcribing"); },
      onTranscript: heard => setText(heard),
      onError: message => { setError(message); setPhase("review"); },
      onEnd: () => setPhase("review"),
    });
  };
  const stop = () => { setPhase("transcribing"); engine.current?.stop(); };
  const discard = () => { engine.current?.abort(); setText(""); setError(""); setPhase("idle"); };
  const busy = phase === "starting" || phase === "transcribing";

  return <div className="mb-3 rounded-lg border border-[#d9d4ea] bg-white p-2.5">
    <div className="flex flex-wrap items-center gap-2">
      {phase === "recording"
        ? <Button type="button" onClick={stop} className="bg-rose-700 hover:bg-rose-800"><Square className="size-4" /> Detener y revisar</Button>
        : <Button type="button" onClick={start} disabled={busy} className="bg-[#473a6d] hover:bg-[#3a2f5a]"><Mic className="size-4" /> {phase === "review" ? "Seguir dictando" : "Dictar periodontograma"}</Button>}
      <span role="status" className="text-xs text-[#615f73]">{phase === "starting" ? "Preparando el micrófono…" : phase === "recording" ? "Grabando. Di pieza, cara y los tres números de mesial a distal." : phase === "transcribing" ? "Transcribiendo…" : phase === "idle" ? "Solo llena este examen; no escribe en la evolución." : ""}</span>
      <button type="button" className="ml-auto text-xs font-medium text-[#473a6d] underline" aria-expanded={help} onClick={() => setHelp(value => !value)}>Cómo dictar</button>
    </div>
    {help && <div className="mt-2 space-y-1 rounded-md bg-[#f7f6fa] p-2 text-xs leading-5 text-[#3b3355]">
      <p><strong>Pieza, cara y tres números de mesial a distal:</strong> «uno seis vestibular tres dos cuatro, palatino cinco seis cinco».</p>
      <p><strong>Margen:</strong> «margen cero uno uno», «recesión dos dos uno», «margen menos uno» si la encía cubre la UAC.</p>
      <p><strong>Sangrado y supuración:</strong> «sangrado mesial y distal», «sangrado» solo marca los tres sitios de la cara, «supuración distal».</p>
      <p><strong>Un sitio suelto:</strong> «mesiovestibular siete», «distolingual seis». <strong>Otros:</strong> «movilidad dos», «furca uno».</p>
      <p>«Uno seis» o «1.6» es FDI; «pieza 3» sin más es numeración chilena, como en el resto de la aplicación. El audio se envía a OpenAI solo para transcribirlo.</p>
    </div>}
    {error && <p role="alert" className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
    {phase === "review" && <div className="mt-2 space-y-2">
      <label className="block text-xs font-medium text-[#3b3355]">Lo dictado (puedes corregirlo o escribirlo)
        <textarea value={text} onChange={event => setText(event.target.value)} rows={2} className="mt-1 block w-full rounded-md border border-[#dddbe6] p-2 text-sm" placeholder="uno seis vestibular tres dos cuatro…" />
      </label>
      {result && result.teeth.length > 0 ? <ul className="space-y-1 text-xs text-[#2a2540]">
        {result.teeth.map(item => <li key={item.tooth} className="rounded-md bg-[#f7f6fa] p-2"><strong>Pieza FDI {formatFdi(item.tooth)}</strong> <span className="text-[#615f73]">· chilena {chileOf(item.tooth)}</span>{describePerioDictation(item).map(line => <span key={line} className="block">{line}</span>)}</li>)}
      </ul> : <p className="text-xs text-[#615f73]">{text.trim() ? "No se reconoció ninguna medida. Revisa el texto o mira «Cómo dictar»." : "Aún no hay texto."}</p>}
      {result && result.ignored.length > 0 && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">No se entendió y no se aplicará: {result.ignored.join(", ")}.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!result?.teeth.length} onClick={() => { if (result) { onApply(result); setText(""); setError(""); setPhase("idle"); } }} className="bg-[#473a6d] hover:bg-[#3a2f5a]">Aplicar al examen</Button>
        <Button type="button" variant="outline" onClick={discard}>Descartar</Button>
      </div>
    </div>}
  </div>;
}
