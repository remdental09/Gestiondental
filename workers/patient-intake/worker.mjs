const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const EMAIL_PATTERN = /^[^\s@<>\",;]+@[^\s@<>\",;]+\.[^\s@<>\",;]{2,}$/;
const MAX_BODY_BYTES = 12_000;

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const json = (value, status = 200) => Response.json(value, { status, headers: responseHeaders });
const fail = (message, status = 400) => json({ error: message }, status);
const clean = (value, max) => typeof value === "string"
  ? value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function chileToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function validBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const currentDate = chileToday();
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && value <= currentDate
    && year >= Number(currentDate.slice(0, 4)) - 125;
}

function validName(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 3 && parts.every(part => /[\p{L}]/u.test(part));
}

function normalizedRut(value) {
  return value.toUpperCase().replace(/[^0-9K]/g, "");
}

function validRut(value) {
  const cleanRut = normalizedRut(value);
  const body = cleanRut.slice(0, -1);
  const digit = cleanRut.slice(-1);
  if (!/^\d{1,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const expected = 11 - (sum % 11);
  return (expected === 11 ? "0" : expected === 10 ? "K" : String(expected)) === digit;
}

async function readJsonLimited(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function findActiveLink(db, rawToken) {
  if (typeof rawToken !== "string" || !TOKEN_PATTERN.test(rawToken)) return null;
  const tokenHash = await hashToken(rawToken);
  const now = new Date().toISOString();
  return db.prepare(
    "SELECT id, owner_id FROM patient_intake_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1",
  ).bind(tokenHash, now).first();
}

function page(title, body, status = 200, script = "") {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f3f1f7"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><main style="max-width:560px;margin:0 auto;padding:20px"><section style="background:#fff;border:1px solid #e6e4ee;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(71,58,109,.06)">${body}</section><p style="font-size:12px;line-height:1.55;color:#6b6a7c;margin:14px 4px">Este formulario recopila datos básicos de identificación y contacto para preparar tu ficha. No reemplaza la anamnesis ni solicita información clínica.</p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`,
    {
      status,
      headers: {
        ...responseHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
  );
}

const invalidPage = () => page(
  "Enlace no disponible",
  `<div style="text-align:center;padding:14px 0"><div aria-hidden="true" style="display:inline-flex;width:48px;height:48px;align-items:center;justify-content:center;border-radius:50%;background:#efeef4;color:#473a6d;font-size:25px">·</div><h1 style="font-size:21px;margin:12px 0 8px">Este formulario ya no está disponible</h1><p style="margin:0;line-height:1.5;color:#6b6a7c">El enlace pudo vencer o ya fue utilizado. Solicita uno nuevo en la clínica.</p></div>`,
  404,
);

const FORM_SCRIPT = `(function(){
var form=document.getElementById('intake'),msg=document.getElementById('msg'),button=document.getElementById('submit'),token=new URLSearchParams(location.search).get('t')||'';
function show(text){msg.textContent=text;msg.style.display='block';}
form.addEventListener('submit',function(event){event.preventDefault();msg.style.display='none';
 var values={t:token,name:document.getElementById('name').value,rut:document.getElementById('rut').value,birthDate:document.getElementById('birth').value,email:document.getElementById('email').value,emailConfirm:document.getElementById('email2').value,phone:document.getElementById('phone').value,website:document.getElementById('website').value};
 if(values.email.trim().toLowerCase()!==values.emailConfirm.trim().toLowerCase()){show('Los correos electrónicos no coinciden. Revísalos antes de enviar.');return;}
 button.disabled=true;button.textContent='Enviando…';
 fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}).then(function(response){return response.json().then(function(data){return{ok:response.ok,data:data};});}).then(function(result){if(!result.ok){show(result.data.error||'No pudimos guardar tus datos. Revisa el formulario e intenta de nuevo.');button.disabled=false;button.textContent='Enviar mis datos';return;}history.replaceState(null,'',location.pathname);document.getElementById('card').innerHTML='<h1 style="font-size:21px;margin:0 0 8px">Datos recibidos</h1><p style="margin:0;line-height:1.5">Gracias. Tus datos básicos quedaron registrados para preparar tu ficha. En la consulta podrás confirmar que estén correctos.</p>';}).catch(function(){show('No hay conexión. Intenta de nuevo.');button.disabled=false;button.textContent='Enviar mis datos';});
});})();`;

async function getForm(request, env) {
  const token = new URL(request.url).searchParams.get("t") || "";
  let active;
  try { active = await findActiveLink(env.DB, token); } catch { return fail("No pudimos abrir el formulario. Intenta nuevamente.", 503); }
  if (!active) {
    if (request.method === "HEAD") return new Response(null, { status: 404, headers: responseHeaders });
    return invalidPage();
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: responseHeaders });

  const input = "display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:12px;border:1px solid #cfcde0;border-radius:9px;font-size:16px;background:#fff;color:#35343f";
  const label = (id, title, type, autocomplete, extra = "") => `<label for="${id}" style="display:block;margin-top:14px;font-size:14px;font-weight:700">${title}<input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" ${extra} style="${input}"></label>`;
  const body = `<div id="card"><p style="margin:0 0 4px;font-size:13px;color:#6b6a7c">FORMULARIO DE INGRESO</p><h1 style="font-size:23px;line-height:1.25;margin:0 0 8px;color:#30264f">Completa tus datos básicos</h1><p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#555364">Así podremos preparar tu ficha antes de la atención.</p><form id="intake">${label("name", "Nombre y apellidos *", "text", "name", "maxlength=180 required") }<p style="font-size:12px;color:#6b6a7c;margin:5px 0 0">Escribe tu nombre y tus dos apellidos.</p>${label("rut", "RUT / RUN (opcional)", "text", "off", "maxlength=30 inputmode=text autocapitalize=characters") }<p style="font-size:12px;color:#6b6a7c;margin:5px 0 0">Si no tienes RUT chileno, deja este campo vacío.</p>${label("birth", "Fecha de nacimiento *", "date", "bday", "required")}${label("email", "Correo electrónico *", "email", "email", "maxlength=254 required inputmode=email autocapitalize=none")}${label("email2", "Repite tu correo electrónico *", "email", "email", "maxlength=254 required inputmode=email autocapitalize=none")}${label("phone", "Número de teléfono *", "tel", "tel", "maxlength=24 required inputmode=tel") }<label aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden">Sitio web<input id="website" name="website" tabindex="-1" autocomplete="off"></label><p id="msg" role="alert" style="display:none;margin:14px 0 0;padding:10px;border-radius:8px;background:#fee2e2;color:#7f1d1d;font-size:14px"></p><button id="submit" type="submit" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#473a6d;color:#fff;font-size:16px;font-weight:700;cursor:pointer">Enviar mis datos</button></form></div>`;
  return page("Datos de ingreso del paciente", body, 200, FORM_SCRIPT);
}

async function submitForm(request, env) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Solicitud no permitida.", 403);
  let body;
  try { body = await readJsonLimited(request); }
  catch (error) {
    return fail(error instanceof Error && error.message === "BODY_TOO_LARGE" ? "El formulario excede el tamaño permitido." : "Revisa el formulario.", error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Revisa el formulario.");
  if (clean(body.website, 120)) return fail("No se pudo enviar el formulario.");

  let link;
  try { link = await findActiveLink(env.DB, body.t); } catch { return fail("No pudimos verificar el enlace. Intenta nuevamente.", 503); }
  if (!link) return fail("Este enlace ya no está disponible. Solicita uno nuevo en la clínica.", 404);

  const name = clean(body.name, 180);
  const birthDate = clean(body.birthDate, 10);
  const rutInput = clean(body.rut, 30);
  const email = clean(body.email, 254).toLowerCase();
  const emailConfirm = clean(body.emailConfirm, 254).toLowerCase();
  const phone = clean(body.phone, 24);
  if (!validName(name)) return fail("Escribe tu nombre y tus dos apellidos.");
  if (!validBirthDate(birthDate)) return fail("Revisa la fecha de nacimiento.");
  if (rutInput && !validRut(rutInput)) return fail("El RUT no es válido. Revísalo o deja el campo vacío si no tienes RUT chileno.");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return fail("Revisa el correo electrónico.");
  if (email !== emailConfirm) return fail("Los correos electrónicos no coinciden.");
  if (!/^[+\d()\s.-]{7,24}$/.test(phone) || phone.replace(/\D/g, "").length < 8) return fail("Revisa el número de teléfono.");

  const rut = rutInput ? normalizedRut(rutInput) : null;
  if (rut) {
    try {
      const duplicate = await env.DB.prepare(
        "SELECT id FROM patients WHERE owner_id = ? AND rut = ? LIMIT 1",
      ).bind(link.owner_id, rut).first();
      if (duplicate) return fail("Ya hay una ficha asociada a ese RUT. Comunícate con la clínica para actualizar tus datos.", 409);
    } catch { return fail("No pudimos validar los datos. Intenta nuevamente.", 503); }
  }

  const usedAt = new Date().toISOString();
  try {
    const claimed = await env.DB.prepare(
      "UPDATE patient_intake_links SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?",
    ).bind(usedAt, link.id, usedAt).run();
    if ((claimed.meta?.changes || 0) !== 1) return fail("Este enlace ya fue utilizado. Solicita uno nuevo en la clínica.", 409);

    const patient = await env.DB.prepare(
      "INSERT INTO patients (owner_id,name,birth_date,rut,phone,email,reason,status,allergies,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
    ).bind(link.owner_id, name, birthDate, rut, phone, email, "Evaluación", "Evaluación", "Sin registrar", "Sin registrar", usedAt, usedAt).first();
    if (!patient?.id) throw new Error("Patient record could not be created.");
    await env.DB.prepare("UPDATE patient_intake_links SET patient_id = ? WHERE id = ?").bind(patient.id, link.id).run().catch(() => undefined);
    return json({ ok: true });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE patient_intake_links SET used_at = NULL WHERE id = ? AND used_at = ?",
    ).bind(link.id, usedAt).run().catch(() => undefined);
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return fail("Ya hay una ficha asociada a ese RUT. Comunícate con la clínica para actualizar tus datos.", 409);
    }
    return fail("No pudimos guardar tus datos. Intenta nuevamente.", 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/api/ingreso-paciente") return new Response("No encontrado", { status: 404, headers: responseHeaders });
    if (request.method === "GET" || request.method === "HEAD") return getForm(request, env);
    if (request.method === "POST") return submitForm(request, env);
    return new Response("Método no permitido", { status: 405, headers: { ...responseHeaders, Allow: "GET, HEAD, POST" } });
  },
};
