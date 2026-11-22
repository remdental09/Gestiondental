import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveOwner, resolveOwnerWithRegistration } from '../app/access-owners.ts';
import { aboutPage, privacyPage } from '../lib/public-pages.ts';
import * as portada from '../lib/portada-page.ts';
import * as googleLogin from '../lib/google-login.ts';
import * as sessionStore from '../lib/session-store.ts';
import { DatabaseSync } from 'node:sqlite';
import * as clinicTeamDb from '../app/clinic-team-db.ts';
import * as clinicTeam from '../lib/clinic-team.ts';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const ownerId = 'synthetic-owner-id-00001';
const email = 'training@example.test';
const env = { CLINIC_OWNERS: JSON.stringify({ [email]: { ownerId, name: 'Prueba' } }), ACCESS_POLICY_AUD: 'audience-test', ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com' };

function worker() {
  const exported = {};
  let forwarded = 0;
  let handlers;
  const imports = {
    '@cloudflare/workers-oauth-provider': {
      AuthorizationError: class AuthorizationError extends Error {},
      OAuthProvider: class OAuthProviderMock {
        constructor(options) { handlers = options; }
        fetch(request, env, context) { return handlers.defaultHandler.fetch(request, env, context); }
      },
    },
    jose: { createRemoteJWKSet: () => ({}), jwtVerify: async () => { throw new Error('invalid token'); } },
    'vinext/server/fetch-handler': { __esModule: true, default: { fetch: async request => {
      forwarded++;
      return Response.json({ owner: request.headers.get('oai-authenticated-user-id'), clinic: request.headers.get('x-clinic-access-owner-id'), ...(request.headers.get('x-clinic-personal-id') ? { personal: request.headers.get('x-clinic-personal-id'), role: request.headers.get('x-clinic-space-role') } : {}) });
    } } },
    './app/access-owners': { resolveOwner, resolveOwnerWithRegistration },
    './lib/public-pages': { aboutPage, privacyPage },
    './lib/portada-page': portada,
    './lib/google-login': googleLogin,
    './lib/session-store': sessionStore,
    './app/clinic-team-db': clinicTeamDb,
    './lib/clinic-team': clinicTeam,
  };
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Request, Response, Headers, URL, URLSearchParams, Map, atob, btoa, console, crypto, TextEncoder, TextDecoder, Date, fetch: async () => { throw new Error('sin red en pruebas'); } });
  return {
    fetch: (request, requestEnv, context) => exported.default.fetch(request, requestEnv, context),
    mcp: (request, requestEnv, context) => handlers.apiHandler.fetch(request, requestEnv, context),
    count: () => forwarded,
  };
}

const request = path => new Request(`https://example.test${path}`, { headers: { 'oai-authenticated-user-id': 'forged-owner', 'x-clinic-access-owner-id': 'forged-owner' } });
const access = (identity, aud = 'audience-test') => ({ access: { aud, getIdentity: async () => identity } });

test('MCP solo recibe el propietario ligado a la concesión OAuth', async () => {
  const instance = worker();
  const response = await instance.mcp(request('/mcp'), env, { props: { ownerId } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { owner: ownerId, clinic: null });
  assert.equal(instance.count(), 1);
});

test('el handler MCP rechaza una concesión sin propietario', async () => {
  const instance = worker();
  const response = await instance.mcp(request('/mcp'), env, {});
  assert.equal(response.status, 401);
  assert.equal(instance.count(), 0);
});

test('sin Access, con audiencia incorrecta o identidad no autorizada, la aplicación no se delega', async () => {
  for (const context of [{}, access({ email }, 'wrong-audience'), access({ email: 'other@example.test' })]) {
    const instance = worker();
    const response = await instance.fetch(request('/api/clinical'), env, context);
    assert.equal(response.status, 401);
    assert.equal(instance.count(), 0);
  }
});

test('una aserción JWT inválida no permite suplantar la identidad', async () => {
  const instance = worker();
  const payload = Buffer.from(JSON.stringify({ iss: 'https://example.cloudflareaccess.com' })).toString('base64url');
  const req = new Request('https://example.test/api/clinical', { headers: { 'Cf-Access-Jwt-Assertion': `x.${payload}.x`, 'oai-authenticated-user-id': 'forged-owner' } });
  const response = await instance.fetch(req, env, {});
  assert.equal(response.status, 401);
  assert.equal(instance.count(), 0);
});

test('la identidad de Access y la identidad MCP se inyectan solo en sus respectivos handlers', async () => {
  const instance = worker();
  const accessResponse = await instance.fetch(request('/api/clinical'), env, access({ email }));
  assert.deepEqual(await accessResponse.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' });
  const mcpResponse = await instance.mcp(request('/mcp'), env, { props: { ownerId } });
  assert.deepEqual(await mcpResponse.json(), { owner: ownerId, clinic: null });
  assert.equal(instance.count(), 2);
});

test('las páginas /acerca y /privacidad son públicas y no delegan a la aplicación', async () => {
  const w = worker();
  for (const path of ['/acerca', '/privacidad']) {
    const response = await w.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  assert.equal(w.count(), 0);
  const posted = await w.fetch(new Request('https://example.test/privacidad', { method: 'POST' }), env, {});
  assert.equal(posted.status, 401);
});

const googleEnv = { ...env, GOOGLE_DRIVE_CLIENT_ID: 'id-cliente', GOOGLE_DRIVE_CLIENT_SECRET: 'secreto-cliente' };
const sessionCookie = async (sessionEmail, secret = 'google-client:secreto-cliente', exp = Date.now() + 60_000) =>
  'sd_session=' + await googleLogin.signSession({ email: sessionEmail, name: '', exp }, secret);

test('con sesión de Google válida se delega con el propietario de ese correo; nunca con el que mande el navegador', async () => {
  const instance = worker();
  const req = new Request('https://example.test/api/clinical', { headers: { Cookie: await sessionCookie(email), 'x-clinic-access-owner-id': 'forged-owner', 'oai-authenticated-user-id': 'forged-owner' } });
  const response = await instance.fetch(req, googleEnv, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' });
});

test('una sesión falsificada, vencida o firmada con otro secreto no entra', async () => {
  for (const value of [await sessionCookie(email, 'otro-secreto'), await sessionCookie(email, undefined, Date.now() - 1), 'sd_session=basura.firma']) {
    const instance = worker();
    const response = await instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: value } }), googleEnv, {});
    assert.equal(response.status, 401);
    assert.equal(instance.count(), 0);
  }
});

test('sin sesión, una página muestra la portada y no delega; el botón inicia Google con estado', async () => {
  const instance = worker();
  const page = await instance.fetch(new Request('https://example.test/', { headers: { Accept: 'text/html' } }), googleEnv, {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Entrar a mi consulta[\s\S]*Entrar a una clínica/);
  assert.equal(instance.count(), 0);
  const start = await instance.fetch(new Request('https://example.test/auth/google'), googleEnv, {});
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.hostname, 'accounts.google.com');
  assert.match(start.headers.get('set-cookie'), /sd_oauth_state=/);
  assert.match(start.headers.get('set-cookie'), /gd_entrada=personal/, 'sin elegir puerta, se entra a la consulta personal');
  const clinicStart = await instance.fetch(new Request('https://example.test/auth/google?entrada=clinica'), googleEnv, {});
  assert.match(clinicStart.headers.get('set-cookie'), /gd_entrada=clinica/);
  const badState = await instance.fetch(new Request('https://example.test/auth/google/callback?code=x&state=otro', { headers: { Cookie: 'sd_oauth_state=esperado' } }), googleEnv, {});
  assert.equal(badState.headers.get('location'), '/?error=vencido');
  const out = await instance.fetch(new Request('https://example.test/auth/salir'), googleEnv, {});
  assert.match(out.headers.get('set-cookie'), /sd_session=; .*Max-Age=0/);
  const door = await instance.fetch(new Request('https://example.test/auth/entrada?tipo=clinica'), googleEnv, {});
  assert.equal(door.headers.get('location'), '/');
  assert.match(door.headers.get('set-cookie'), /gd_entrada=clinica/);
});

// ---------- Equipo de la clínica: el espacio de datos sale de la membresía guardada, nunca del navegador ----------

const CLINICA = 'clinica-titular-000001';
function fakeDb(rows, { fail = false } = {}) {
  const statement = (sql) => {
    let bound = [];
    const self = {
      bind: (...values) => { bound = values; return self; },
      run: async () => { if (fail) throw new Error('D1 caída'); return {}; },
      first: async () => null,
      all: async () => {
        if (fail) throw new Error('D1 caída');
        if (!/FROM clinic_members WHERE email = \?/.test(sql)) return { results: [] };
        return { results: rows.filter(r => r.email === bound[0] && ['invitada', 'activa'].includes(r.status)) };
      },
    };
    return self;
  };
  return { prepare: statement };
}
const row = (over = {}) => ({ clinic_id: CLINICA, email, role: 'dentista', status: 'activa', invited_by: CLINICA, invited_at: '2026-11-01T00:00:00Z', expires_at: '2026-11-15T00:00:00Z', accepted_at: '2026-11-02T00:00:00Z', revoked_at: null, member_id: ownerId, name: '', ...over });
const clinicReq = async (extraCookie = '', extraHeaders = {}) => new Request('https://example.test/api/clinical', { headers: { Cookie: (await sessionCookie(email)) + extraCookie, ...extraHeaders } });

test('equipo: por «Entrar a una clínica», un miembro activo trabaja en la clínica, con su id personal y su rol', async () => {
  const instance = worker();
  const response = await instance.fetch(await clinicReq('; gd_entrada=clinica'), { ...googleEnv, DB: fakeDb([row()]) }, {});
  assert.deepEqual(await response.json(), { owner: null, clinic: CLINICA, personal: ownerId, role: 'dentista' });
});

test('equipo: por «Entrar a mi consulta» (o sin puerta elegida) nunca se abre la clínica, aunque la cookie la pida', async () => {
  for (const extra of ['; gd_entrada=personal; gd_espacio=' + CLINICA, '; gd_espacio=' + CLINICA, '']) {
    const response = await worker().fetch(await clinicReq(extra), { ...googleEnv, DB: fakeDb([row()]) }, {});
    assert.deepEqual(await response.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' }, extra);
  }
  const forced = await worker().fetch(await clinicReq('; gd_entrada=clinica; gd_espacio=' + encodeURIComponent(ownerId)), { ...googleEnv, DB: fakeDb([row()]) }, {});
  assert.equal((await forced.json()).clinic, CLINICA, 'en la puerta de clínica, la cookie personal no abre la consulta');
});

test('equipo: puede volver a su espacio personal con la cookie; una invitación pendiente no da acceso', async () => {
  const personal = await worker().fetch(await clinicReq('; gd_espacio=' + encodeURIComponent(ownerId)), { ...googleEnv, DB: fakeDb([row()]) }, {});
  assert.equal((await personal.json()).clinic, ownerId);
  const pending = await worker().fetch(await clinicReq(), { ...googleEnv, DB: fakeDb([row({ status: 'invitada', accepted_at: null })]) }, {});
  assert.deepEqual(await pending.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' });
});

test('equipo: revocado, la cookie de la clínica ya no abre sus fichas; ni se puede forjar espacio o rol por cabecera', async () => {
  const revoked = await worker().fetch(await clinicReq('; gd_espacio=' + CLINICA, { 'x-clinic-personal-id': 'forjado', 'x-clinic-space-role': 'admin', 'x-clinic-access-owner-id': CLINICA }), { ...googleEnv, DB: fakeDb([row({ status: 'revocada' })]) }, {});
  assert.deepEqual(await revoked.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' });
});

test('equipo: si la base falla, se trabaja en el espacio personal (nunca en uno ajeno)', async () => {
  const response = await worker().fetch(await clinicReq('; gd_espacio=' + CLINICA), { ...googleEnv, DB: fakeDb([row()], { fail: true }) }, {});
  assert.equal((await response.json()).clinic, ownerId);
});

test('Access falla cerrado si faltan ACCESS_TEAM_DOMAIN o ACCESS_POLICY_AUD', async () => {
  for (const missing of ['ACCESS_TEAM_DOMAIN', 'ACCESS_POLICY_AUD']) {
    const partial = { ...env }; delete partial[missing];
    const instance = worker();
    const response = await instance.fetch(request('/api/clinical'), partial, access({ email }));
    assert.equal(response.status, 503, missing);
    assert.equal(instance.count(), 0);
  }
});

// ---------- Sesiones propias en D1 (Fase 3) ----------
const sqliteDb = () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(sessionStore.AUTH_SESSIONS_DDL); raw.exec(sessionStore.AUTH_RATE_DDL);
  return { raw, prepare: sql => ({ bind: (...values) => ({ first: async () => raw.prepare(sql).get(...values) ?? null, run: async () => raw.prepare(sql).run(...values), all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
};

test('sesión v2 en D1: entra, se revoca al salir y la cookie copiada ya no sirve', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const token = await sessionStore.createSession(DB, { email, name: 'Prueba' });
  const instance = worker();
  const withCookie = (path, init = {}) => new Request(`https://example.test${path}`, { ...init, headers: { Cookie: 'sd_session=' + token, ...(init.headers ?? {}) } });
  const ok = await instance.fetch(withCookie('/api/clinical'), { ...googleEnv, DB }, {});
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { owner: null, clinic: ownerId, personal: ownerId, role: 'titular' });
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_sessions WHERE id = ?').get(await sessionStore.sha256Hex(token)).n, 1, 'solo el hash queda en la base');
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_sessions WHERE id = ?').get(token).n, 0);
  const out = await instance.fetch(withCookie('/auth/salir', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), { ...googleEnv, DB }, {});
  assert.equal(out.status, 302);
  assert.match(out.headers.get('set-cookie'), /sd_session=;/);
  const again = await instance.fetch(withCookie('/api/clinical'), { ...googleEnv, DB }, {});
  assert.equal(again.status, 401);
});

test('salir por un enlace de otro sitio no cierra la sesión (CSRF)', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const token = await sessionStore.createSession(DB, { email, name: '' });
  const instance = worker();
  const out = await instance.fetch(new Request('https://example.test/auth/salir', { headers: { Cookie: 'sd_session=' + token, 'Sec-Fetch-Site': 'cross-site' } }), { ...googleEnv, DB }, {});
  assert.equal(out.headers.get('set-cookie'), null);
  assert.equal(DB.raw.prepare('SELECT revoked_at FROM auth_sessions').get().revoked_at, null);
});

test('una escritura desde otro sitio se rechaza antes de tocar la app (CSRF)', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const token = await sessionStore.createSession(DB, { email, name: '' });
  for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://malicioso.example' }, { Origin: 'null' }]) {
    const instance = worker();
    const response = await instance.fetch(new Request('https://example.test/api/clinical', { method: 'POST', headers: { Cookie: 'sd_session=' + token, ...headers }, body: '{}' }), { ...googleEnv, DB }, {});
    assert.equal(response.status, 403);
    assert.equal(instance.count(), 0);
  }
  const instance = worker();
  const same = await instance.fetch(new Request('https://example.test/api/clinical', { method: 'POST', headers: { Cookie: 'sd_session=' + token, Origin: 'https://example.test', 'Sec-Fetch-Site': 'same-origin' }, body: '{}' }), { ...googleEnv, DB }, {});
  assert.equal(same.status, 200);
});

test('una cookie firmada antigua sigue entrando y se cambia por una sesión v2 en D1 (nadie tiene que volver a entrar)', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const instance = worker();
  const response = await instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: await sessionCookie(email) } }), { ...googleEnv, DB }, {});
  assert.equal(response.status, 200);
  const set = response.headers.get('set-cookie') ?? '';
  assert.match(set, /^sd_session=v2\.[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_sessions').get().n, 1);
});

test('demasiados intentos de inicio de sesión desde una IP → aviso, sin ir a Google', async () => {
  const DB = sqliteDb();
  const instance = worker();
  let last;
  for (let i = 0; i <= sessionStore.LOGIN_LIMIT; i++) last = await instance.fetch(new Request('https://example.test/auth/google', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), { ...googleEnv, DB }, {});
  assert.equal(last.headers.get('location'), '/?error=demasiados');
  const other = await instance.fetch(new Request('https://example.test/auth/google', { headers: { 'CF-Connecting-IP': '203.0.113.10' } }), { ...googleEnv, DB }, {});
  assert.match(other.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_rate_limits WHERE key LIKE ?').get('%203.0.113%').n, 0, 'la IP se guarda solo como hash');
});
