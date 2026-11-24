import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { signSession, verifySession, readCookie, cookie, googleAuthUrl, acceptedGoogleProfile, SESSION_COOKIE } from "../lib/google-login.ts";
import { portadaPage, PORTADA_CSP } from "../lib/portada-page.ts";

const SECRET = "secreto-de-prueba";
const later = Date.now() + 60_000;

test("la sesión firmada se acepta y se rechaza si la alteran, vence o cambia el secreto", async () => {
  const token = await signSession({ email: "Dentista@Gmail.com", name: "Dra. Prueba", exp: later }, SECRET);
  const ok = await verifySession(token, SECRET);
  assert.equal(ok?.email, "dentista@gmail.com");
  assert.equal(await verifySession(token, "otro-secreto"), null);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "otro@gmail.com", name: "", exp: later })).toString("base64url");
  assert.equal(await verifySession(forged + "." + sig, SECRET), null);
  assert.equal(await verifySession(body + "." + sig + ".x", SECRET), null);
  const old = await signSession({ email: "a@gmail.com", name: "", exp: Date.now() - 1 }, SECRET);
  assert.equal(await verifySession(old, SECRET), null);
  assert.equal(await verifySession("", SECRET), null);
  assert.equal(await verifySession(token, ""), null);
});

test("cookies de sesión: HttpOnly, Secure, SameSite=Lax y lectura por nombre", () => {
  const value = cookie(SESSION_COOKIE, "abc.def", 100);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Lax/);
  assert.equal(readCookie("x=1; sd_session=abc.def; y=2", SESSION_COOKIE), "abc.def");
  assert.equal(readCookie("sd_session_x=1", SESSION_COOKIE), null);
});

test("Google: solo pide correo y nombre, y exige correo verificado", () => {
  const url = new URL(googleAuthUrl("id-cliente", "https://speakdent.cl/auth/google/callback", "estado"));
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "estado");
  assert.equal(url.searchParams.get("redirect_uri"), "https://speakdent.cl/auth/google/callback");
  assert.deepEqual(acceptedGoogleProfile({ email: "Doc@gmail.com", email_verified: true, name: "Doc" }), { email: "doc@gmail.com", name: "Doc" });
  assert.equal(acceptedGoogleProfile({ email: "doc@gmail.com", email_verified: false }), null);
  assert.equal(acceptedGoogleProfile({ email: "no-es-correo", email_verified: true }), null);
  assert.equal(acceptedGoogleProfile(null), null);
});

test("la portada pide el correo primero, deja Google como opción, no refleja texto ajeno y su fondo existe", () => {
  const html = portadaPage();
  assert.match(html, /<form class="mail" method="post" action="\/auth\/correo"/);
  assert.match(html, /<input id="correo" name="correo" type="email"[^>]*required/);
  assert.match(html, /<button[^>]*name="entrada" value="personal"[^>]*>Entrar a mi consulta/);
  assert.match(html, /<button[^>]*name="entrada" value="clinica"[^>]*>[\s\S]*?Entrar a una clínica/);
  assert.match(html, /href="\/auth\/google\?entrada=personal"[^>]*>[\s\S]*?Continuar con Google/);
  assert.match(html, /href="\/auth\/google\?entrada=clinica"/);
  assert.ok(html.indexOf('action="/auth/correo"') < html.indexOf('href="/auth/google?entrada=personal"'), "el correo va antes que Google");
  assert.match(html, /name="equipo" value="compartido"/);
  assert.match(html, /Santiago de Chile/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.match(portadaPage("cancelado"), /Se canceló/);
  assert.match(portadaPage("correo-invalido"), /correo válido/);
  const injected = portadaPage("<script>alert(1)</script>");
  assert.doesNotMatch(injected, /<script>alert/);
  assert.match(injected, /No se pudo iniciar sesión/);
  assert.match(PORTADA_CSP, /default-src 'none'/);
  assert.match(PORTADA_CSP, /form-action 'self'/);
  assert.ok(existsSync(new URL("../public/portada/fondo.webp", import.meta.url)));
  assert.ok(existsSync(new URL("../public/portada/fondo-movil.webp", import.meta.url)));
});

test("el worker: sesión de Google primero, Access como respaldo, portada sin sesión y salida propia", () => {
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  assert.match(worker, /const fromSession = await sessionOwner/);
  assert.match(worker, /if \(hasAccess\) return accessOwner/);
  assert.match(worker, /wantsPage \? portadaResponse/);
  assert.match(worker, /state !== expected/);
  assert.match(worker, /path\.startsWith\("\/portada\/"\)/);
  assert.match(worker, /const identity = await identify\(request, env, context, false\)/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /href="\/auth\/salir"/);
  assert.doesNotMatch(page, /cdn-cgi\/access\/logout/);
});

test('la portada ofrece equipo compartido con el correo y la pantalla de salida solo pide cerrar Google a quien lo usó', async () => {
  const { sharedLogoutPage } = await import("../lib/portada-page.ts");
  assert.match(portadaPage(), /15 minutos sin uso/);
  assert.match(sharedLogoutPage(), /href="https:\/\/accounts\.google\.com\/Logout"/);
  const viaCorreo = sharedLogoutPage(false, true);
  assert.doesNotMatch(viaCorreo, /accounts\.google\.com/);
  assert.match(viaCorreo, /no queda abierta ninguna cuenta/);
});

test('correo del código: lleva el código, su vencimiento y el aviso si no fuiste tú; el correo se enmascara', async () => {
  const { loginCodeEmail, maskEmail, loginCodePage } = await import("../lib/login-code.ts");
  const mail = loginCodeEmail("048213", new Date(Date.UTC(2026, 10, 23, 17, 5)));
  assert.match(mail.subject, /048213/);
  assert.match(mail.text, /Vence en 10 minutos/);
  assert.match(mail.text, /Si no fuiste tú/);
  assert.doesNotMatch(mail.text + mail.html, /Google/, 'el código sirve para entrar con correo: no habla de Google');
  assert.equal(maskEmail("remdental09@gmail.com"), "re••••••09@gmail.com");
  assert.doesNotMatch(loginCodePage("remdental09@gmail.com"), /remdental09/);
});
