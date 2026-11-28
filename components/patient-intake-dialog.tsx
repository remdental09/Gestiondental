"use client";

import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, ExternalLink, Mail, QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type CreatedLink = { url: string; expiresAt: string; emailStatus: "not_requested" | "sent" | "not_connected" | "failed" };

const qrFor = (url: string) => {
  if (!url) return "";
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
};

export function PatientIntakeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const qr = useMemo(() => created ? qrFor(created.url) : "", [created]);

  const handleOpenChange = (next: boolean) => {
    if (!next) { setEmail(""); setCreated(null); setBusy(false); setError(""); setCopied(false); }
    onOpenChange(next);
  };

  const create = async () => {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch("/api/ingreso-paciente/enlace", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json() as CreatedLink & { error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "No se pudo crear el formulario.");
      setCreated(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear el formulario.");
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); setCopied(true); setError(""); }
    catch { setError("No se pudo copiar automáticamente. Selecciona el enlace para copiarlo."); }
  };
  const share = async () => {
    if (!created || !navigator.share) return;
    try { await navigator.share({ title: "Formulario de datos de ingreso", text: "Completa tus datos básicos antes de tu atención dental.", url: created.url }); }
    catch { /* El paciente o profesional puede cancelar la hoja de compartir. */ }
  };
  const expiry = created ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(created.expiresAt)) : "";

  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><QrCode className="size-5 text-[#473a6d]"/>Formulario de datos del paciente</DialogTitle>
        <DialogDescription>Comparte un enlace individual o muestra el código QR para que lo escanee en la sala de espera. Vence en 7 días y se puede enviar una sola vez.</DialogDescription>
      </DialogHeader>
      {!created ? <div className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium" htmlFor="patient-intake-email">Correo del paciente (opcional)
          <Input id="patient-intake-email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="paciente@ejemplo.cl" value={email} onChange={event => setEmail(event.target.value)} />
        </label>
        <p className="text-sm leading-5 text-[#615f73]">Si ingresas un correo y la cuenta de envío está conectada, enviaremos allí el enlace. También podrás copiarlo o compartirlo; si el paciente está en la clínica, puede escanear el QR.</p>
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button><Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => void create()} disabled={busy}>{busy ? "Preparando…" : "Crear formulario y QR"}</Button></DialogFooter>
      </div> : <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto w-full max-w-[190px] rounded-xl border border-[#e6e4ee] bg-white p-3" role="img" aria-label="Código QR para abrir el formulario" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-[#35343f]">Escanea el código para abrir el formulario.</p>
            <p className="text-[#615f73]">Este enlace vence el {expiry} y deja de funcionar después de que se envían los datos.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}><Copy className="mr-2 size-4"/>{copied ? "Enlace copiado" : "Copiar enlace"}</Button>
              {typeof navigator !== "undefined" && "share" in navigator && <Button type="button" variant="outline" size="sm" onClick={() => void share()}><Share2 className="mr-2 size-4"/>Compartir</Button>}
              <a href={created.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dddbe6] px-3 text-sm font-medium text-[#473a6d] hover:bg-[#f3f1f7]">Abrir formulario <ExternalLink className="size-4"/></a>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-[#e6e4ee] bg-[#f7f6fa] p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">Enlace para compartir</p>
          <p className="break-all text-sm text-[#35343f]">{created.url}</p>
        </div>
        {created.emailStatus === "sent" && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><Mail className="mr-2 inline size-4"/>Enlace enviado por correo.</p>}
        {created.emailStatus === "not_connected" && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">No se envió por correo porque la cuenta de envío no está conectada. Puedes compartir el enlace o usar el QR.</p>}
        {created.emailStatus === "failed" && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">No se pudo enviar el correo. El enlace sigue disponible para compartirlo o mostrar el QR.</p>}
        {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => handleOpenChange(false)}><Check className="mr-2 size-4"/>Listo</Button></DialogFooter>
      </div>}
    </DialogContent>
  </Dialog>;
}
