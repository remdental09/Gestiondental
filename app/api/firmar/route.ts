// Página PÚBLICA a la que llega el paciente desde el enlace que le envía su dentista, para leer y firmar el consentimiento informado.
// No usa la sesión del clínico: solo un enlace secreto, personal, de un solo uso y con vencimiento. Solo se guarda la huella del código.
// Requiere el bypass de /api/firmar (GET, HEAD y POST) en worker.ts.
import { and, eq } from "drizzle-orm";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { ensureConsentSignatureTable } from "@/app/consent-signature-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { getDb } from "@/db";
import { consentSignatures, patientDocuments, patients } from "@/db/schema";
import {
  SIGN_ACCEPTANCE, SIGN_LINK_HOURS, cleanSignatureImage, cleanSignerText, identityMatches, identityRequired, isSignLinkActive, isSignerRole,
  sha256Hex, shortPatientName, signatureHash,
} from "@/lib/consent-signature";
import { isVerifyToken, shortCode } from "@/lib/document-verification";
import { sendSignedCopy } from "@/app/document-pdf";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const baseHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const page = (title: string, body: string, status = 200, script = "") => {
  const key = nonce();
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title></head>` +
    `<body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><div style="max-width:560px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e6e4ee">${body}</div>` +
    `<p style="font-size:12px;line-height:1.5;color:#6b6a7c;margin:14px 4px 0">Tu firma manuscrita en pantalla se registra como firma electrónica simple, con la fecha, la hora y el dispositivo. No es firma electrónica avanzada.</p></div>${script ? `<script nonce="${key}">${script}</script>` : ""}</body></html>`,
    { status, headers: { ...baseHeaders, "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${key}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
};
const invalid = () => page("Enlace no válido", `<h1 style="font-size:20px;margin:0 0 8px">Este enlace no es válido</h1><p style="margin:0">Puede haber vencido (dura ${SIGN_LINK_HOURS} horas), ya haberse usado o haber sido reemplazado. Pide a la clínica que te envíe uno nuevo.</p>`, 404);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function resolve(token: string) {
  if (!isVerifyToken(token)) return null;
  await ensureDocumentIssuanceColumns();
  await ensureConsentSignatureTable();
  const db = getDb();
  const [row] = await db.select().from(consentSignatures).where(eq(consentSignatures.tokenHash, await sha256Hex(token))).limit(1);
  if (!row || !isSignLinkActive(row)) return null;
  const [doc] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, row.documentId), eq(patientDocuments.ownerId, row.ownerId))).limit(1);
  if (!doc || doc.kind !== "consentimiento" || doc.status !== "emitido" || !doc.contentHash || doc.revokedAt) return null;
  const [patient] = await db.select({ name: patients.name, rut: patients.rut }).from(patients).where(and(eq(patients.id, doc.patientId), eq(patients.ownerId, row.ownerId))).limit(1);
  if (!patient) return null;
  return { row, doc, patient };
}

const SECTIONS: [string, string][] = [["procedimiento", "Procedimiento propuesto"], ["descripcion", "Descripción y alcance"], ["riesgos", "Riesgos y posibles complicaciones"], ["alternativas", "Alternativas y consecuencias de no tratar"], ["declaracion", "Declaraciones o acuerdos específicos"]];

const CLIENT_SCRIPT = `(function(){
var token=new URLSearchParams(location.search).get('t')||'';
var pad=document.getElementById('pad'),ctx=pad.getContext('2d'),drawing=false,length=0,last=null;
ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#1f1d2b';
function point(e){var r=pad.getBoundingClientRect();return{x:(e.clientX-r.left)*pad.width/r.width,y:(e.clientY-r.top)*pad.height/r.height};}
pad.addEventListener('pointerdown',function(e){e.preventDefault();drawing=true;last=point(e);try{pad.setPointerCapture(e.pointerId);}catch(x){}ctx.beginPath();ctx.arc(last.x,last.y,1.5,0,6.3);ctx.fill();});
pad.addEventListener('pointermove',function(e){if(!drawing)return;e.preventDefault();var p=point(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();length+=Math.hypot(p.x-last.x,p.y-last.y);last=p;});
function stop(){drawing=false;}
pad.addEventListener('pointerup',stop);pad.addEventListener('pointercancel',stop);pad.addEventListener('pointerleave',stop);
document.getElementById('clear').addEventListener('click',function(){ctx.clearRect(0,0,pad.width,pad.height);length=0;});
var rep=document.getElementById('rep');
function roleChanged(){rep.style.display=document.querySelector('input[name=role]:checked').value==='representante'?'block':'none';}
document.querySelectorAll('input[name=role]').forEach(function(r){r.addEventListener('change',roleChanged);});roleChanged();
var msg=document.getElementById('msg'),btn=document.getElementById('send');
function say(t){msg.textContent=t;msg.style.display='block';}
btn.addEventListener('click',function(){
 msg.style.display='none';
 if(!document.getElementById('accept').checked){say('Marca la declaración antes de firmar.');return;}
 if(length<120){say('Dibuja tu firma en el recuadro.');return;}
 var role=document.querySelector('input[name=role]:checked').value;
 var body={t:token,accept:true,image:pad.toDataURL('image/png'),signerRole:role,signerName:document.getElementById('rname').value,signerRelation:document.getElementById('rrel').value,identity:(document.getElementById('ident')||{}).value||''};
 btn.disabled=true;btn.textContent='Enviando…';
 fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});}).then(function(x){
  if(!x.ok){say(x.d.error||'No se pudo registrar la firma.');btn.disabled=false;btn.textContent='Firmar consentimiento';return;}
  document.getElementById('card').innerHTML='<h1 style="font-size:20px;margin:0 0 8px">Firma registrada ✔</h1><p style="margin:0">Gracias. Tu firma quedó asociada a tu ficha. Código de verificación: <strong style="font-family:monospace"></strong></p><p id="copy" style="margin:12px 0 0;font-size:14px;color:#35343f"></p>';
  document.querySelector('#card strong').textContent=x.d.code||'';
  if(x.d.copySent)document.getElementById('copy').textContent='También te enviamos una copia firmada en PDF a tu correo.';
 }).catch(function(){say('No hay conexión. Intenta de nuevo.');btn.disabled=false;btn.textContent='Firmar consentimiento';});
});
})();`;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const found = await resolve(token).catch(() => null);
  if (!found) return invalid();
  const { doc, patient } = found;
  let content: Record<string, string> = {};
  try { content = JSON.parse(doc.content) as Record<string, string>; } catch { /* contenido ilegible: se muestra vacío */ }
  const profile = await loadProfile(doc.createdBy).catch(() => null);
  const clinic = profile?.clinicName ?? "";
  const section = ([key, label]: [string, string]) => content[key]?.trim() ? `<h2 style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b5d8e;margin:16px 0 4px">${esc(label)}</h2><p style="margin:0;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(content[key]!.trim())}</p>` : "";
  const input = "width:100%;box-sizing:border-box;padding:11px;border:1px solid #cfcde0;border-radius:8px;font-size:16px;margin-top:4px";
  const identity = identityRequired(patient.rut)
    ? `<label style="display:block;margin-top:14px;font-size:14px;font-weight:bold">Para confirmar tu identidad, escribe los últimos 4 caracteres del documento de identidad del paciente (sin puntos ni guion; en el RUT incluye el dígito verificador)<input id="ident" autocomplete="off" maxlength="12" style="${input}"></label>` : "";
  return page("Firma del consentimiento informado",
    `<div id="card"><p style="margin:0;font-size:13px;color:#6b6a7c">${esc(clinic)}${clinic && doc.createdByName ? " · " : ""}${esc(doc.createdByName)}</p>` +
    `<h1 style="font-size:20px;margin:4px 0 2px">Consentimiento informado</h1><p style="margin:0;font-size:14px">Paciente: <strong>${esc(shortPatientName(patient.name))}</strong></p>` +
    SECTIONS.map(section).join("") +
    `<hr style="border:0;border-top:1px solid #e6e4ee;margin:20px 0">` +
    `<p style="margin:0 0 6px;font-size:14px;font-weight:bold">¿Quién firma?</p>` +
    `<label style="display:block;font-size:15px;margin:4px 0"><input type="radio" name="role" value="paciente" checked> Soy el paciente</label>` +
    `<label style="display:block;font-size:15px;margin:4px 0"><input type="radio" name="role" value="representante"> Soy su representante legal (padre, madre o tutor)</label>` +
    `<div id="rep" style="display:none"><label style="display:block;margin-top:10px;font-size:14px;font-weight:bold">Tu nombre completo<input id="rname" maxlength="120" autocomplete="name" style="${input}"></label><label style="display:block;margin-top:10px;font-size:14px;font-weight:bold">Tu relación con el paciente (p. ej. madre, padre, tutor)<input id="rrel" maxlength="60" style="${input}"></label></div>` +
    identity +
    `<label style="display:flex;gap:10px;margin-top:16px;font-size:14px;line-height:1.5;align-items:flex-start"><input type="checkbox" id="accept" style="margin-top:4px;width:20px;height:20px;flex:none"><span>${esc(SIGN_ACCEPTANCE)}</span></label>` +
    `<p style="margin:16px 0 4px;font-size:14px;font-weight:bold">Firma con el dedo en el recuadro</p>` +
    `<canvas id="pad" width="600" height="240" style="width:100%;height:auto;aspect-ratio:600/240;border:2px dashed #b9b1ce;border-radius:8px;background:#fff;touch-action:none;display:block;box-sizing:border-box"></canvas>` +
    `<button id="clear" type="button" style="margin-top:8px;padding:8px 14px;border:1px solid #bdb7d3;border-radius:8px;background:#fff;color:#473a6d;font-size:14px">Borrar y volver a firmar</button>` +
    `<p id="msg" role="alert" style="display:none;margin:14px 0 0;padding:10px;border-radius:8px;background:#fee2e2;color:#7f1d1d;font-size:14px"></p>` +
    `<button id="send" type="button" style="width:100%;margin-top:16px;padding:15px;border:0;border-radius:8px;background:#473a6d;color:#fff;font-size:16px;font-weight:bold">Firmar consentimiento</button></div>`,
    200, CLIENT_SCRIPT);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Solicitud no permitida." }, 403);
  const body = await request.json().catch(() => null) as { t?: unknown; accept?: unknown; image?: unknown; signerRole?: unknown; signerName?: unknown; signerRelation?: unknown; identity?: unknown } | null;
  const found = await resolve(typeof body?.t === "string" ? body.t : "").catch(() => null);
  if (!found) return json({ error: "Este enlace no es válido o ya fue usado. Pide a la clínica que te envíe uno nuevo." }, 404);
  const { row, doc, patient } = found;
  if (body?.accept !== true) return json({ error: "Marca la declaración antes de firmar." }, 400);
  const image = cleanSignatureImage(body.image);
  if (!image) return json({ error: "La firma no es válida. Vuelve a firmar en el recuadro." }, 400);
  if (!identityMatches(body.identity, patient.rut)) return json({ error: "Los últimos 4 caracteres del documento no coinciden con la ficha." }, 400);
  const role = isSignerRole(body.signerRole) ? body.signerRole : "paciente";
  const relation = role === "representante" ? cleanSignerText(body.signerRelation, 60) : "";
  const signerName = role === "representante" ? cleanSignerText(body.signerName, 120) : patient.name;
  if (role === "representante" && (!signerName || !relation)) return json({ error: "Escribe tu nombre completo y tu relación con el paciente." }, 400);
  const signedAt = new Date().toISOString();
  const hash = await signatureHash({ documentHash: doc.contentHash, image, signedAt, signerName, signerRole: role, signerRelation: relation, method: "enlace" });
  try {
    // Solo firma si el enlace sigue pendiente (evita dos firmas simultáneas); el enlace queda invalidado.
    const [signed] = await getDb().update(consentSignatures).set({
      status: "firmado", tokenHash: null, tokenExpiresAt: "", signerName, signerRole: role, signerRelation: relation, image, signedAt, method: "enlace",
      ip: (request.headers.get("cf-connecting-ip") ?? "").slice(0, 64), userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300), signatureHash: hash,
    }).where(and(eq(consentSignatures.id, row.id), eq(consentSignatures.status, "pendiente"))).returning({ id: consentSignatures.id });
    if (!signed) return json({ error: "Este enlace ya fue usado." }, 409);
  } catch (reason) {
    if (reason instanceof Error && /UNIQUE/i.test(reason.message)) return json({ error: "Este consentimiento ya fue firmado." }, 409);
    return json({ error: "No pudimos registrar tu firma. Intenta de nuevo." }, 500);
  }
  // La firma ya quedó guardada: la copia por correo es un extra y nunca puede hacer fallar la firma.
  const code = shortCode(hash);
  let copySent = false;
  try { await sendSignedCopy(row.ownerId, doc.id, new URL(request.url).origin, code); copySent = true; } catch { /* sin correo o sin remitente: la firma igual quedó registrada */ }
  return json({ ok: true, code, copySent });
}
