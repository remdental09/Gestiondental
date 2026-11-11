"use client";

import { useEffect, useState } from "react";
import { Loader2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/today-agenda";

type Digest = { mailConnected: boolean; from: string; enabled: boolean; toEmail: string; sendHour: number; abbreviate: boolean; lastSentAt: string | null; lastResult: string | null };
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "aún no";
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

/** Agenda de la semana por correo para quien apoya la consulta (técnico/TONS), con lo que cambió desde el último envío. */
export function AgendaDigestSettings() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  // El número se recuerda solo en este dispositivo; WhatsApp no se envía desde el servidor.
  const [phone, setPhone] = useState("");
  useEffect(() => { try { setPhone(localStorage.getItem("agenda-whatsapp") ?? ""); } catch { /* sin almacenamiento */ } }, []);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");

  useEffect(() => { fetch("/api/agenda-digest", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ digest: Digest }> : null).then(r => setDigest(r?.digest ?? null)).catch(() => setDigest(null)); }, []);

  const call = async (method: string, body: Record<string, unknown>, kind: string) => {
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agenda-digest", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { digest?: Digest; error?: string; detail?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      if (data.digest) setDigest(data.digest);
      if (data.detail) setNotice(data.detail);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); return false; }
    finally { setBusy(""); }
  };

  const sendWhatsApp = async () => {
    setError(""); setNotice("");
    if (!whatsappLink(phone, "x")) { setError("Escribe un celular chileno de 9 dígitos que parta con 9 (por ejemplo 9 1234 5678)."); return; }
    setBusy("wa");
    try {
      const response = await fetch("/api/agenda-digest?formato=whatsapp", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "No se pudo preparar la agenda.");
      try { localStorage.setItem("agenda-whatsapp", phone); } catch { /* sin almacenamiento */ }
      const link = whatsappLink(phone, data.text);
      if (link) window.open(link, "_blank", "noopener");
      setNotice("Se abrió WhatsApp con la agenda lista. Toca «enviar» allí.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar la agenda."); }
    finally { setBusy(""); }
  };

  if (!digest) return null;
  const shown = email ?? digest.toEmail;
  return <section className="mt-6 overflow-hidden rounded-xl border border-[#e6e4ee] border-l-8 border-l-[#ef895f] bg-white p-4" aria-label="Agenda de la semana por correo" data-testid="agenda-digest">
    <p className="-mx-4 -mt-4 mb-4 bg-[#ef895f] px-4 py-2 text-sm font-bold uppercase tracking-wide text-[#2b2140]" data-testid="audience-staff">Para el personal técnico de la clínica · agenda de la semana</p>
    <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-5 text-[#473a6d]" />
      <div><h4 className="font-semibold">Agenda de la semana por correo</h4>
        <p className="text-xs text-[#6b6a7c]">Se envía sola una vez al día con la agenda completa de hoy y los 6 días siguientes, y además al momento en que cambia (se revisa cada 15 minutos, de 7:00 a 21:00): destaca qué cita es nueva, cuál cambió de día u hora y cuál se canceló. Además puedes enviarla tú cuando quieras, a quien necesites: escribe el correo y pulsa «Enviar ahora». Solo lleva nombre, hora y motivo; no datos clínicos.</p></div></div>
    {!digest.mailConnected ? <p className="mt-3 text-sm text-amber-900">Primero elige el correo de envío en «Correo para confirmar citas», aquí arriba.</p> : <div className="mt-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1"><span className="block text-xs font-medium text-[#3b3355]">Correo de quien recibe la agenda</span>
          <input type="email" value={shown} onChange={event => setEmail(event.target.value)} placeholder="nombre@correo.com" className="mt-1 h-10 w-full rounded-lg border border-[#cfcde0] px-3" data-testid="digest-email" /></label>
        <Button type="button" size="sm" disabled={!!busy || shown.trim() === digest.toEmail} onClick={async () => { if (await call("PUT", { toEmail: shown.trim() }, "email")) setEmail(null); }}>Guardar correo</Button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={digest.enabled} disabled={!!busy} onChange={event => void call("PUT", { enabled: event.target.checked, ...(shown.trim() !== digest.toEmail ? { toEmail: shown.trim() } : {}) }, "enabled")} data-testid="digest-enabled" /><span className="font-medium">Enviar todos los días</span></label>
        <label className="flex items-center gap-2">a las <select value={digest.sendHour} disabled={!!busy} onChange={event => void call("PUT", { sendHour: Number(event.target.value) }, "hour")} className="h-9 rounded-lg border border-[#cfcde0] px-2">{HOURS.map(hour => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select> (hora de Chile)</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={digest.abbreviate} disabled={!!busy} onChange={event => void call("PUT", { abbreviate: event.target.checked }, "abbr")} />Abreviar apellidos (Olga C. Z.)</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void call("POST", { accion: "prueba" }, "test")}>{busy === "test" ? <Loader2 className="size-4 animate-spin" /> : null}Enviarme una prueba</Button>
        <Button type="button" size="sm" disabled={!!busy || !shown.trim()} onClick={() => { if (window.confirm(`¿Enviar ahora la agenda de la semana a ${shown.trim()}?`)) void call("POST", { accion: "enviar", toEmail: shown.trim() }, "send"); }} data-testid="digest-send-now">{busy === "send" ? <Loader2 className="size-4 animate-spin" /> : null}Enviar ahora a {shown.trim() || "…"}</Button>
        <span className="text-xs text-[#6b6a7c]">Se envía desde {digest.from}. Último envío: {when(digest.lastSentAt)}{digest.lastResult ? ` · ${digest.lastResult}` : ""}</span>
      </div>
    </div>}
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[#ebeaf1] pt-3 text-sm" data-testid="digest-whatsapp">
      <label className="min-w-[200px] flex-1"><span className="block text-xs font-medium text-[#3b3355]">Celular para WhatsApp</span>
        <input type="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="9 1234 5678" className="mt-1 h-10 w-full rounded-lg border border-[#cfcde0] px-3" data-testid="digest-phone" /></label>
      <Button type="button" size="sm" disabled={!!busy || !phone.trim()} onClick={() => void sendWhatsApp()} data-testid="digest-send-whatsapp">{busy === "wa" ? <Loader2 className="size-4 animate-spin" /> : null}Enviar por WhatsApp</Button>
      <p className="w-full text-xs text-[#6b6a7c]">Se abre WhatsApp con la agenda ya escrita y el número puesto; tú solo tocas «enviar». No se envía sola, y no necesita el correo de envío.</p>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="mt-2 text-sm text-emerald-800">{notice}</p>}
  </section>;
}
