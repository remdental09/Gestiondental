"use client";

import { useCallback, useRef, useState } from "react";
import { changedWordCount, wordDiff } from "@/lib/dictation/word-diff";
import type { TranscriptCorrection, StructureOutcome } from "@/lib/dictation/proposal";

/** Muestra lo dictado y lo corregido palabra a palabra: tachado en rojo lo que se quitó, en verde lo nuevo. */
export function WordDiffView({ before, after, testId }: { before: string; after: string; testId?: string }) {
  const segments = wordDiff(before, after);
  const changed = changedWordCount(segments);
  return <div data-testid={testId} className="rounded-lg border border-[#ddd6f0] bg-white p-3">
    <p className="mb-1 text-xs font-medium text-[#3d2f73]">{changed ? `${changed} ${changed === 1 ? "palabra cambiada" : "palabras cambiadas"} · tachado = como se dictó, verde = corregido` : "Sin cambios: el texto se entendió tal como se dictó."}</p>
    <p className="text-base leading-7 sm:text-sm sm:leading-6">{segments.map((segment, index) => <span key={index}>
      {index > 0 && " "}
      {segment.type === "same" ? segment.text
        : segment.type === "removed" ? <del className="rounded bg-rose-100 px-0.5 text-rose-900 decoration-rose-700">{segment.text}</del>
        : <ins className="rounded bg-emerald-100 px-0.5 font-medium text-emerald-950 no-underline">{segment.text}</ins>}
    </span>)}</p>
  </div>;
}

export type TextCorrection = {
  source: string;
  text: string;
  corrections: TranscriptCorrection[];
  provider?: "openai" | "workers-ai" | "dictionary";
  openAiNotConfigured?: boolean;
  aiError?: string;
  redraftedNote?: string;
  draftModel?: string | null;
  draftNotice?: string | null;
};

/** «Corregir texto» a pedido: corrige sin guardar y marca los cambios para revisión. */
export function useTextCorrection() {
  const [correcting, setCorrecting] = useState(false);
  const [result, setResult] = useState<TextCorrection | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const correct = useCallback(async (source: string) => {
    const text = source.trim();
    if (text.length < 3) return null;
    const ticket = ++latest.current;
    setCorrecting(true);
    setError("");
    try {
      const response = await fetch("/api/dictation/structure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text }) });
      const data = await response.json() as StructureOutcome & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo redactar la nota.");
      const corrected = data.proposal?.corrected;
      const next: TextCorrection = {
        source: text,
        text: corrected?.text ?? text,
        corrections: corrected?.corrections ?? [],
        provider: data.model?.startsWith("openai/") ? "openai" : data.engine === "ia+reglas" ? "workers-ai" : "dictionary",
        aiError: data.aiError,
        redraftedNote: data.proposal?.evolution?.body?.trim() ?? "",
        draftModel: data.model,
        draftNotice: data.notice,
      };
      if (ticket === latest.current) setResult(next);
      return next;
    } catch (cause) {
      if (ticket === latest.current) setError(`No se pudo corregir: ${cause instanceof Error && !/failed to fetch|load failed|network/i.test(cause.message) ? cause.message : "sin conexión con el servidor"}.`);
      return null;
    } finally {
      if (ticket === latest.current) setCorrecting(false);
    }
  }, []);
  const reset = useCallback(() => { latest.current++; setResult(null); setError(""); setCorrecting(false); }, []);
  return { correct, correcting, result, error, reset };
}
