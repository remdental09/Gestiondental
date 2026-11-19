// Verificación PÚBLICA de un documento emitido (QR de la receta, certificado o consentimiento). No usa sesión: solo un código secreto largo.
// Muestra tipo, profesional, clínica, fecha y estado. Nunca datos clínicos ni del paciente.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { patientDocuments } from "@/db/schema";
import { loadProfile } from "@/app/clinician-profile-db";
import { CLINICAL_DOCUMENT_LABEL, isClinicalDocumentKind } from "@/lib/clinical-documents";
import { documentHash, isVerifyToken, shortCode, verificationState, type VerificationState } from "@/lib/document-verification";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title></head>` +
  `<body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><div style="max-width:480px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e6e4ee">${body}</div>` +
  `<p style="font-size:12px;line-height:1.5;color:#6b6a7c;margin:16px 4px 0">Esta verificación confirma que el documento fue emitido desde Gestión Dental y que su registro no fue modificado. No es una firma electrónica avanzada ni reemplaza una receta electrónica retenida.</p></div></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });

const notFound = () => page("Documento no encontrado", `<h1 style="font-size:20px;margin:0 0 8px">No encontramos este documento</h1><p style="margin:0">El código no corresponde a un documento emitido. Si lo recibiste impreso, desconfía y consulta directamente con el profesional.</p>`, 404);

const BADGE: Record<VerificationState, { color: string; bg: string; title: string; text: string }> = {
  valido: { color: "#14532d", bg: "#dcfce7", title: "Documento auténtico y vigente", text: "Fue emitido desde Gestión Dental y su registro no ha sido modificado." },
  anulado: { color: "#7f1d1d", bg: "#fee2e2", title: "Documento ANULADO", text: "El profesional lo anuló. No debe usarse." },
  reemplazado: { color: "#7c2d12", bg: "#ffedd5", title: "Documento REEMPLAZADO", text: "Existe una versión nueva emitida por el profesional. Este ya no es válido." },
  alterado: { color: "#7f1d1d", bg: "#fee2e2", title: "Registro alterado", text: "El contenido registrado no coincide con el que se emitió. No lo aceptes y consulta con el profesional." },
  "no-emitido": { color: "#7f1d1d", bg: "#fee2e2", title: "Documento no emitido", text: "Este código no corresponde a un documento emitido." },
};

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!isVerifyToken(token)) return notFound();
  try {
    const [doc] = await getDb().select().from(patientDocuments).where(eq(patientDocuments.verifyToken, token)).limit(1);
    if (!doc) return notFound();
    const recomputed = await documentHash({ ownerId: doc.ownerId, patientId: doc.patientId, kind: doc.kind, title: doc.title, content: doc.content, createdBy: doc.createdBy, createdByName: doc.createdByName, issuedAt: doc.issuedAt });
    const state = verificationState(doc, recomputed);
    const profile = await loadProfile(doc.createdBy).catch(() => null);
    const badge = BADGE[state];
    const label = isClinicalDocumentKind(doc.kind) ? CLINICAL_DOCUMENT_LABEL[doc.kind] : "Documento";
    const issued = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(doc.issuedAt));
    const row = (name: string, value: string) => value ? `<p style="margin:12px 0 0;font-size:14px"><span style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b5d8e;font-weight:bold">${name}</span>${esc(value)}</p>` : "";
    return page(`Verificación · ${label}`,
      `<div style="background:${badge.bg};color:${badge.color};border-radius:10px;padding:14px 16px"><p style="margin:0;font-size:18px;font-weight:bold">${esc(badge.title)}</p><p style="margin:6px 0 0;font-size:14px">${esc(badge.text)}</p></div>` +
      row("Documento", label) + row("Profesional", doc.createdByName) + row("Clínica", profile?.clinicName ?? "") + row("Emitido", issued) +
      (doc.revokedAt ? row(doc.revokedReason === "reemplazado" ? "Reemplazado" : "Anulado", new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(doc.revokedAt))) : "") +
      row("Código de verificación", shortCode(doc.contentHash)));
  } catch { return page("Verificación no disponible", `<h1 style="font-size:20px;margin:0 0 8px">No pudimos verificar ahora</h1><p style="margin:0">Intenta de nuevo en unos minutos.</p>`, 503); }
}
