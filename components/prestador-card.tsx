"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Clock3, Download, Eye, FileUp, LoaderCircle, QrCode, ShieldAlert, ShieldCheck } from "lucide-react";
import qrcode from "qrcode-generator";
import { RNPI_SITE, type PublicRegistration } from "@/lib/prestador-certificate";
import type { QrSource } from "@/lib/prestador-qr";

export type MyRegistration = (PublicRegistration & {
  status: "pendiente" | "aprobado" | "rechazado"; reviewNote: string;
  certificate?: { name: string; size: number; uploadedAt: string } | null;
  qr?: { payload: string; source: QrSource; official: boolean; hasImage: boolean; printUrl: string; printFrom: "qr" | "codigo" | "" };
}) | null;

const dateLabel = (iso: string) => { const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(d); };
const qrSvg = (url: string) => { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); };

async function send(input: RequestInfo, init?: RequestInit): Promise<MyRegistration> {
  const response = await fetch(input, init);
  const data = await response.json() as { registration?: MyRegistration; error?: string };
  if (!response.ok || !data.registration) throw new Error(data.error || "No se pudo leer el certificado.");
  return data.registration;
}

/** Estado y acciones de la habilitación del profesional (se usa en Documentación, Mi identificación y Profesionales). */
export function usePrestador() {
  const [registration, setRegistration] = useState<MyRegistration>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/prestador", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { registration?: MyRegistration; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer tu habilitación.");
      if (active) setRegistration(data.registration ?? null);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "No se pudo leer tu habilitación."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const run = useCallback(async (work: () => Promise<MyRegistration>, done: (reg: MyRegistration) => string) => {
    setUploading(true); setError(""); setNotice("");
    try { const reg = await work(); setRegistration(reg); setNotice(done(reg)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo leer el certificado."); }
    finally { setUploading(false); setStep(""); }
  }, []);
  const upload = useCallback((file: File) => run(async () => {
    const body = new FormData(); body.set("certificado", file);
    // El QR del certificado se lee aquí, en el teléfono; si no se puede, se usa el validador oficial con el código.
    setStep("Buscando el código QR del certificado…");
    const found = await import("@/components/certificate-qr").then(module => module.extractQrFromPdf(file)).catch(() => null);
    if (found) { body.set("qrPayload", found.payload); body.set("qrImage", new File([found.image], "qr.png", { type: "image/png" })); }
    setStep("Guardando el certificado…");
    return send("/api/prestador", { method: "POST", body });
  }, reg => reg?.status === "pendiente" ? "Certificado guardado, pero quedó en revisión: algo no coincidió (ver abajo)." : (reg?.status === "aprobado" ? "¡Listo! Quedaste habilitado para emitir recetas. " : "") + (reg?.qr?.printFrom === "qr" ? "Certificado guardado. Su código QR se imprimirá en tus recetas y certificados." : "Certificado guardado. No se pudo leer su QR: se imprimirá el enlace al validador de la Superintendencia con tu código de validación. Puedes subir una foto del QR.")), [run]);
  const pasteText = useCallback((texto: string) => run(() => send("/api/prestador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) }),
    reg => (reg?.status === "aprobado" ? "¡Listo! Quedaste habilitado para emitir recetas. " : reg?.status === "pendiente" ? "Datos leídos, pero quedaron en revisión: algo no coincidió (ver abajo). " : "Datos leídos. ") + "Sube también el PDF para guardarlo y usar su QR."), [run]);
  const uploadQr = useCallback((file: File) => run(async () => {
    setStep("Leyendo el código QR…");
    const found = await import("@/components/certificate-qr").then(module => module.extractQrFromImage(file));
    if (!found) throw new Error("No se encontró un código QR en la imagen. Toma una foto más nítida, de frente y con buena luz.");
    const body = new FormData(); body.set("payload", found.payload); body.set("qr", new File([found.image], "qr.png", { type: "image/png" }));
    return send("/api/prestador/qr", { method: "POST", body });
  }, reg => reg?.qr?.official ? "QR guardado: se imprimirá en tus recetas y certificados." : "QR guardado, pero no apunta a un sitio de la Superintendencia de Salud: se seguirá imprimiendo el validador oficial."), [run]);
  return { registration, loading, uploading, step, error, notice, upload, pasteText, uploadQr };
}

export type PrestadorState = ReturnType<typeof usePrestador>;

const SOURCE_LABEL: Record<string, string> = {
  pdf: "leído de tu certificado",
  imagen: "de la foto del QR que subiste",
};

// Clases sin utilidades en conflicto: antes el botón principal mezclaba bg-white/text-white/border-transparent con el morado
// y en el CSS compilado ganaban los blancos → «Subir certificado (PDF)» quedaba blanco sobre blanco (invisible).
export const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#473a6d] bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a]";
export const secondaryButton = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#473a6d] bg-white px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

export function PrestadorCard({ state }: { state: PrestadorState }) {
  const { registration, loading, uploading, step, error, notice, upload, pasteText, uploadQr } = state;
  const input = useRef<HTMLInputElement | null>(null);
  const qrInput = useRef<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState("");
  const status = registration?.status;
  const qr = registration?.qr;
  const printUrl = qr?.printUrl ?? "";
  const svg = useMemo(() => printUrl ? qrSvg(printUrl) : "", [printUrl]);
  const tone = status === "aprobado" ? "border-emerald-200 bg-emerald-50" : status === "rechazado" ? "border-rose-200 bg-rose-50" : status === "pendiente" ? "border-amber-200 bg-amber-50" : "border-[#e6e4ee] bg-white";
  const button = secondaryButton;
  return <section className={`rounded-xl border p-4 ${tone}`} aria-label="Habilitación para emitir recetas" data-testid="prestador-card">
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-[#473a6d]">{status === "aprobado" ? <BadgeCheck className="size-5"/> : status === "pendiente" ? <Clock3 className="size-5"/> : status === "rechazado" ? <ShieldAlert className="size-5"/> : <FileUp className="size-5"/>}</span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-[#35343f]">Habilitación para emitir recetas</h2>
        {loading ? <p className="mt-1 text-sm text-[#615f73]" role="status">Revisando tu habilitación…</p> : !registration ? <p className="mt-1 text-sm text-[#44425a]">Para emitir recetas debes ser prestador individual inscrito. Descarga tu <strong>Certificado de inscripción</strong> en {RNPI_SITE} y súbelo aquí (PDF). <strong>El archivo se guarda de forma segura en tu cuenta</strong> (puedes verlo, descargarlo o reemplazarlo) y su <strong>código QR se imprime en tus recetas y certificados</strong>, para que cualquiera verifique que estás habilitado para ejercer.</p> : <>
          <p className="mt-1 text-sm font-semibold text-[#35343f]">{status === "aprobado" ? "Habilitado para emitir recetas" : status === "pendiente" ? "En revisión: aún no puedes emitir recetas" : "Rechazado"}</p>
          <p className="mt-1 text-sm text-[#44425a]">REG-SIS Nº {registration.regSis} · {registration.profession}{registration.specialties.length ? ` · ${registration.specialties.join(", ")}` : ""}</p>
          <p className="text-xs text-[#615f73]">Certificado del {dateLabel(registration.issuedOn)}{registration.validationCode ? ` · código de validación ${registration.validationCode}` : ""}</p>
          {status === "rechazado" && registration.reviewNote && <p className="mt-1 text-sm text-rose-900">Motivo: {registration.reviewNote}</p>}
          {status === "pendiente" && registration.reviewNote && <p className="mt-1 text-sm text-amber-950" data-testid="prestador-pending-reason"><strong>Qué no coincidió:</strong> {registration.reviewNote} Corrígelo y vuelve a subir el certificado, o espera la revisión manual.</p>}
          {registration.certificate ? <div className="mt-3 rounded-lg border border-[#dddbe6] bg-white p-3" data-testid="prestador-file">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#35343f]"><ShieldCheck className="size-4 text-emerald-700" aria-hidden="true"/>Certificado guardado de forma segura</p>
            <p className="mt-0.5 break-all text-xs text-[#615f73]">{registration.certificate.name}{registration.certificate.uploadedAt ? ` · subido el ${dateLabel(registration.certificate.uploadedAt)}` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href="/api/prestador/certificado" target="_blank" rel="noopener" className={button}><Eye className="size-4" aria-hidden="true"/>Ver</a>
              <a href="/api/prestador/certificado?descargar=1" className={button}><Download className="size-4" aria-hidden="true"/>Descargar</a>
            </div>
          </div> : <p className="mt-3 rounded-lg bg-amber-100/70 p-3 text-sm text-amber-950">Aún no hay un PDF guardado (los datos se leyeron de texto pegado). Sube el PDF original para guardarlo y usar su QR.</p>}
          {qr?.printUrl && <div className="mt-3 flex items-start gap-3 rounded-lg border border-[#dddbe6] bg-white p-3" data-testid="prestador-qr">
            <div className="size-20 shrink-0 [&_svg]:size-full" role="img" aria-label="Código QR de habilitación que va en tus recetas" dangerouslySetInnerHTML={{ __html: svg }}/>
            <div className="min-w-0 text-xs text-[#44425a]">
              <p className="text-sm font-semibold text-[#35343f]">QR en tus recetas y certificados</p>
              <p className="mt-0.5">{qr.printFrom === "qr" ? `Código QR ${SOURCE_LABEL[qr.source] ?? "de tu certificado"}.` : "No se pudo leer el QR del PDF: se imprime el enlace al validador oficial de la Superintendencia con tu código de validación."}</p>
              {qr.payload && !qr.official && <p className="mt-0.5 text-amber-900">El QR leído no apunta a un sitio de la Superintendencia de Salud, por eso no se imprime.</p>}
              <p className="mt-0.5 break-all font-mono text-[11px] text-[#615f73]">{qr.printUrl}</p>
            </div>
          </div>}
        </>}
        {step && <p className="mt-2 flex items-center gap-2 text-sm text-[#473a6d]" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>{step}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}
        {notice && !error && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
        {!loading && status !== "aprobado" && <p className="mt-2 text-xs text-[#615f73]">Esta verificación es solo del profesional; el certificado no valida cada receta.</p>}
        <input ref={qrInput} type="file" accept="image/*" className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadQr(file); }} aria-label="Elegir una foto del código QR del certificado"/>
        {!loading && <div className="mt-3 flex flex-wrap gap-2">
          <label className={`${registration?.certificate ? secondaryButton : primaryButton} cursor-pointer focus-within:ring-2 focus-within:ring-[#473a6d]/40 ${uploading ? "pointer-events-none opacity-50" : ""}`} data-testid="prestador-upload"><input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} aria-label={registration?.certificate ? "Reemplazar el PDF del certificado de inscripción" : "Subir el PDF del certificado de inscripción"} data-testid="prestador-file-input"/>{uploading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <FileUp className="size-4" aria-hidden="true"/>}{uploading ? "Leyendo certificado…" : registration?.certificate ? "Reemplazar certificado (PDF)" : "Subir certificado (PDF)"}</label>
          {registration && qr?.printFrom !== "qr" && <button type="button" disabled={uploading} onClick={() => qrInput.current?.click()} className={button} data-testid="prestador-qr-upload"><QrCode className="size-4"/>Subir foto del QR</button>}
        </div>}
        {!loading && status !== "aprobado" && <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#473a6d]">¿No encuentras el PDF en el teléfono? Pega su texto</summary>
          <label className="mt-2 block text-sm font-semibold text-[#35343f]">Texto del certificado
            <textarea rows={4} value={pasted} onChange={event => setPasted(event.target.value)} onPaste={event => { const file = [...event.clipboardData.files].find(item => item.type === "application/pdf"); if (file) { event.preventDefault(); void upload(file); } }} placeholder="Abre el PDF → mantén presionado → Seleccionar todo → Copiar → pega aquí" className="mt-1 w-full resize-y rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-base font-normal outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15"/>
          </label>
          <button type="button" disabled={uploading || pasted.trim().length < 200} onClick={() => { void pasteText(pasted); setPasted(""); }} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin"/> : <BadgeCheck className="size-4"/>}{uploading ? "Leyendo…" : "Leer texto pegado"}</button>
          <p className="mt-1 text-xs text-[#615f73]">Con el texto se leen los mismos datos, pero conviene subir el PDF: así queda guardado y su QR va en tus recetas.</p>
        </details>}
      </div>
    </div>
  </section>;
}

/** Tarjeta completa (carga y acciones propias) para Mi identificación profesional y Configuración → Profesionales. */
export function PrestadorPanel() {
  const state = usePrestador();
  return <PrestadorCard state={state}/>;
}
