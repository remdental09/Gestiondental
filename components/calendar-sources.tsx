"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, ChevronDown, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Source = { id: string; label: string; account: string; addedAt: string; lastSyncAt: string | null; lastResult: string | null; ok: boolean };
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "aún no";

/** Calendarios de Google de este profesional (de cualquier cuenta Gmail), por su dirección secreta iCal. Solo lectura. */
export function CalendarSources({ onChanged }: { onChanged: () => void }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [url, setUrl] = useState(""), [label, setLabel] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);

  useEffect(() => { fetch("/api/calendar", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ sources: Source[] }> : null).then(r => setSources(r?.sources ?? [])).catch(() => setSources([])); }, []);

  const call = async (body: Record<string, unknown>, kind: string) => {
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { sources?: Source[]; error?: string; sync?: { ok: boolean; detail: string } };
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      if (data.sources) setSources(data.sources);
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); return null; }
    finally { setBusy(""); }
  };

  const add = async () => {
    const data = await call({ url, label }, "add");
    if (!data) return;
    setUrl(""); setLabel("");
    setNotice(data.sync?.ok ? `Calendario conectado: ${data.sync.detail}.` : `Calendario agregado; ${(data.sync?.detail ?? "no se pudo leer todavía").replace(/^./, c => c.toLowerCase())}`);
    onChanged();
  };

  return <section className="mt-6 rounded-xl border border-[#e4def3] bg-white p-4" aria-label="Calendarios de Google conectados" data-testid="calendar-sources">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">Calendarios de Google</h4>
      {!!sources?.length && <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={async () => { const d = await call({ action: "sync" }, "sync"); if (d) { setNotice("Calendarios actualizados."); onChanged(); } }}>
        {busy === "sync" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCw className="mr-1 size-4" />}Actualizar ahora</Button>}
    </div>
    <p className="mt-1 text-xs text-[#6e6a8c]">Puedes conectar el calendario de cualquier cuenta de Gmail, aunque no sea la que usas para entrar. La app solo lee las citas y se actualiza cada hora.</p>

    {sources === null ? <p className="mt-3 text-sm text-[#6e6a8c]">Cargando…</p> : sources.length > 0 && <ul className="mt-3 space-y-2">{sources.map(source => <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ebe6f6] px-3 py-2 text-sm">
      <div><p className="font-medium">{source.label || "Google Calendar"} <span className="text-xs font-normal text-[#6e6a8c]">· {source.account}</span></p>
        <p className={`text-xs ${source.ok ? "text-emerald-800" : "text-rose-800"}`}>Última lectura: {when(source.lastSyncAt)}{source.lastResult ? ` · ${source.lastResult}` : ""}</p></div>
      <Button type="button" variant="ghost" size="sm" disabled={!!busy} aria-label={`Quitar ${source.label}`} onClick={async () => { if (!window.confirm(`¿Quitar el calendario «${source.label || "Google Calendar"}»? Sus citas dejarán de verse en la agenda.`)) return; const d = await call({ action: "remove", id: source.id }, "remove"); if (d) { setNotice("Calendario quitado."); onChanged(); } }}><Trash2 className="size-4 text-rose-700" /></Button>
    </li>)}</ul>}

    <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
      <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="Dirección secreta en formato iCal" autoComplete="off" data-testid="calendar-url" />
      <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Nombre (opcional)" maxLength={60} aria-label="Nombre del calendario" />
      <Button type="button" onClick={add} disabled={!url.trim() || !!busy} data-testid="calendar-add">{busy === "add" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <CalendarPlus className="mr-1 size-4" />}Conectar</Button>
    </div>
    <button type="button" onClick={() => setHelp(v => !v)} className="mt-2 flex items-center gap-1 text-xs font-medium text-[#6a3fc8]" aria-expanded={help}><ChevronDown className={`size-3 transition-transform ${help ? "rotate-180" : ""}`} />¿Dónde encuentro esa dirección?</button>
    {help && <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[#565277]">
      <li>En un computador, entra a calendar.google.com con la cuenta de Gmail del calendario.</li>
      <li>Junto al calendario, a la izquierda: tres puntos → <strong>Configuración y uso compartido</strong>.</li>
      <li>Baja hasta <strong>Integrar el calendario</strong> y copia la <strong>Dirección secreta en formato iCal</strong>.</li>
      <li>Pégala aquí y pulsa Conectar. Es privada: no la compartas con otras personas.</li>
    </ol>}
    {error && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
    {notice && <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">{notice}</p>}
  </section>;
}
