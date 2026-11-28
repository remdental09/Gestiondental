"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, Download, QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type PublicLink = { url: string; createdAt: string };

const qrFor = (url: string) => {
  if (!url) return "";
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function PatientIntakePublicDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [link, setLink] = useState<PublicLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const qr = useMemo(() => link ? qrFor(link.url) : "", [link]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLink(null);
    setBusy(true);
    setError("");
    setCopied(false);
    void fetch("/api/ingreso-paciente/publico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    }).then(async response => {
      const data = await response.json() as PublicLink & { error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "No se pudo preparar el QR.");
      setLink(data);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo preparar el QR.");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [open]);

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setError(""); }
    catch { setError("No se pudo copiar automáticamente. Mantén presionado el enlace para copiarlo."); }
  };

  const share = async () => {
    if (!link || !navigator.share) return;
    try { await navigator.share({ title: "Formulario de preingreso SpeakDent", text: "Completa tus datos básicos para preparar tu atención dental.", url: link.url }); }
    catch { /* La hoja de compartir puede cerrarse sin enviar. */ }
  };

  const download = () => {
    if (!qr) return;
    const url = URL.createObjectURL(new Blob([qr], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "speakdent-qr-preingreso.svg";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    if (!link || !qr) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("El navegador bloqueó la ventana de impresión. Descarga el QR y ábrelo para imprimirlo.");
      return;
    }
    const safeUrl = escapeHtml(link.url);
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR de preingreso SpeakDent</title><style>html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif;color:#35343f}main{min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22mm}h1{font-size:28px;margin:0 0 12px;color:#473a6d}p{font-size:17px;line-height:1.5;max-width:560px;margin:0 0 18px}.qr{width:75mm;height:75mm;margin:8px auto 18px}.qr svg{width:100%;height:100%}.link{font-size:12px;overflow-wrap:anywhere;color:#6b6a7c}@media print{main{min-height:100vh;padding:18mm}.qr{width:78mm;height:78mm}}</style></head><body><main><h1>Completa tus datos antes de tu atención</h1><p>Escanea este código QR para ingresar tus datos básicos de preingreso en SpeakDent.</p><div class="qr">${qr}</div><p class="link">${safeUrl}</p></main><script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});</script></body></html>`);
    printWindow.document.close();
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><QrCode className="size-5 text-[#473a6d]"/>QR genérico de preingreso</DialogTitle>
        <DialogDescription>Este QR es permanente y se puede compartir con cualquier paciente, aunque todavía no tengas su correo. Cada persona que lo escanee completa su propio formulario; sus datos quedan como preingreso pendiente y aparecen en «Preingreso recibido» para que después los revises al crear su ficha. No se crea una ficha automáticamente ni reemplaza la anamnesis.</DialogDescription>
      </DialogHeader>
      {busy ? <p role="status" className="py-8 text-center text-sm text-[#615f73]">Preparando el enlace y el QR…</p> : link ? <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto w-full max-w-[220px] rounded-xl border border-[#e6e4ee] bg-white p-3" role="img" aria-label="Código QR genérico para el formulario de preingreso" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="space-y-3">
          <p className="font-semibold text-[#35343f]">Para la sala de espera, puedes imprimirlo y dejarlo visible.</p>
          <p className="text-sm leading-5 text-[#615f73]">También puedes copiar el enlace y enviarlo por WhatsApp. El paciente escribe su correo en el formulario; no hace falta que lo conozcas para compartir este QR.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}><Copy className="mr-2 size-4"/>{copied ? "Enlace copiado" : "Copiar enlace"}</Button>
            {typeof navigator !== "undefined" && "share" in navigator && <Button type="button" variant="outline" size="sm" onClick={() => void share()}><Share2 className="mr-2 size-4"/>Compartir</Button>}
            <Button type="button" variant="outline" size="sm" onClick={download}><Download className="mr-2 size-4"/>Descargar QR</Button>
            <Button type="button" variant="outline" size="sm" onClick={print}>Imprimir QR</Button>
          </div>
        </div>
        <div className="rounded-lg border border-[#e6e4ee] bg-[#f7f6fa] p-3 sm:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6b6a7c]">Enlace genérico para compartir</p>
          <p className="break-all text-sm text-[#35343f]">{link.url}</p>
        </div>
      </div> : null}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}><Check className="mr-2 size-4"/>Listo</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
