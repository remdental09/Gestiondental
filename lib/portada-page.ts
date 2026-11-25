/** Portada pública de speakdent.cl: presentación, entrada con correo y código, y entrada con Google. No muestra ni pide datos clínicos. */
import { LOGIN_PATH, EMAIL_LOGIN_PATH, GOOGLE_SIGN_OUT_URL } from "./google-login.ts";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export const PORTADA_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const BUILDING = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M10 9h4M12 7v4"/></svg>`;
const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const MARK = `<svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><path d="M13 8c-4 0-7 3.2-7 8 0 4.6 1.6 7.4 2.6 11.6.8 3.4 1.4 6.4 3.4 6.4 2.4 0 2.2-4.2 3.6-7.2.8-1.6 1.6-2.4 2.4-2.4s1.6.8 2.4 2.4c1.4 3 1.2 7.2 3.6 7.2 2 0 2.6-3 3.4-6.4C32.4 23.4 34 20.6 34 16c0-4.8-3-8-7-8-3 0-4.4 1.6-7 1.6S16 8 13 8z" fill="none" stroke="#5eead4" stroke-width="2.2" stroke-linejoin="round"/><path d="M2 20h5l2-5 3 10 3-7 2 2h2M38 20h-3" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/></svg>`;

/** Mensajes de error conocidos; cualquier otro código muestra un texto genérico (nunca se refleja texto del usuario). */
const ERRORS: Record<string, string> = {
  cancelado: "Se canceló el inicio de sesión con Google.",
  vencido: "El inicio de sesión tardó demasiado. Vuelve a intentarlo.",
  "no-verificado": "Esa cuenta de Google no tiene el correo verificado.",
  "correo-invalido": "Escribe un correo válido, por ejemplo nombre@dominio.cl.",
  "sin-acceso": "Esa cuenta no tiene acceso. Escríbenos si eres dentista y quieres usar SpeakDent.",
  configuracion: "El inicio de sesión aún se está configurando. Intenta más tarde.",
  codigo: "El código de ingreso venció o se equivocó demasiadas veces. Vuelve a entrar para recibir uno nuevo.",
  demasiados: "Se pidieron demasiados códigos o intentos de ingreso. Espera unos minutos y vuelve a intentarlo.",
};

export function portadaPage(errorCode?: string | null): string {
  const error = errorCode ? (ERRORS[errorCode] ?? "No se pudo iniciar sesión. Vuelve a intentarlo.") : "";
  return `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SpeakDent · Ficha dental por voz</title>
<meta name="description" content="Ficha clínica odontológica por voz para dentistas de Chile: dicta la atención y SpeakDent arma la evolución y el odontograma.">
<meta name="theme-color" content="#060a17">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6eefc;background:#060a17}
.hero{position:relative;min-height:100vh;min-height:100dvh;display:flex;align-items:center;overflow:hidden;
 background:#060a17 url(/portada/fondo.webp) 62% center/cover no-repeat}
.hero::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,10,23,.96) 0%,rgba(6,10,23,.86) 30%,rgba(6,10,23,.35) 55%,rgba(6,10,23,0) 72%)}
.panel{position:relative;width:min(470px,100%);margin-left:clamp(20px,7vw,110px);padding:28px 0 72px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:22px;letter-spacing:.2px;color:#fff}
.brand .word span{color:#5eead4}
.tag{margin:6px 0 0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc}
h1{margin:34px 0 14px;font-size:clamp(32px,4.2vw,50px);line-height:1.08;font-weight:700;color:#fff}
h1 em{font-style:normal;background:linear-gradient(90deg,#5eead4,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:0 0 30px;font-size:18px;color:#b9c6e0;max-width:420px}
.google{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:0 26px;border-radius:12px;
 background:#fff;color:#1f2937;font-weight:600;font-size:16px;text-decoration:none;box-shadow:0 10px 30px rgba(56,189,248,.18),0 0 0 1px rgba(255,255,255,.1)}
.google:hover{background:#f1f5f9}
.doors{display:grid;gap:12px;max-width:400px}
.clinic{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:0 26px;border-radius:12px;
 background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:16px;text-decoration:none;border:1px solid rgba(251,146,60,.65)}
.clinic:hover{background:rgba(251,146,60,.14)}
.clinic:focus-visible{outline:3px solid #fb923c;outline-offset:3px}
.door-note{margin:2px 0 0;font-size:13px;color:#8b9bb8}
.shared{margin:14px 0 0;max-width:400px;padding-top:12px;border-top:1px solid rgba(139,155,184,.25);font-size:13px;color:#8b9bb8}
.shared a{color:#c9d6ee;text-decoration:underline;text-underline-offset:3px}
.shared a:hover,.shared a:focus-visible{color:#fff}
.google:focus-visible{outline:3px solid #5eead4;outline-offset:3px}
.mail{display:grid;gap:12px;max-width:400px}
.mail label.f{font-size:14px;color:#c9d6ee}
.mail input[type=email]{width:100%;min-height:52px;padding:0 16px;border-radius:12px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:16px}
.mail input[type=email]:focus-visible{outline:3px solid #5eead4;outline-offset:2px}
.mail button{cursor:pointer;font-family:inherit;border:0}
.mail button.clinic{border:1px solid rgba(251,146,60,.65)}
.own{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#aebbd4}
.own input{margin-top:3px;width:18px;height:18px;flex:none}
.sep{display:flex;align-items:center;gap:12px;margin:18px 0 12px;max-width:400px;font-size:13px;color:#8b9bb8}
.sep::before,.sep::after{content:"";flex:1;height:1px;background:rgba(139,155,184,.3)}
.alt{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:48px;padding:0 22px;border-radius:12px;background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:15px;text-decoration:none;border:1px solid rgba(255,255,255,.25)}
.alt:hover{background:rgba(255,255,255,.12)}.alt:focus-visible{outline:3px solid #5eead4;outline-offset:3px}
.note{margin:16px 0 0;font-size:13px;color:#8b9bb8;max-width:400px}
.modules{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 0;max-width:420px}
.modules span{padding:7px 11px;border:1px solid rgba(125,211,252,.25);border-radius:999px;background:rgba(15,23,42,.62);color:#dbeafe;font-size:13px;line-height:1.2;white-space:nowrap}
.modules span:last-child{border-color:rgba(94,234,212,.35);color:#99f6e4}
.signup-note{margin:10px 0 0;max-width:400px;color:#99f6e4;font-size:13px}
.error{margin:0 0 18px;padding:10px 14px;border-radius:10px;border:1px solid rgba(251,146,60,.5);background:rgba(124,45,18,.35);color:#fed7aa;font-size:14px}
footer{position:absolute;right:clamp(16px,4vw,40px);bottom:18px;font-size:12px;color:#94a3b8;z-index:1}
footer a{color:#94a3b8}
.city{position:absolute;left:clamp(20px,7vw,110px);bottom:18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;z-index:1}
.city b{color:#f59e0b;font-weight:600}
@media (max-width:760px){
 .hero{align-items:flex-end;background-image:url(/portada/fondo-movil.webp);background-position:center top}
 .hero::before{background:linear-gradient(180deg,rgba(6,10,23,.1) 0%,rgba(6,10,23,.15) 14%,rgba(6,10,23,.9) 32%,#060a17 42%)}
 .panel{margin:0;padding:0 22px 76px}
 h1{margin-top:22px}.lead{font-size:16px;margin-bottom:22px}
 .google,.clinic,.alt{width:100%}
 .modules{margin-top:18px;gap:7px}.modules span{font-size:12px;padding:7px 9px}
 footer{left:22px;right:auto}.city{display:none}
}
@media (prefers-reduced-motion:no-preference){.panel{animation:in .6s ease-out both}@keyframes in{from{opacity:0;transform:translateY(8px)}}}
</style></head>
<body><main class="hero">
<section class="panel" aria-labelledby="titulo">
<div class="brand">${MARK}<span class="word">Speak<span>Dent</span></span></div>
<p class="tag">Gestión clínica para dentistas</p>
<h1 id="titulo">Más tiempo para tus pacientes. <em>Tu consulta, mejor organizada.</em></h1>
<p class="lead">Registra la atención por voz y trabaja con herramientas clínicas para cada especialidad, en una plataforma pensada para dentistas en Chile.</p>
<div class="modules" aria-label="Módulos clínicos"><span>Ortodoncia</span><span>Implantología</span><span>Endodoncia</span><span>Periodoncia</span><span>Odontograma general</span></div>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<form class="mail" method="post" action="${EMAIL_LOGIN_PATH}" data-entrada-correo>
<label class="f" for="correo">Inscríbete o entra con tu correo</label>
<input id="correo" name="correo" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="Tu dirección de correo electrónico" required>
<button class="google" type="submit" name="entrada" value="personal" data-entrada="personal">Entrar a mi consulta</button>
<button class="clinic" type="submit" name="entrada" value="clinica" data-entrada="clinica">${BUILDING}Entrar a una clínica</button>
<label class="own"><input type="checkbox" name="equipo" value="compartido"><span>Es un computador que no es mío (cibercafé, aeropuerto). La sesión se cierra a los 15 minutos sin uso y a las 2 horas.</span></label>
<p class="door-note">Te enviamos un código de 6 dígitos a ese correo y entras con él. No necesitas clave ni cuenta de Google. ¿Una clínica te invitó? Usa «Entrar a una clínica» con el mismo correo.</p>
</form>
<p class="signup-note">¿Primera vez? Al ingresar se crea tu espacio personal de consulta.</p>
<p class="sep" aria-hidden="true">o</p>
<div class="doors">
<a class="alt" href="${LOGIN_PATH}?entrada=personal" data-entrada="personal">${GOOGLE_G}Continuar con Google</a>
<p class="door-note">Con Google la sesión de Google queda abierta en ese navegador. Úsalo solo en tu propio equipo. <a href="${LOGIN_PATH}?entrada=clinica" data-entrada="clinica" style="color:#c9d6ee">Entrar a una clínica con Google</a></p>
</div>
<p class="note">Tu espacio es privado: cada dentista ve solo sus propias fichas.</p>
</section>
<p class="city">Hecho en <b>Santiago de Chile</b></p>
<footer><a href="/acerca">Acerca</a> · <a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a></footer>
</main></body></html>`;
}

/** Pantalla al salir de un equipo compartido: la sesión de SpeakDent ya se cerró; la de Google del navegador la cierra la persona. */
export function sharedLogoutPage(everywhere = false, viaEmail = false): string {
  return `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sesión cerrada · SpeakDent</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6eefc;background:#060a17}
main{max-width:430px}h1{font-size:24px;margin:0 0 8px}p{color:#aebbd4;margin:0 0 14px}
a{display:inline-flex;min-height:44px;align-items:center;padding:0 18px;border-radius:12px;font-weight:600;text-decoration:none;margin:4px 8px 0 0}
.go{background:#fff;color:#1c1530}.back{border:1px solid #475569;color:#e6eefc}</style></head>
<body><main>
<h1>${everywhere ? "Cerraste SpeakDent en todos tus equipos" : "Sesión de SpeakDent cerrada"}</h1>
${viaEmail ? `<p>${everywhere ? "Ya no queda ninguna sesión de SpeakDent abierta con tu correo." : "Entraste con tu correo y su código, así que en este computador no queda abierta ninguna cuenta ni sesión tuya."}</p>
<a class="go" href="/">Volver al inicio</a>
<p style="margin-top:18px;font-size:13px">Si en este computador abriste tu correo para leer el código, ciérralo también.</p>` : `<p>${everywhere ? "Ya no queda ninguna sesión de SpeakDent abierta con tu cuenta. SpeakDent no puede cerrar tu cuenta de Google: si este computador es ajeno, ciérrala también aquí." : "Este era un equipo compartido. Para que nadie más pueda entrar con tu cuenta desde este navegador, cierra también tu sesión de Google."}</p>
<a class="go" href="${GOOGLE_SIGN_OUT_URL}">Cerrar mi sesión de Google</a><a class="back" href="/">Volver al inicio</a>
<p style="margin-top:18px;font-size:13px">Consejo: en un computador ajeno abre una ventana de incógnito; al cerrarla, el navegador olvida todo.</p>`}
</main></body></html>`;
}
