"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyEndoProposal, describeEndoProposal, ENDO_CUE, type EndoProposal } from "@/lib/dictation/endo-dictation";
import { formatFdi } from "@/lib/dictation/proposal";
import { normalizeEndo, type EndoData } from "@/lib/endodontics";

const chileToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Endograma por dictado: la IA propone, el clínico revisa y confirma; se guarda en el endograma y se relee para comprobarlo. */
export function EndoDictationSection({ patientId, text, attentionDate }: { patientId: number; text: string; attentionDate?: string }) {
  const [items, setItems] = useState<Array<EndoProposal & { accepted: boolean }>>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "proponiendo" | "guardando">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const askedFor = useRef("");
  const relevant = ENDO_CUE.test(text);

  // Un dictado nuevo reinicia la propuesta; no se llama a la IA hasta que el clínico lo pida.
  useEffect(() => { if (askedFor.current && askedFor.current !== text) { setItems([]); setNotes([]); setSaved(""); setError(""); askedFor.current = ""; } }, [text]);
  const propose = async () => {
    setBusy("proponiendo"); setError(""); setSaved("");
    try {
      const response = await fetch("/api/dictation/endo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text }) });
      const data = await response.json() as { items?: EndoProposal[]; rejected?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo proponer el endograma.");
      askedFor.current = text;
      setItems((data.items ?? []).map(item => ({ ...item, accepted: true })));
      setNotes(data.rejected ?? []);
      if (!(data.items ?? []).length) setError("No encontré datos endodónticos concretos en el dictado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo proponer el endograma."); }
    finally { setBusy(""); }
  };

  const save = async () => {
    const accepted = items.filter(item => item.accepted);
    if (!accepted.length) { setError("No hay nada aceptado que guardar."); return; }
    setBusy("guardando"); setError(""); setSaved("");
    try {
      const date = attentionDate && /^\d{4}-\d{2}-\d{2}$/.test(attentionDate) ? attentionDate : chileToday();
      const current = await fetch(`/api/endodontics?patientId=${patientId}`, { cache: "no-store" });
      if (!current.ok) throw new Error("No se pudo leer el endograma actual.");
      let data: EndoData = normalizeEndo((await current.json() as { data?: unknown }).data);
      for (const item of accepted) data = applyEndoProposal(data, item, date, () => crypto.randomUUID());
      const put = await fetch("/api/endodontics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, data }) });
      if (!put.ok) throw new Error("No se pudo guardar el endograma.");
      // Releer y comprobar que cada pieza y cada longitud de trabajo quedaron guardadas.
      const reread = await fetch(`/api/endodontics?patientId=${patientId}`, { cache: "no-store" });
      const back = normalizeEndo((await reread.json() as { data?: unknown }).data);
      const missing = accepted.filter(item => {
        const kase = [...back.cases].reverse().find(c => c.tooth === item.tooth);
        if (!kase) return true;
        return item.canals.some(c => c.workingLength && !kase.canals.some(k => k.workingLength === c.workingLength));
      });
      if (missing.length) throw new Error(`Al releer el endograma no coincide la pieza ${missing.map(m => formatFdi(m.tooth)).join(", ")}. Revísalo en la pestaña Endodoncia.`);
      setSaved(`Endograma guardado y releído: ${accepted.map(item => formatFdi(item.tooth)).join(", ")}.`);
      setItems([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el endograma."); }
    finally { setBusy(""); }
  };

  // La propuesta se pide sola la primera vez que el dictado trae endodoncia: el clínico solo revisa y confirma.
  const auto = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (relevant && !auto.current) { auto.current = true; void propose(); } }, [relevant]);
  if (!relevant) return null;

  return <section className="space-y-3" data-testid="dictation-endo">
    <h3 className="font-semibold">Endograma</h3>
    <p className="text-xs leading-5 text-[#615f73]">La IA ordena lo dictado de endodoncia (pruebas, diagnósticos, conductos y medidas, obturación). Las medidas solo se aceptan si se dijeron; nada se guarda hasta que lo confirmes.</p>
    {busy === "proponiendo" && <p role="status" className="text-sm text-[#615f73]">Ordenando lo dictado de endodoncia…</p>}
    {items.length === 0 && !saved && busy === "" && <Button type="button" variant="outline" onClick={() => void propose()} data-testid="dictation-endo-propose">Volver a proponer el endograma</Button>}
    {items.map((item, index) => <article key={item.id} className={`rounded-xl border p-4 ${item.accepted ? "border-emerald-200" : "border-[#e6e4ee] opacity-70"}`} data-testid="dictation-endo-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Pieza {formatFdi(item.tooth)} <span className="text-xs font-normal text-[#6b6a7c]">({item.numberingLabel})</span></p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={item.accepted} onChange={event => setItems(current => current.map((entry, i) => i === index ? { ...entry, accepted: event.target.checked } : entry))} />Anotar en el endograma</label>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{describeEndoProposal(item).map(line => <li key={line}>{line}</li>)}</ul>
      <p className="mt-2 text-xs text-[#6b6a7c]">Dicho: «{item.evidence}»</p>
    </article>)}
    {items.length > 0 && <Button type="button" disabled={busy !== ""} onClick={() => void save()} className="bg-[#473a6d] hover:bg-[#3a2f5a]" data-testid="dictation-endo-save">{busy === "guardando" ? "Guardando…" : "Guardar en el endograma"}</Button>}
    {notes.map(note => <p key={note} className="text-xs font-medium text-amber-800">{note}</p>)}
    {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-900" data-testid="dictation-endo-saved">{saved}</p>}
    {error && <p role="alert" className="text-sm text-[#a43542]">{error}</p>}
  </section>;
}
