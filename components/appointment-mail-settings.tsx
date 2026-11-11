"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Sender = { connected: false } | { connected: true; email: string; enabled: boolean; sendHour: number; message: string; lastRunAt: string | null; lastResult: string | null };
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "aún no";
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

/** Correo desde el que se avisa a los pacientes (puede ser distinto al de la cuenta del clínico). Apagado hasta que el clínico lo active. */
export function AppointmentMailSettings() {
  const [sender, setSender] = useState<Sender | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const lastDetail = useRef("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("drive");
    if (outcome === "mail-connected") setNotice("Correo conectado. Envía una prueba y luego activa los avisos.");
    if (outcome === "mail-scope-missing") setError("Google no dio permiso para enviar correos. Vuelve a conectar y deja marcada la casilla de enviar correo.");
    fetch("/api/appointment-mail", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ sender: Sender }> : null).then(r => setSender(r?.sender ?? { connected: false })).catch(() => setSender({ connected: false }));
  }, []);

  const call = async (method: string, body?: Record<string, unknown>, kind = "save") => {
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch("/api/appointment-mail", { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => ({})) as { sender?: Sender; error?: string; ok?: boolean; detail?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      if (data.sender) setSender(data.sender);
      lastDetail.current = data.detail ?? "";
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); return false; }
    finally { setBusy(""); }
  };

  return <section className="mt-6 overflow-hidden rounded-xl border border-[#e6e4ee] border-l-8 border-l-[#473a6d] bg-white p-4" aria-label="Correo para confirmar citas" data-testid="appointment-mail">
    <p className="-mx-4 -mt-4 mb-4 bg-[#473a6d] px-4 py-2 text-sm font-bold uppercase tracking-wide text-white" data-testid="audience-patients">Para tus pacientes · confirmación de citas</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="font-semibold">Correo para confirmar citas</h4>
        <p className="text-xs text-[#6b6a7c]">Elige desde qué correo de Google se avisa a tus pacientes (puede ser el de tu asistente). Una vez al día se envía un recordatorio por cada cita de mañana, con un botón para confirmar. No lleva datos clínicos.</p></div>
      <a href="/api/drive/connect?mail=1" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#644e92]" data-testid="mail-connect">
        <Mail className="size-4" />{sender?.connected ? "Cambiar correo" : "Elegir correo de envío"}</a>
    </div>
    {sender?.connected && <div className="mt-3 space-y-3 rounded-lg border border-[#ebeaf1] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>Se envía desde <strong>{sender.email}</strong></p>
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} aria-label="Desconectar el correo de envío" onClick={async () => { if (window.confirm(`¿Dejar de usar ${sender.email} para avisar a los pacientes?`)) await call("DELETE", undefined, "del"); }}><Trash2 className="size-4" /></Button>
      </div>
      <label className="flex items-center gap-3"><input type="checkbox" className="size-5" checked={sender.enabled} disabled={!!busy} onChange={event => void call("PUT", { enabled: event.target.checked })} data-testid="mail-enabled" />
        <span className="font-medium">Enviar recordatorios automáticamente</span></label>
      <label className="flex flex-wrap items-center gap-2">Enviar desde las
        <select className="h-9 rounded-md border px-2" value={sender.sendHour} disabled={!!busy} onChange={event => void call("PUT", { sendHour: Number(event.target.value) })} data-testid="mail-hour">{HOURS.map(hour => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select>
        <span className="text-xs text-[#6b6a7c]">(hora de Chile; solo a pacientes con correo en su ficha, sin repetir ni a quien ya confirmó)</span></label>
      <div className="space-y-1.5">
        <label className="block font-medium" htmlFor="mail-message">Tu mensaje o firma (opcional)</label>
        <textarea id="mail-message" rows={3} maxLength={600} className="w-full rounded-md border p-2 text-sm" placeholder="Ej.: Si necesita cambiar su hora, responda este correo o escriba al +56 9 …. Dr. Luis Rodríguez" value={draft ?? sender.message} onChange={event => setDraft(event.target.value)} data-testid="mail-message" />
        <div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" disabled={!!busy || draft === null || draft === sender.message} onClick={async () => { if (await call("PUT", { message: draft ?? "" })) { setDraft(null); setNotice("Mensaje guardado: saldrá en los próximos correos."); } }}>Guardar mensaje</Button>
          <span className="text-xs text-[#6b6a7c]">Se agrega bajo los botones. No escribas datos clínicos.</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={async () => { if (await call("POST", {}, "test")) setNotice(`${lastDetail.current || "Prueba"} enviada a ${sender.email}. Revisa esa bandeja.`); }}>{busy === "test" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Mail className="mr-1 size-4" />}Enviarme una prueba</Button>
        <p className="text-xs text-[#6b6a7c]">Último envío: {when(sender.lastRunAt)}{sender.lastResult ? ` · ${sender.lastResult}` : ""}</p>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">{error}</p>}
    {notice && <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">{notice}</p>}
  </section>;
}
