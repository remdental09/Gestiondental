import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeEmail, EMAIL_LIMIT_SHORT, EMAIL_LIMIT_DAY } from "../lib/email-login.ts";
import { loginCodePage } from "../lib/login-code.ts";
import { AUTH_SESSIONS_DDL, AUTH_RATE_DDL, createSession, readSession, setLoginCode, verifyLoginCode, newLoginCode, allowLogin, forgetCachedSessions, CODE_MAX_ATTEMPTS, PENDING_MS } from "../lib/session-store.ts";

const sqliteDb = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(AUTH_SESSIONS_DDL); raw.exec(AUTH_RATE_DDL);
  return { raw, prepare: sql => ({ bind: (...v) => ({ first: async () => raw.prepare(sql).get(...v) ?? null, run: async () => raw.prepare(sql).run(...v) }) }) };
};
const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
const fn = (name) => {
  const start = worker.indexOf("async function " + name);
  assert.ok(start >= 0, name + " existe");
  const next = worker.indexOf("\nasync function ", start + 10);
  const nextPlain = worker.indexOf("\nfunction ", start + 10);
  return worker.slice(start, Math.min(...[next, nextPlain].filter(i => i > 0)));
};

test("el correo se normaliza y se rechaza lo que no es un solo correo", () => {
  assert.equal(normalizeEmail("  Dentista@Outlook.COM "), "dentista@outlook.com");
  assert.equal(normalizeEmail("nombre.apellido@clinica.cl"), "nombre.apellido@clinica.cl");
  assert.equal(normalizeEmail("dr+prueba@gmail.com"), "dr+prueba@gmail.com");
  for (const bad of ["", "sin-arroba", "a@b", "a@@b.cl", "a b@c.cl", "a@b.cl, otro@b.cl", "a@b.cl;otro@b.cl", "<a@b.cl>", "a@b.cl\nBcc: x@y.cl", "a@.cl", "a@b..cl", "x".repeat(250) + "@b.cl", null, undefined, 5, {}]) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
  }
});

test("flujo completo con correo escrito: la sesión nace pendiente, no da acceso y solo el código la abre", async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 24, 15);
  const email = normalizeEmail("Colega@Outlook.com");
  const token = await createSession(db, { email, name: "" }, t0, false, true);
  assert.equal((await readSession(db, token, t0 + 1))?.pending, true, "pendiente: sin acceso");
  const code = newLoginCode();
  assert.ok(await setLoginCode(db, token, code, t0));
  assert.equal(await verifyLoginCode(db, token, code === "000000" ? "111111" : "000000", t0 + 5_000), "wrong");
  assert.equal(await verifyLoginCode(db, token, code, t0 + 10_000), "ok");
  forgetCachedSessions();
  const opened = await readSession(db, token, t0 + 20_000);
  assert.equal(opened?.pending, false);
  assert.equal(opened?.session.email, "colega@outlook.com");
});

test("sin código no se entra: vence a los 15 min, se bloquea a los 5 errores y el código sirve una sola vez", async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 24, 15);
  const idle = await createSession(db, { email: "a@b.cl", name: "" }, t0, false, true);
  forgetCachedSessions();
  assert.equal(await readSession(db, idle, t0 + PENDING_MS + 1), null, "pendiente vencida: no entra");
  const locked = await createSession(db, { email: "a@b.cl", name: "" }, t0, false, true);
  await setLoginCode(db, locked, "123456", t0);
  let last;
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) last = await verifyLoginCode(db, locked, "654321", t0 + 1000 + i);
  assert.equal(last, "locked");
  forgetCachedSessions();
  assert.equal(await readSession(db, locked, t0 + 9000), null, "tras 5 errores la sesión muere, aunque luego se escriba el código bueno");
  assert.equal(await verifyLoginCode(db, locked, "123456", t0 + 9000), "expired");
});

test("el correo no puede usarse para llenar la bandeja de otra persona: 5 cada 10 min y 15 al día, aparte de la conexión", async () => {
  const db = sqliteDb();
  const now = Date.UTC(2026, 10, 24, 15);
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await allowLogin(db, "correo10:victima@b.cl", now, EMAIL_LIMIT_SHORT.limit, EMAIL_LIMIT_SHORT.windowMs));
  assert.deepEqual(results, [true, true, true, true, true, false, false]);
  assert.equal(await allowLogin(db, "correo10:otra@b.cl", now, EMAIL_LIMIT_SHORT.limit, EMAIL_LIMIT_SHORT.windowMs), true, "otro correo no se ve afectado");
  const day = [];
  for (let i = 0; i < 17; i++) day.push(await allowLogin(db, "correo24:victima@b.cl", now, EMAIL_LIMIT_DAY.limit, EMAIL_LIMIT_DAY.windowMs));
  assert.equal(day.filter(Boolean).length, EMAIL_LIMIT_DAY.limit);
});

test("worker: la entrada con correo exige código, no se salta nunca y responde igual exista o no la cuenta", () => {
  const start = fn("startEmailLogin");
  assert.match(start, /crossSiteWrite\(request\)/, "protegida contra formularios de otro sitio");
  assert.match(start, /normalizeEmail\(form\?\.get\("correo"\)\)/);
  assert.match(start, /allowLogin\(db, clientIp\(request\)\)[\s\S]*emailQuotaOk\(db, email\)/, "límite por conexión y por correo");
  assert.match(start, /createSession\(db, \{ email, name: "" \}, Date\.now\(\), shared, true\)/, "nace pendiente");
  assert.doesNotMatch(start, /confirmWithoutCode/);
  assert.doesNotMatch(start, /deliverLoginCode\([^)]*true\)/, "no puede saltarse el código");
  assert.doesNotMatch(start, /sin-acceso/, "no revela si la cuenta existe");
  assert.match(start, /VIA_COOKIE, "correo"/);
  assert.match(worker, /path === EMAIL_LOGIN_PATH && request\.method === "POST"\) return startEmailLogin/);
  // Solo el primer ingreso con Google puede saltarse el código, y solo si no hay cómo enviarlo.
  assert.equal([...worker.matchAll(/deliverLoginCode\([^)]*, true\)/g)].length, 1);
  assert.match(worker, /result\.status === "no-sender" && allowSkip/);
  const resend = fn("loginCodeRoute");
  assert.doesNotMatch(resend, /deliverLoginCode\([^)]*true\)/);
  assert.doesNotMatch(resend, /sin-acceso/);
  assert.match(resend, /emailQuotaOk\(db, email\)/, "reenviar también cuenta contra el tope del correo");
});

test("la portada permite el formulario (Referrer-Policy same-origin) y entrar con Google limpia la marca «correo»", () => {
  const portada = worker.indexOf("function portadaResponse");
  assert.ok(portada > 0);
  assert.match(worker.slice(portada, portada + 600), /Referrer-Policy", "same-origin"/);
  assert.match(worker, /cookie\(VIA_COOKIE, "", 0\)/);
});

test("la pantalla del código avisa en equipo compartido que se lea en el celular", () => {
  assert.match(loginCodePage("colega@outlook.com", null, true), /lee el código en tu celular/);
  assert.doesNotMatch(loginCodePage("colega@outlook.com", null, false), /lee el código en tu celular/);
  assert.doesNotMatch(loginCodePage("colega@outlook.com"), /colega@/, "el correo va enmascarado");
});
