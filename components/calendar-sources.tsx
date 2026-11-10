"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Account = { id: string; email: string; connectedAt: string; lastSyncAt: string | null; lastResult: string | null; ok: boolean };
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "aún no";

/** Google Calendar de cualquier cuenta de Gmail: un botón, se elige la cuenta y se acepta. Solo lectura. */
export function CalendarSources({ onChanged }: { onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("drive");
    if (outcome === "calendar-connected") { setNotice("Calendario conectado. Tus citas ya aparecen en la agenda."); changed.current(); }
    if (outcome === "calendar-scope-missing") setError("Google no dio permiso para ver el calendario. Vuelve a conectar y deja marcada la casilla del calendario.");
    if (outcome === "denied") setError("No se autorizó el calendario.");
    fetch("/api/calendar", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ accounts: Account[] }> : null).then(r => setAccounts(r?.accounts ?? [])).catch(() => setAccounts([]));
  }, []);

  const call = async (body: Record<string, unknown>, kind: string) => {
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { accounts?: Account[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      if (data.accounts) setAccounts(data.accounts);
      changed.current();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); return false; }
    finally { setBusy(""); }
  };

  return <section className="mt-6 rounded-xl border border-[#e6e4ee] bg-white p-4" aria-label="Google Calendar conectado" data-testid="calendar-sources">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="font-semibold">Google Calendar</h4>
        <p className="text-xs text-[#6b6a7c]">Conecta el calendario de cualquier cuenta de Gmail. La app solo mira tus citas, no cambia nada, y se actualiza cada hora.</p></div>
      <div className="flex gap-2">
        {!!accounts?.length && <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={async () => { if (await call({ action: "sync" }, "sync")) setNotice("Agenda actualizada."); }}>
          {busy === "sync" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCw className="mr-1 size-4" />}Actualizar</Button>}
        <a href="/api/drive/connect?calendar=1" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#644e92]" data-testid="calendar-connect">
          <CalendarCheck className="size-4" />{accounts?.length ? "Conectar otra cuenta" : "Conectar con Google"}</a>
      </div>
    </div>
    {accounts && accounts.length > 0 && <ul className="mt-3 space-y-2">{accounts.map(account => <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ebeaf1] px-3 py-2 text-sm">
      <div><p className="font-medium">{account.email}</p>
        <p className={`text-xs ${account.ok || !account.lastSyncAt ? "text-emerald-800" : "text-rose-800"}`}>Actualizado: {when(account.lastSyncAt)}{account.lastResult ? ` · ${account.lastResult}` : ""}</p></div>
      <Button type="button" variant="ghost" size="sm" disabled={!!busy} aria-label={`Desconectar ${account.email}`} onClick={async () => { if (window.confirm(`¿Desconectar el calendario de ${account.email}? Sus citas dejarán de verse en la agenda.`) && await call({ action: "remove", id: account.id }, "remove")) setNotice("Calendario desconectado."); }}><Trash2 className="size-4 text-rose-700" /></Button>
    </li>)}</ul>}
    {error && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
    {notice && <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">{notice}</p>}
  </section>;
}
