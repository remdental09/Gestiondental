/** Portada pública de speakdent.cl: presentación cinematográfica, propuesta gratuita y acceso seguro por correo o Google. No muestra ni pide datos clínicos. */
import { LOGIN_PATH, EMAIL_LOGIN_PATH, GOOGLE_SIGN_OUT_URL } from "./google-login.ts";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export const PORTADA_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const BUILDING = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M10 9h4M12 7v4"/></svg>`;
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const CHECK = `<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="#5eead4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.6 3.6L15.5 6.8"/></svg>`;

const MARK = `<svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#99f6e4"/><stop offset="55%" stop-color="#5eead4"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient></defs><path d="M13 8c-4 0-7 3.2-7 8 0 4.6 1.6 7.4 2.6 11.6.8 3.4 1.4 6.4 3.4 6.4 2.4 0 2.2-4.2 3.6-7.2.8-1.6 1.6-2.4 2.4-2.4s1.6.8 2.4 2.4c1.4 3 1.2 7.2 3.6 7.2 2 0 2.6-3 3.4-6.4C32.4 23.4 34 20.6 34 16c0-4.8-3-8-7-8-3 0-4.4 1.6-7 1.6S16 8 13 8z" fill="none" stroke="url(#sdg)" stroke-width="2.3" stroke-linejoin="round"/><path d="M2 20h5l2-5 3 10 3-7 2 2h2M38 20h-3" fill="none" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/></svg>`;

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
<title>SpeakDent · Ficha clínica odontológica por voz · Acceso gratuito</title>
<meta name="description" content="Ficha clínica odontológica por voz para dentistas en Chile. Uso gratuito con 500 MB incluidos: dicta la atención y SpeakDent arma la evolución y el odontograma.">
<meta name="theme-color" content="#050814">
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#050814}
body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;color:#e6eefc;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.hero{position:relative;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;isolation:isolate;background:#050814}
.backdrop{position:absolute;inset:0;z-index:-2;background:#050814 url(/portada/fondo.webp) 64% center/cover no-repeat;transform-origin:68% 48%;will-change:transform}
.scrim{position:absolute;inset:0;z-index:-1;pointer-events:none;
 background:
  radial-gradient(900px 540px at 14% 22%,rgba(45,212,191,.10),transparent 65%),
  radial-gradient(760px 460px at 82% 48%,rgba(56,189,248,.09),transparent 70%),
  linear-gradient(180deg,rgba(5,8,20,.72) 0%,rgba(5,8,20,.12) 18%,rgba(5,8,20,.14) 80%,rgba(5,8,20,.88) 100%),
  linear-gradient(90deg,rgba(5,8,20,.97) 0%,rgba(5,8,20,.92) 28%,rgba(5,8,20,.72) 44%,rgba(5,8,20,.22) 62%,rgba(5,8,20,.04) 78%)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px clamp(20px,5.5vw,84px) 0;z-index:1}
.brand{display:inline-flex;align-items:center;gap:11px;font-weight:750;font-size:22px;letter-spacing:-.015em;color:#fff;text-decoration:none}
.brand .word span{background:linear-gradient(90deg,#5eead4,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand-sub{display:none;font-size:12px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;padding-left:12px;border-left:1px solid rgba(148,163,184,.25)}
@media (min-width:680px){.brand-sub{display:inline}}
.top-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 13px;border-radius:999px;border:1px solid rgba(94,234,212,.32);background:rgba(8,20,38,.68);backdrop-filter:blur(12px);font-size:12.5px;font-weight:600;color:#ccfbf1;letter-spacing:.01em;box-shadow:0 8px 24px rgba(2,6,23,.4)}
.dot{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399}
.stage{width:100%;padding:18px clamp(20px,5.5vw,84px) 24px;display:flex;align-items:center;flex:1;z-index:1}
.panel{position:relative;width:min(520px,100%)}
.free-badge{display:inline-flex;align-items:center;gap:9px;padding:6px 14px 6px 10px;border-radius:999px;
 background:linear-gradient(90deg,rgba(16,185,129,.20),rgba(56,189,248,.16));
 border:1px solid rgba(94,234,212,.45);color:#ecfdf5;font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
 box-shadow:0 0 28px rgba(45,212,191,.16),inset 0 1px 0 rgba(255,255,255,.15)}
.free-badge b{padding:2px 8px;border-radius:999px;background:#10b981;color:#042f2e;font-size:11px;letter-spacing:.08em}
h1{margin:16px 0 12px;font-size:clamp(31px,3.7vw,48px);line-height:1.06;letter-spacing:-.028em;font-weight:780;color:#f8fafc;text-shadow:0 12px 34px rgba(2,6,23,.6)}
h1 em{font-style:normal;display:block;margin-top:2px;background:linear-gradient(92deg,#99f6e4 0%,#5eead4 45%,#38bdf8 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:0 0 16px;font-size:16.5px;line-height:1.55;color:#cbd5e1;max-width:480px}
.lead strong{color:#f0fdfa;font-weight:650}
.perks{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 16px;padding:0;list-style:none;font-size:13.5px;color:#dbeafe}
.perks li{display:inline-flex;align-items:center;gap:6px;font-weight:500}
.modules{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 20px;max-width:500px}
.modules span{padding:6px 11px;border:1px solid rgba(125,211,252,.22);border-radius:999px;background:rgba(15,23,42,.62);backdrop-filter:blur(8px);color:#e0f2fe;font-size:12.5px;font-weight:500;line-height:1.2;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.modules span:last-child{border-color:rgba(94,234,212,.38);color:#99f6e4}
.card{position:relative;border-radius:20px;padding:22px;
 background:linear-gradient(180deg,rgba(15,23,42,.80) 0%,rgba(8,13,27,.88) 100%);
 border:1px solid rgba(148,163,184,.20);
 box-shadow:0 26px 64px rgba(2,6,23,.72),0 0 0 1px rgba(15,23,42,.5),inset 0 1px 0 rgba(255,255,255,.10);
 backdrop-filter:blur(20px) saturate(140%);-webkit-backdrop-filter:blur(20px) saturate(140%)}
.card::before{content:"";position:absolute;top:0;left:24px;right:24px;height:1px;background:linear-gradient(90deg,transparent,rgba(94,234,212,.65),rgba(56,189,248,.65),transparent)}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.mail{display:grid;gap:11px}
.mail label.f{font-size:14.5px;font-weight:650;color:#f1f5f9}
.free-pill{font-size:12px;font-weight:600;color:#5eead4}
.mail input[type=email]{width:100%;min-height:48px;padding:0 15px;border-radius:12px;border:1px solid rgba(148,163,184,.34);
 background:rgba(6,11,25,.82);color:#fff;font-size:15.5px;transition:border-color .18s,box-shadow .18s}
.mail input[type=email]::placeholder{color:#64748b}
.mail input[type=email]:hover{border-color:rgba(148,163,184,.55)}
.mail input[type=email]:focus-visible{outline:none;border-color:#5eead4;box-shadow:0 0 0 3px rgba(94,234,212,.22)}
.btn-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mail button{cursor:pointer;font-family:inherit;border:0;transition:transform .15s,box-shadow .18s,background .18s}
.google{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:0 18px;border-radius:12px;
 background:linear-gradient(180deg,#ffffff 0%,#e2e8f0 100%);color:#0f172a;font-weight:700;font-size:15px;text-decoration:none;
 box-shadow:0 10px 28px rgba(56,189,248,.22),inset 0 1px 0 #fff}
.google:hover{background:linear-gradient(180deg,#f8fafc 0%,#cbd5e1 100%);box-shadow:0 14px 32px rgba(94,234,212,.28)}
.google:focus-visible{outline:3px solid #5eead4;outline-offset:2px}
.clinic{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:0 16px;border-radius:12px;
 background:rgba(251,146,60,.08);color:#fff;font-weight:650;font-size:15px;text-decoration:none;border:1px solid rgba(251,146,60,.58)}
.mail button.clinic{border:1px solid rgba(251,146,60,.58)}
.clinic:hover{background:rgba(251,146,60,.18);border-color:rgba(251,146,60,.85)}
.clinic:focus-visible{outline:3px solid #fb923c;outline-offset:2px}
.own{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:#94a3b8;margin-top:2px}
.own input{margin-top:2px;width:16px;height:16px;flex:none;accent-color:#2dd4bf}
.door-note{margin:0;font-size:12.5px;line-height:1.45;color:#94a3b8}
.signup-note{margin:10px 0 0;padding:8px 12px;border-radius:10px;background:rgba(16,185,129,.10);border:1px solid rgba(94,234,212,.22);color:#99f6e4;font-size:12.5px;line-height:1.4}
.sep{display:flex;align-items:center;gap:12px;margin:14px 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
.sep::before,.sep::after{content:"";flex:1;height:1px;background:rgba(148,163,184,.2)}
.doors{display:grid;gap:9px}
.alt{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:46px;padding:0 20px;border-radius:12px;
 background:rgba(255,255,255,.05);color:#f8fafc;font-weight:600;font-size:14.5px;text-decoration:none;border:1px solid rgba(255,255,255,.18);transition:background .18s,border-color .18s}
.alt:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.32)}
.alt:focus-visible{outline:3px solid #5eead4;outline-offset:2px}
.clinic-link{color:#cbd5e1;font-weight:500;text-underline-offset:3px}
.clinic-link:hover{color:#fff}
.note{margin:12px 0 0;font-size:12.5px;color:#94a3b8}
.error{margin:0 0 14px;padding:10px 14px;border-radius:12px;border:1px solid rgba(251,146,60,.55);background:rgba(124,45,18,.45);color:#fed7aa;font-size:13.5px}
.bottombar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;padding:8px clamp(20px,5.5vw,84px) 20px;z-index:1;font-size:12px;color:#94a3b8}
.city{margin:0;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8}
.city b{color:#fbbf24;font-weight:650}
footer a{color:#cbd5e1;text-decoration:none;transition:color .15s}
footer a:hover{color:#5eead4;text-decoration:underline;text-underline-offset:3px}
@media (max-width:760px){
 .backdrop{background-image:url(/portada/fondo-movil.webp);background-position:center top;background-size:100% auto}
 .scrim{background:linear-gradient(180deg,rgba(5,8,20,.42) 0%,rgba(5,8,20,.12) 15%,rgba(5,8,20,.88) 34%,#050814 46%)}
 .topbar{padding:16px 20px 0}
 .top-pill{display:none}
 .stage{align-items:flex-end;padding:190px 18px 18px}
 .panel{width:100%}
 h1{font-size:30px;margin-top:14px}
 .lead{font-size:15.5px}
 .card{padding:18px;border-radius:18px}
 .btn-row{grid-template-columns:1fr}
 .google,.clinic,.alt{width:100%}
 .modules{gap:6px}.modules span{font-size:12px;padding:5px 9px}
 .bottombar{padding:4px 20px 22px}
}
@media (prefers-reduced-motion:no-preference){
 .backdrop{animation:cinemaZoom 18s cubic-bezier(.22,1,.36,1) both}
 .r1{animation:rise .65s cubic-bezier(.22,1,.36,1) .04s both}
 .r2{animation:rise .7s cubic-bezier(.22,1,.36,1) .14s both}
 .r3{animation:rise .75s cubic-bezier(.22,1,.36,1) .24s both}
 .dot{animation:pulseDot 2.8s ease-in-out infinite}
 @keyframes cinemaZoom{from{transform:scale(1.055)}to{transform:scale(1)}}
 @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
 @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.88)}}
}
</style></head>
<body><main class="hero">
<div class="backdrop" aria-hidden="true"></div>
<div class="scrim" aria-hidden="true"></div>
<header class="topbar">
<div class="brand">${MARK}<span class="word">Speak<span>Dent</span></span><span class="brand-sub">Ficha clínica por voz</span></div>
<div class="top-pill"><span class="dot" aria-hidden="true"></span>Uso gratuito para odontólogos</div>
</header>
<div class="stage">
<section class="panel" aria-labelledby="titulo">
<div class="r1">
<div class="free-badge"><b>GRATIS</b><span>Acceso libre · 500 MB clínicos incluidos</span></div>
<h1 id="titulo">Más tiempo para tus pacientes. <em>Tu consulta, mejor organizada.</em></h1>
<p class="lead">Dicta la atención por voz y SpeakDent redacta la evolución y actualiza el odontograma. <strong>Úsala gratis y sin suscripción</strong> en tu consulta.</p>
</div>
<div class="r2">
<ul class="perks" aria-label="Beneficios del acceso gratuito">
<li>${CHECK}100 % gratis, sin tarjeta</li>
<li>${CHECK}500 MB para radiografías y fotos</li>
<li>${CHECK}Espacio privado por dentista</li>
</ul>
<div class="modules" aria-label="Módulos clínicos"><span>Ortodoncia</span><span>Implantología</span><span>Endodoncia</span><span>Periodoncia</span><span>Odontograma general</span></div>
</div>
<div class="card r3">
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<form class="mail" method="post" action="${EMAIL_LOGIN_PATH}" data-entrada-correo>
<div class="card-head">
<label class="f" for="correo">Crea tu cuenta gratis o entra con tu correo</label>
<span class="free-pill">Sin clave · Código de 6 dígitos</span>
</div>
<input id="correo" name="correo" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="nombre@consulta.cl" required>
<div class="btn-row">
<button class="google" type="submit" name="entrada" value="personal" data-entrada="personal">Entrar a mi consulta</button>
<button class="clinic" type="submit" name="entrada" value="clinica" data-entrada="clinica">${BUILDING}Entrar a una clínica</button>
</div>
<label class="own"><input type="checkbox" name="equipo" value="compartido"><span>Es un computador que no es mío (cibercafé, aeropuerto). La sesión se cierra a los 15 minutos sin uso y a las 2 horas.</span></label>
<p class="door-note">Recibirás un código de 6 dígitos en tu correo para entrar sin contraseña. Si una clínica te invitó, elige «Entrar a una clínica» con ese mismo correo.</p>
</form>
<p class="signup-note"><strong>¿Primera vez?</strong> Al ingresar se activa gratis tu espacio personal con 500 MB de almacenamiento clínico incluidos.</p>
<p class="sep" aria-hidden="true">o</p>
<div class="doors">
<a class="alt" href="${LOGIN_PATH}?entrada=personal" data-entrada="personal">${GOOGLE_G}Continuar con Google</a>
<p class="door-note">Con Google la sesión queda abierta en este navegador (úsalo solo en tu equipo). <a class="clinic-link" href="${LOGIN_PATH}?entrada=clinica" data-entrada="clinica">Entrar a una clínica con Google</a></p>
</div>
</div>
<p class="note">Privacidad clínica garantizada: cada profesional accede únicamente a sus propias fichas.</p>
</section>
</div>
<div class="bottombar">
<p class="city">Hecho en <b>Santiago de Chile</b></p>
<footer><a href="/acerca">Acerca</a> · <a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a></footer>
</div>
</main></body></html>`;
}

/** Pantalla al salir de un equipo compartido: la sesión de SpeakDent ya se cerró; la de Google del navegador la cierra la persona. */
export function sharedLogoutPage(everywhere = false, viaEmail = false): string {
  return `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sesión cerrada · SpeakDent</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6eefc;background:#050814}
main{max-width:440px;padding:28px;border-radius:20px;background:rgba(15,23,42,.82);border:1px solid rgba(148,163,184,.2);box-shadow:0 24px 60px rgba(2,6,23,.65)}h1{font-size:24px;margin:0 0 10px}p{color:#aebbd4;margin:0 0 14px}
a{display:inline-flex;min-height:44px;align-items:center;padding:0 18px;border-radius:12px;font-weight:600;text-decoration:none;margin:4px 8px 0 0}
.go{background:#fff;color:#0f172a}.back{border:1px solid #475569;color:#e6eefc}</style></head>
<body><main>
<h1>${everywhere ? "Cerraste SpeakDent en todos tus equipos" : "Sesión de SpeakDent cerrada"}</h1>
${viaEmail ? `<p>${everywhere ? "Ya no queda ninguna sesión de SpeakDent abierta con tu correo." : "Entraste con tu correo y su código, así que en este computador no queda abierta ninguna cuenta ni sesión tuya."}</p>
<a class="go" href="/">Volver al inicio</a>
<p style="margin-top:18px;font-size:13px">Si en este computador abriste tu correo para leer el código, ciérralo también.</p>` : `<p>${everywhere ? "Ya no queda ninguna sesión de SpeakDent abierta con tu cuenta. SpeakDent no puede cerrar tu cuenta de Google: si este computador es ajeno, ciérrala también aquí." : "Este era un equipo compartido. Para que nadie más pueda entrar con tu cuenta desde este navegador, cierra también tu sesión de Google."}</p>
<a class="go" href="${GOOGLE_SIGN_OUT_URL}">Cerrar mi sesión de Google</a><a class="back" href="/">Volver al inicio</a>
<p style="margin-top:18px;font-size:13px">Consejo: en un computador ajeno abre una ventana de incógnito; al cerrarla, el navegador olvida todo.</p>`}
</main></body></html>`;
}
