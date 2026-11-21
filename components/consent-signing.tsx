"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, LoaderCircle, Mail, MessageCircle, PenLine, Send, Smartphone, X } from "lucide-react";
import Image from "next/image";
import { SIGNER_ROLE_LABEL, SIGN_ACCEPTANCE, SIGN_LINK_HOURS, SIGN_METHOD_LABEL, isSignMethod, isSignerRole, type SignatureView, type SignerRole } from "@/lib/consent-signature";

const PAD_W = 600, PAD_H = 240, MIN_STROKE = 120;
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-sm text-[#35343f] outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15";
const fmt = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(date); };

/** Recuadro para firmar con el dedo, el lápiz o el mouse. Devuelve la firma como PNG transparente, o "" si aún no hay trazo suficiente. */
export function SignaturePad({ onChange, disabled }: { onChange: (png: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ drawing: false, length: 0, last: { x: 0, y: 0 } });
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) { ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1f1d2b"; ctx.fillStyle = "#1f1d2b"; }
  }, []);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * PAD_W / rect.width, y: (event.clientY - rect.top) * PAD_H / rect.height };
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.preventDefault();
    const ctx = ref.current?.getContext("2d"); if (!ctx) return;
    state.current.drawing = true; state.current.last = point(event);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* sin captura */ }
    ctx.beginPath(); ctx.arc(state.current.last.x, state.current.last.y, 1.5, 0, Math.PI * 2); ctx.fill();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.current.drawing) return;
    event.preventDefault();
    const ctx = ref.current?.getContext("2d"); if (!ctx) return;
    const next = point(event), last = state.current.last;
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(next.x, next.y); ctx.stroke();
    state.current.length += Math.hypot(next.x - last.x, next.y - last.y); state.current.last = next;
  };
  const up = () => {
    if (!state.current.drawing) return;
    state.current.drawing = false;
    const enough = state.current.length >= MIN_STROKE;
    setEmpty(!enough);
    onChange(enough && ref.current ? ref.current.toDataURL("image/png") : "");
  };
  const clear = () => {
    ref.current?.getContext("2d")?.clearRect(0, 0, PAD_W, PAD_H);
    state.current.length = 0; setEmpty(true); onChange("");
  };
  return <div>
    <canvas ref={ref} width={PAD_W} height={PAD_H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label="Recuadro de firma" data-testid="signature-pad"
      className="block aspect-[600/240] w-full touch-none rounded-lg border-2 border-dashed border-[#b9b1ce] bg-white"/>
    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[#615f73]">
      <span>{empty ? "Firma con el dedo o el lápiz dentro del recuadro." : "Firma lista."}</span>
      <button type="button" onClick={clear} className="min-h-9 rounded-lg border border-[#b9b1ce] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]">Borrar y volver a firmar</button>
    </div>
  </div>;
}

type LinkInfo = { url: string; message: string; whatsapp: string | null };

/** Firma del paciente en un consentimiento emitido: en pantalla (en la consulta) o por un enlace personal. */
export function ConsentSigningCard({ documentId, issued, signature, patient, onChange, onRefresh }: {
  documentId: number; issued: boolean; signature: SignatureView | null | undefined;
  patient: { name: string; phone: string; email: string };
  onChange: (next: SignatureView | null) => void; onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "sign">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<SignerRole>("paciente");
  const [signerName, setSignerName] = useState("");
  const [relation, setRelation] = useState("");
  const [accept, setAccept] = useState(false);
  const [png, setPng] = useState("");
  const pending = signature?.status === "pendiente" && signature.linkActive;

  // Mientras el paciente firma desde su teléfono, la ficha se actualiza sola.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(onRefresh, 8000);
    return () => window.clearInterval(timer);
  }, [pending, onRefresh]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documentos/firma", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: documentId, ...payload }) });
      const data = await response.json() as { signature?: SignatureView | null; link?: LinkInfo; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      return data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción."); return null; }
    finally { setBusy(false); }
  };
  const saveSignature = async () => {
    if (!accept) { setError("El firmante debe marcar la declaración antes de firmar."); return; }
    if (!png) { setError("Falta la firma en el recuadro."); return; }
    if (role === "representante" && (!signerName.trim() || !relation.trim())) { setError("Indica el nombre y la relación del representante legal."); return; }
    const data = await post({ action: "firmar", image: png, accept: true, signerRole: role, signerName, signerRelation: relation });
    if (data?.signature) { onChange(data.signature); setMode("idle"); setPng(""); setAccept(false); }
  };
  const makeLink = async () => {
    const data = await post({ action: "enlace" });
    if (data?.signature && data.link) { onChange(data.signature); setLink(data.link); setCopied(false); }
  };
  const cancelLink = async () => {
    if (!window.confirm("¿Desea cancelar el enlace? El paciente ya no podrá firmar con él.")) return;
    const data = await post({ action: "cancelar" });
    if (data) { onChange(null); setLink(null); }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.message); setCopied(true); } catch { setError("No se pudo copiar. Mantén presionado el enlace para copiarlo."); }
  };

  if (signature?.status === "firmado") {
    const who = isSignerRole(signature.signerRole) ? SIGNER_ROLE_LABEL[signature.signerRole] : "Paciente";
    const how = isSignMethod(signature.method) ? SIGN_METHOD_LABEL[signature.method] : "";
    return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 print:hidden" data-testid="consent-signed">
      <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-5"/>Consentimiento firmado</p>
      <p className="mt-1">{signature.signerName}{signature.signerRole === "representante" && signature.signerRelation ? `, ${signature.signerRelation} (${who.toLowerCase()})` : ""} · {fmt(signature.signedAt)}{how ? ` · ${how}` : ""}</p>
      <p className="mt-1 text-xs">La firma ya aparece en el documento impreso o en PDF.</p>
    </div>;
  }
  if (!issued) return <p className="rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d] print:hidden" data-testid="consent-sign-needs-issue">Para que el paciente firme, primero emite el consentimiento con QR: así el texto queda bloqueado y la firma se liga a esa versión.</p>;

  return <div className="space-y-3 rounded-lg border border-[#e6e4ee] bg-white p-4 print:hidden" data-testid="consent-signing">
    <div><h3 className="flex items-center gap-2 font-semibold text-[#35343f]"><PenLine className="size-4"/>Firma del paciente</h3><p className="mt-1 text-sm text-[#615f73]">Gratis y asociada a la ficha. Elige cómo firma el paciente.</p></div>
    {mode === "idle" && <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => { setMode("sign"); setError(""); }} disabled={busy} data-testid="consent-sign-now" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50"><Smartphone className="size-4"/>Firmar ahora en pantalla</button>
      <button type="button" onClick={() => void makeLink()} disabled={busy} data-testid="consent-sign-link" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#473a6d] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin"/> : <Send className="size-4"/>}{pending ? "Enviar un enlace nuevo" : "Enviar enlace al paciente"}</button>
    </div>}
    {mode === "sign" && <div className="space-y-3" data-testid="consent-sign-form">
      <fieldset className="space-y-1 text-sm">
        <legend className="font-semibold text-[#35343f]">¿Quién firma?</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={role === "paciente"} onChange={() => setRole("paciente")}/>El paciente ({patient.name})</label>
        <label className="flex items-center gap-2"><input type="radio" checked={role === "representante"} onChange={() => setRole("representante")}/>Su representante legal (padre, madre o tutor)</label>
      </fieldset>
      {role === "representante" && <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Nombre completo<input value={signerName} onChange={event => setSignerName(event.target.value)} maxLength={120} className={inputClass}/></label>
        <label className="block text-sm font-semibold">Relación con el paciente<input value={relation} onChange={event => setRelation(event.target.value)} maxLength={60} placeholder="Madre, padre, tutor…" className={inputClass}/></label>
      </div>}
      <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" checked={accept} onChange={event => setAccept(event.target.checked)} className="mt-1 size-5 shrink-0"/><span>{SIGN_ACCEPTANCE}</span></label>
      <SignaturePad onChange={setPng} disabled={busy}/>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void saveSignature()} disabled={busy} data-testid="consent-sign-save" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin"/> : <CheckCircle2 className="size-4"/>}Guardar firma</button>
        <button type="button" onClick={() => { setMode("idle"); setError(""); }} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><X className="size-4"/>Cancelar</button>
      </div>
    </div>}
    {link && <div className="space-y-2 rounded-lg bg-[#f3f1f7] p-3 text-sm" data-testid="consent-link">
      <p className="font-semibold text-[#473a6d]">Enlace listo. Dura {SIGN_LINK_HOURS} horas y sirve una sola vez.</p>
      <p className="break-all rounded bg-white p-2 font-mono text-xs">{link.url}</p>
      <div className="flex flex-wrap gap-2">
        {link.whatsapp && <a href={link.whatsapp} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25d366] px-4 text-sm font-semibold text-white"><MessageCircle className="size-4"/>Enviar por WhatsApp</a>}
        {patient.email && <a href={`mailto:${patient.email}?subject=${encodeURIComponent("Consentimiento informado para firmar")}&body=${encodeURIComponent(link.message)}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#473a6d] px-4 text-sm font-semibold text-[#473a6d]"><Mail className="size-4"/>Enviar por correo</a>}
        <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] bg-white px-4 text-sm font-semibold text-[#473a6d]"><Copy className="size-4"/>{copied ? "Copiado" : "Copiar mensaje"}</button>
      </div>
      {!link.whatsapp && <p className="text-xs text-[#615f73]">La ficha no tiene un celular válido para abrir WhatsApp: copia el mensaje y envíalo por el medio que prefieras.</p>}
    </div>}
    {pending && !link && <p className="flex flex-wrap items-center gap-2 text-sm text-[#473a6d]" data-testid="consent-link-pending">Enlace enviado: esperando la firma (vence {fmt(signature!.tokenExpiresAt)}). Esta pantalla se actualiza sola.
      <button type="button" onClick={() => void cancelLink()} disabled={busy} className="min-h-9 rounded-lg border border-[#b9b1ce] px-3 text-sm font-semibold hover:bg-[#f3f1f7]">Cancelar enlace</button></p>}
    {signature?.status === "pendiente" && !signature.linkActive && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">El último enlace venció sin firmarse. Envía uno nuevo o firma en pantalla.</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </div>;
}

/** Firma del paciente para el documento impreso o en PDF. */
export function PatientSignatureImage({ signature }: { signature: SignatureView }) {
  return <Image src={signature.image} alt="Firma del paciente" width={600} height={240} unoptimized className="h-full w-full object-contain object-bottom" data-testid="patient-signature-image"/>;
}
