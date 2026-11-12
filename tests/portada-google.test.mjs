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

test("la portada tiene el botón de Google, no refleja texto ajeno y su fondo existe", () => {
  const html = portadaPage();
  assert.match(html, /href="\/auth\/google"/);
  assert.match(html, /Entrar con Google/);
  assert.match(html, /Santiago de Chile/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.match(portadaPage("cancelado"), /Se canceló/);
  const injected = portadaPage("<script>alert(1)</script>");
  assert.doesNotMatch(injected, /<script>alert/);
  assert.match(injected, /No se pudo iniciar sesión/);
  assert.match(PORTADA_CSP, /default-src 'none'/);
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
