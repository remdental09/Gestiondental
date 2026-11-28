import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { patientIntakeLinks, patients } from "@/db/schema";
import { getDb } from "@/db";
import { hasFourNameParts } from "@/app/patient-identity";
import { isValidChileanRut, storedDocument } from "@/lib/patient-document";
import { isValidEmail } from "@/lib/appointment-mail";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
const jsonHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: jsonHeaders });
const fail = (message: string, status = 400) => json({ error: message }, status);
const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const tokenOk = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
const chileToday = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || value > chileToday()) return false;
  const todayYear = Number(chileToday().slice(0, 4));
  return year >= todayYear - 125;
}
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
async function activeLink(token: unknown) {
  if (!tokenOk(token)) return null;
  const [row] = await getDb().select().from(patientIntakeLinks)
    .where(and(eq(patientIntakeLinks.tokenHash, await hashToken(token)), isNull(patientIntakeLinks.usedAt), gt(patientIntakeLinks.expiresAt, new Date().toISOString())))
    .limit(1);
  return row ?? null;
}

function page(title: string, body: string, status = 200, script = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const nonce = btoa(binary);
  const response = new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title></head><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><main style="max-width:560px;margin:0 auto;padding:20px"><section style="background:#fff;border:1px solid #e6e4ee;border-radius:14px;padding:24px">${body}</section><p style="font-size:12px;line-height:1.5;color:#6b6a7c;margin:14px 4px">Este formulario recopila datos básicos de identificación y contacto para preparar tu ficha. No reemplaza la anamnesis ni solicita información clínica.</p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`,
    { status, headers: { ...headers, "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } },
  );
  return response;
}

const invalidPage = () => page("Enlace no disponible", `<h1 style="font-size:21px;margin:0 0 8px">Este formulario ya no está disponible</h1><p style="margin:0;line-height:1.5">El enlace pudo vencer o ya fue utilizado. Solicita uno nuevo en la clínica.</p>`, 404);

const FORM_SCRIPT = `(function(){
var form=document.getElementById('intake'),msg=document.getElementById('msg'),button=document.getElementById('submit'),token=new URLSearchParams(location.search).get('t')||'';
function show(text){msg.textContent=text;msg.style.display='block';}
form.addEventListener('submit',function(event){event.preventDefault();msg.style.display='none';
var values={t:token,name:document.getElementById('name').value,rut:document.getElementById('rut').value,birthDate:document.getElementById('birth').value,email:document.getElementById('email').value,emailConfirm:document.getElementById('email2').value,phone:document.getElementById('phone').value,website:document.getElementById('website').value};
 if(values.email.trim().toLowerCase()!==values.emailConfirm.trim().toLowerCase()){show('Los correos electrónicos no coinciden. Revísalos antes de enviar.');return;}
 button.disabled=true;button.textContent='Enviando…';
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}).then(function(response){return response.json().then(function(data){return{ok:response.ok,data:data};});}).then(function(result){if(!result.ok){show(result.data.error||'No pudimos guardar tus datos. Revisa el formulario e intenta de nuevo.');button.disabled=false;button.textContent='Enviar mis datos';return;}document.getElementById('card').innerHTML='<h1 style="font-size:21px;margin:0 0 8px">Datos recibidos</h1><p style="margin:0;line-height:1.5">Gracias. Tus datos quedaron guardados como preingreso pendiente. La clínica los revisará y los agregará a tu ficha al preparar el ingreso. Este envío no crea la ficha clínica ni reemplaza la anamnesis.</p>';}).catch(function(){show('No hay conexión. Intenta de nuevo.');button.disabled=false;button.textContent='Enviar mis datos';});
});})();`;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const found = await activeLink(token).catch(() => null);
  if (!found) return invalidPage();
  const input = "display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:12px;border:1px solid #cfcde0;border-radius:8px;font-size:16px;background:#fff;color:#35343f";
  const label = (id: string, title: string, type: string, auto: string, extra = "") => `<label for="${id}" style="display:block;margin-top:14px;font-size:14px;font-weight:700">${title}<input id="${id}" name="${id}" type="${type}" autocomplete="${auto}" ${extra} style="${input}"></label>`;
  return page("Datos de ingreso del paciente",
    `<div id="card"><p style="margin:0 0 4px;font-size:13px;color:#6b6a7c">Formulario de ingreso</p><h1 style="font-size:22px;margin:0 0 8px">Completa tus datos básicos</h1><p style="font-size:14px;line-height:1.5;margin:0 0 16px">Así podremos preparar tu ficha antes de la atención.</p><form id="intake">${label("name", "Nombre y apellidos *", "text", "name", "maxlength=180 required") }<p style="font-size:12px;color:#6b6a7c;margin:5px 0 0">Escribe tu nombre y tus dos apellidos.</p>${label("rut", "RUT / RUN", "text", "off", "maxlength=30 inputmode=text autocapitalize=characters") }<p style="font-size:12px;color:#6b6a7c;margin:5px 0 0">Si no tienes RUT chileno, deja este campo vacío.</p>${label("birth", "Fecha de nacimiento *", "date", "bday", "required")}${label("email", "Correo electrónico *", "email", "email", "maxlength=254 required inputmode=email autocapitalize=none")}${label("email2", "Repite tu correo electrónico *", "email", "email", "maxlength=254 required inputmode=email autocapitalize=none")}${label("phone", "Número de teléfono *", "tel", "tel", "maxlength=24 required inputmode=tel") }<label aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden">Sitio web<input id="website" name="website" tabindex="-1" autocomplete="off"></label><p id="msg" role="alert" style="display:none;margin:14px 0 0;padding:10px;border-radius:8px;background:#fee2e2;color:#7f1d1d;font-size:14px"></p><button id="submit" type="submit" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:9px;background:#473a6d;color:#fff;font-size:16px;font-weight:700">Enviar mis datos</button></form></div>`,
    200, FORM_SCRIPT);
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Solicitud no permitida.", 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12_000) return fail("El formulario excede el tamaño permitido.", 413);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("Revisa el formulario.");
  if (clean(body.website, 120)) return fail("No se pudo enviar el formulario.");
  const token = body.t;
  const found = await activeLink(token).catch(() => null);
  if (!found) return fail("Este enlace ya no está disponible. Solicita uno nuevo en la clínica.", 404);

  const name = clean(body.name, 180);
  const birthDate = clean(body.birthDate, 10);
  const rutInput = clean(body.rut, 30);
  const email = clean(body.email, 254).toLowerCase();
  const emailConfirm = clean(body.emailConfirm, 254).toLowerCase();
  const phone = clean(body.phone, 24);
  if (!hasFourNameParts(name)) return fail("Escribe tu nombre y tus dos apellidos.");
  if (!validBirthDate(birthDate)) return fail("Revisa la fecha de nacimiento.");
  if (rutInput && !isValidChileanRut(rutInput)) return fail("El RUT no es válido. Revísalo o deja el campo vacío si no tienes RUT chileno.");
  if (!isValidEmail(email)) return fail("Revisa el correo electrónico.");
  if (email !== emailConfirm) return fail("Los correos electrónicos no coinciden.");
  if (!/^[+\d()\s.-]{7,24}$/.test(phone) || phone.replace(/\D/g, "").length < 8) return fail("Revisa el número de teléfono.");

  const rut = rutInput ? storedDocument(rutInput, "rut") : null;
  const db = getDb();
  if (rut) {
    const [duplicate] = await db.select({ id: patients.id }).from(patients)
      .where(and(eq(patients.ownerId, found.ownerId), eq(patients.rut, rut))).limit(1);
    if (duplicate) return fail("Ya hay una ficha asociada a ese RUT. Comunícate con la clínica para actualizar tus datos.", 409);
    const [pending] = await db.select({ id: patientIntakeLinks.id }).from(patientIntakeLinks)
      .where(and(eq(patientIntakeLinks.ownerId, found.ownerId), eq(patientIntakeLinks.submittedRut, rut), isNull(patientIntakeLinks.patientId), isNotNull(patientIntakeLinks.usedAt))).limit(1);
    if (pending) return fail("Ya recibimos un preingreso con ese RUT. La clínica lo encontrará en «Nuevo paciente».", 409);
  }

  const usedAt = new Date().toISOString();
  let claimed: { id: number } | undefined;
  try {
    [claimed] = await db.update(patientIntakeLinks).set({
      usedAt,
      submittedName: name,
      submittedBirthDate: birthDate,
      submittedRut: rut,
      submittedPhone: phone,
      submittedEmail: email,
    })
      .where(and(eq(patientIntakeLinks.id, found.id), isNull(patientIntakeLinks.usedAt), gt(patientIntakeLinks.expiresAt, usedAt)))
      .returning({ id: patientIntakeLinks.id });
  } catch {
    return fail("No pudimos guardar tus datos. Intenta de nuevo.", 503);
  }
  if (!claimed) return fail("Este enlace ya fue utilizado. Solicita uno nuevo en la clínica.", 409);
  // El paciente solo deja un preingreso pendiente. La ficha clínica se crea después,
  // cuando el equipo lo selecciona y completa el ingreso desde «Nuevo paciente».
  return json({ ok: true });
}
