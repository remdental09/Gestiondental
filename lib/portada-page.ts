/** Portada pública de speakdent.cl: presentación y botón «Entrar con Google». No muestra ni pide datos clínicos. */
import { LOGIN_PATH } from "./google-login.ts";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export const PORTADA_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const MARK = `<svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><path d="M13 8c-4 0-7 3.2-7 8 0 4.6 1.6 7.4 2.6 11.6.8 3.4 1.4 6.4 3.4 6.4 2.4 0 2.2-4.2 3.6-7.2.8-1.6 1.6-2.4 2.4-2.4s1.6.8 2.4 2.4c1.4 3 1.2 7.2 3.6 7.2 2 0 2.6-3 3.4-6.4C32.4 23.4 34 20.6 34 16c0-4.8-3-8-7-8-3 0-4.4 1.6-7 1.6S16 8 13 8z" fill="none" stroke="#5eead4" stroke-width="2.2" stroke-linejoin="round"/><path d="M2 20h5l2-5 3 10 3-7 2 2h2M38 20h-3" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/></svg>`;

/** Mensajes de error conocidos; cualquier otro código muestra un texto genérico (nunca se refleja texto del usuario). */
const ERRORS: Record<string, string> = {
  cancelado: "Se canceló el inicio de sesión con Google.",
  vencido: "El inicio de sesión tardó demasiado. Vuelve a intentarlo.",
  "no-verificado": "Esa cuenta de Google no tiene el correo verificado.",
  "sin-acceso": "Esa cuenta no tiene acceso. Escríbenos si eres dentista y quieres usar SpeakDent.",
  configuracion: "El inicio de sesión aún se está configurando. Intenta más tarde.",
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
.panel{position:relative;width:min(470px,100%);margin-left:clamp(20px,7vw,110px);padding:28px 0}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:22px;letter-spacing:.2px;color:#fff}
.brand .word span{color:#5eead4}
.tag{margin:6px 0 0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc}
h1{margin:34px 0 14px;font-size:clamp(32px,4.2vw,50px);line-height:1.08;font-weight:700;color:#fff}
h1 em{font-style:normal;background:linear-gradient(90deg,#5eead4,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:0 0 30px;font-size:18px;color:#b9c6e0;max-width:420px}
.google{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:0 26px;border-radius:12px;
 background:#fff;color:#1f2937;font-weight:600;font-size:16px;text-decoration:none;box-shadow:0 10px 30px rgba(56,189,248,.18),0 0 0 1px rgba(255,255,255,.1)}
.google:hover{background:#f1f5f9}
.google:focus-visible{outline:3px solid #5eead4;outline-offset:3px}
.note{margin:16px 0 0;font-size:13px;color:#8b9bb8;max-width:400px}
.error{margin:0 0 18px;padding:10px 14px;border-radius:10px;border:1px solid rgba(251,146,60,.5);background:rgba(124,45,18,.35);color:#fed7aa;font-size:14px}
ul{list-style:none;margin:34px 0 0;padding:0;display:grid;gap:10px;font-size:15px;color:#cbd5e1}
li{display:flex;gap:10px;align-items:baseline}li::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:#5eead4;box-shadow:0 0 10px #5eead4;transform:translateY(-2px)}
footer{position:absolute;right:clamp(16px,4vw,40px);bottom:18px;font-size:12px;color:#94a3b8;z-index:1}
footer a{color:#94a3b8}
.city{position:absolute;left:clamp(20px,7vw,110px);bottom:18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;z-index:1}
.city b{color:#f59e0b;font-weight:600}
@media (max-width:760px){
 .hero{align-items:flex-end;background-image:url(/portada/fondo-movil.webp);background-position:center top}
 .hero::before{background:linear-gradient(180deg,rgba(6,10,23,.1) 0%,rgba(6,10,23,.15) 42%,rgba(6,10,23,.9) 60%,#060a17 74%)}
 .panel{margin:0;padding:0 22px 76px}
 h1{margin-top:22px}.lead{font-size:16px;margin-bottom:22px}
 .google{width:100%}
 ul{display:none}
 footer{left:22px;right:auto}.city{display:none}
}
@media (prefers-reduced-motion:no-preference){.panel{animation:in .6s ease-out both}@keyframes in{from{opacity:0;transform:translateY(8px)}}}
</style></head>
<body><main class="hero">
<section class="panel" aria-labelledby="titulo">
<div class="brand">${MARK}<span class="word">Speak<span>Dent</span></span></div>
<p class="tag">Ficha dental por voz</p>
<h1 id="titulo">Dicta la atención. <em>La ficha se escribe sola.</em></h1>
<p class="lead">Evolución, odontograma y presupuesto a partir de tu voz. Hecho para dentistas en Chile.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<a class="google" href="${LOGIN_PATH}">${GOOGLE_G}Entrar con Google</a>
<p class="note">Entras con tu cuenta de Google (Gmail). Cada dentista ve solo sus propias fichas.</p>
<ul><li>Dictado clínico que propone y tú confirmas</li><li>Odontograma con nomenclatura FDI y chilena</li><li>Respaldo en tu propio Google Drive</li></ul>
</section>
<p class="city">Hecho en <b>Santiago de Chile</b></p>
<footer><a href="/acerca">Acerca</a> · <a href="/privacidad">Privacidad</a></footer>
</main></body></html>`;
}
