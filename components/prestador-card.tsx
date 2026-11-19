"use client";

import { useRef, useState } from "react";
import { BadgeCheck, Clock3, FileUp, LoaderCircle, ShieldAlert } from "lucide-react";
import { RNPI_SITE, type PublicRegistration } from "@/lib/prestador-certificate";

export type MyRegistration = (PublicRegistration & { status: "pendiente" | "aprobado" | "rechazado"; reviewNote: string }) | null;

const dateLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(d); };

export function PrestadorCard({ registration, loading, uploading, error, onUpload, onPasteText }: { registration: MyRegistration; loading: boolean; uploading: boolean; error: string; onUpload: (file: File) => void; onPasteText: (text: string) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState("");
  const status = registration?.status;
  const tone = status === "aprobado" ? "border-emerald-200 bg-emerald-50" : status === "rechazado" ? "border-rose-200 bg-rose-50" : status === "pendiente" ? "border-amber-200 bg-amber-50" : "border-[#e6e4ee] bg-white";
  return <section className={`rounded-xl border p-4 ${tone}`} aria-label="Habilitación para emitir recetas">
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-[#473a6d]">{status === "aprobado" ? <BadgeCheck className="size-5"/> : status === "pendiente" ? <Clock3 className="size-5"/> : status === "rechazado" ? <ShieldAlert className="size-5"/> : <FileUp className="size-5"/>}</span>
      <div className="min-w-0">
        <h2 className="font-semibold text-[#35343f]">Habilitación para emitir recetas</h2>
        {loading ? <p className="mt-1 text-sm text-[#615f73]" role="status">Revisando tu habilitación…</p> : !registration ? <p className="mt-1 text-sm text-[#44425a]">Para emitir recetas debes ser prestador individual inscrito. Descarga tu <strong>Certificado de inscripción</strong> en {RNPI_SITE} y súbelo aquí (PDF). La aplicación lee solo el N° de registro, tu profesión y el código de validación, y descarta el archivo.</p> : <>
          <p className="mt-1 text-sm font-semibold text-[#35343f]">{status === "aprobado" ? "Habilitado para emitir recetas" : status === "pendiente" ? "En revisión: aún no puedes emitir recetas" : "Rechazado"}</p>
          <p className="mt-1 text-sm text-[#44425a]">REG-SIS Nº {registration.regSis} · {registration.profession}{registration.specialties.length ? ` · ${registration.specialties.join(", ")}` : ""}</p>
          <p className="text-xs text-[#615f73]">Certificado del {dateLabel(registration.issuedOn)} · código {registration.validationCode}</p>
          {status === "rechazado" && registration.reviewNote && <p className="mt-1 text-sm text-rose-900">Motivo: {registration.reviewNote}</p>}
        </>}
        {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}
        {!loading && status !== "aprobado" && <p className="mt-2 text-xs text-[#615f73]">Esta verificación es solo del profesional; el certificado no valida cada receta.</p>}
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} aria-label="Elegir el PDF del certificado de inscripción"/>
        {!loading && status !== "aprobado" && <div className="mt-3">
          <label className="block text-sm font-semibold text-[#35343f]">Pega aquí el texto del certificado
            <textarea rows={4} value={pasted} onChange={event => setPasted(event.target.value)} onPaste={event => { const file = [...event.clipboardData.files].find(item => item.type === "application/pdf"); if (file) { event.preventDefault(); onUpload(file); } }} placeholder="Abre el PDF → mantén presionado → Seleccionar todo → Copiar → pega aquí" className="mt-1 w-full resize-y rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15"/>
          </label>
          <button type="button" disabled={uploading || pasted.trim().length < 200} onClick={() => { onPasteText(pasted); setPasted(""); }} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin"/> : <BadgeCheck className="size-4"/>}{uploading ? "Leyendo…" : "Leer texto pegado"}</button>
          <p className="mt-1 text-xs text-[#615f73]">El texto no se guarda: solo los datos necesarios. Si prefieres, también puedes subir el PDF.</p>
        </div>}
        {!loading && <button type="button" disabled={uploading} onClick={() => input.current?.click()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#473a6d] bg-white px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin"/> : <FileUp className="size-4"/>}{uploading ? "Leyendo certificado…" : registration ? "Subir un certificado nuevo" : "Subir certificado (PDF)"}</button>}
      </div>
    </div>
  </section>;
}
