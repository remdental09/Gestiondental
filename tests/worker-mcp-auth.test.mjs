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
import * as rolePolicy from '../lib/role-policy.ts';
import * as buildAssets from '../lib/build-assets.ts';
import * as loginCode from '../lib/login-code.ts';
import * as emailLogin from '../lib/email-login.ts';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const ownerId = 'synthetic-owner-id-00001';
const email = 'training@example.test';
const env = { CLINIC_OWNERS: JSON.stringify({ [email]: { ownerId, name: 'Prueba' } }), ACCESS_POLICY_AUD: 'audience-test', ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com' };

function worker(options = {}) {
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
    './lib/role-policy': rolePolicy,
    './lib/build-assets': buildAssets,
    './lib/login-code': loginCode,
    './lib/email-login': emailLogin,
    './app/login-code-mail': { sendLoginCode: options.sendLoginCode ?? (async () => ({ status: 'sent', from: 'sistema@example.test' })) },
  };
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Request, Response, Headers, URL, URLSearchParams, Map, atob, btoa, console, crypto, TextEncoder, TextDecoder, Date, fetch: options.fetch ?? (async () => { throw new Error('sin red en pruebas'); }) });
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
  const sharedStart = await instance.fetch(new Request('https://example.test/auth/google?entrada=personal&equipo=compartido'), googleEnv, {});
  const sharedCookies = sharedStart.headers.get('set-cookie');
  assert.match(sharedCookies, /sd_oauth_shared=1; .*Max-Age=600/);
  assert.match(sharedCookies, /gd_entrada=personal; Path=\/; HttpOnly; Secure; SameSite=Lax(,|$)/, 'la puerta elegida tampoco persiste en un equipo compartido');
  assert.doesNotMatch(sharedCookies, /gd_entrada=personal;[^,]*Max-Age/);
  assert.match(start.headers.get('set-cookie'), /sd_oauth_shared=; .*Max-Age=0/, 'sin pedirlo, no se marca equipo compartido');
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

const apiReq = async (path, method = 'GET', cookieExtra = '; gd_entrada=clinica') => new Request('https://example.test' + path, { method, headers: { Cookie: (await sessionCookie(email)) + cookieExtra, ...(method !== 'GET' ? { Origin: 'https://example.test', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' } : {}) }, ...(method !== 'GET' ? { body: '{}' } : {}) });

test('roles: Recepción no llega a rutas clínicas (403 en el Worker), sí a agenda, presupuestos y pagos', async () => {
  const db = fakeDb([row({ role: 'recepcion' })]);
  for (const [path, method] of [['/api/anamnesis', 'GET'], ['/api/images/5', 'GET'], ['/api/images', 'POST'], ['/api/dictation/structure', 'POST'], ['/api/documentos', 'GET'], ['/api/endodontics', 'GET'], ['/api/clinical/export', 'GET'], ['/api/box', 'POST'], ['/api/equipo', 'GET', 'x'], ['/api/aranceles', 'PUT'], ['/api/audio-transcription', 'POST'], ['/api/drive/connect', 'GET']]) {
    if (path === '/api/equipo') continue;
    const response = await worker().fetch(await apiReq(path, method), { ...googleEnv, DB: db }, {});
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match((await response.json()).error, /rol/);
  }
  for (const [path, method] of [['/api/clinical', 'GET'], ['/api/clinical', 'POST'], ['/api/agenda-box?from=2026-11-01&to=2026-11-02', 'GET'], ['/api/agenda-box', 'POST'], ['/api/asistencia', 'PUT'], ['/api/dashboard', 'GET'], ['/api/presupuesto/pdf', 'GET'], ['/api/lista-espera', 'POST'], ['/api/equipo', 'POST']]) {
    const response = await worker().fetch(await apiReq(path, method), { ...googleEnv, DB: db }, {});
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal((await response.json()).role, 'recepcion');
  }
});

test('roles: Asistente lee la ficha y sube imágenes, pero no cobra, no dicta ni configura', async () => {
  const db = fakeDb([row({ role: 'asistente' })]);
  for (const [path, method] of [['/api/clinical', 'GET'], ['/api/images/5', 'GET'], ['/api/images', 'POST'], ['/api/anamnesis', 'GET'], ['/api/asistencia', 'PUT'], ['/api/agenda-box', 'POST']]) {
    assert.equal((await worker().fetch(await apiReq(path, method), { ...googleEnv, DB: db }, {})).status, 200, `${method} ${path}`);
  }
  for (const [path, method] of [['/api/anamnesis', 'POST'], ['/api/dashboard', 'GET'], ['/api/presupuesto/enviar', 'POST'], ['/api/dictation/structure', 'POST'], ['/api/box', 'POST'], ['/api/images/5', 'DELETE'], ['/api/documentos/emitir', 'POST'], ['/api/lista-espera', 'POST']]) {
    assert.equal((await worker().fetch(await apiReq(path, method), { ...googleEnv, DB: db }, {})).status, 403, `${method} ${path}`);
  }
});

test('roles: el titular y el dentista colaborador no tienen restricciones nuevas', async () => {
  for (const role of ['dentista', 'admin']) {
    const response = await worker().fetch(await apiReq('/api/anamnesis', 'POST'), { ...googleEnv, DB: fakeDb([row({ role })]) }, {});
    assert.equal(response.status, 200, role);
  }
  const personal = await worker().fetch(await apiReq('/api/dictation/structure', 'POST', ''), { ...googleEnv, DB: fakeDb([row({ role: 'recepcion' })]) }, {});
  assert.equal((await personal.json()).role, 'titular', 'en su propia consulta nadie es recepción');
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

test('los archivos del build van directo al asset server sin sesión, y un faltante no queda en caché', async () => {
  const instance = worker();
  const assets = { fetch: async request => new URL(request.url).pathname.endsWith('existe.js') ? new Response('ok', { status: 200 }) : new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }) };
  const ok = await instance.fetch(new Request('https://speakdent.cl/_next/static/chunks/existe.js'), { ...env, ASSETS: assets }, {});
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('Cache-Control'), /immutable/);
  const missing = await instance.fetch(new Request('https://speakdent.cl/_next/static/chunks/falta.js'), { ...env, ASSETS: assets }, {});
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  assert.equal(instance.count(), 0);
});

test('salir de un equipo compartido muestra cómo cerrar también Google; salir-todo revoca todas las sesiones', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const shared = await sessionStore.createSession(DB, { email, name: '' }, Date.now(), true);
  const own = await sessionStore.createSession(DB, { email, name: '' });
  const instance = worker();
  const out = await instance.fetch(new Request('https://example.test/auth/salir', { headers: { Cookie: 'sd_session=' + shared, 'Sec-Fetch-Site': 'same-origin' } }), { ...googleEnv, DB }, {});
  assert.equal(out.status, 200);
  assert.match(await out.text(), /accounts\.google\.com\/Logout/);
  assert.match(out.headers.get('set-cookie'), /sd_session=; .*Max-Age=0/);
  assert.equal(out.headers.get('cache-control'), 'no-store');
  const everywhere = await instance.fetch(new Request('https://example.test/auth/salir-todo', { headers: { Cookie: 'sd_session=' + own, 'Sec-Fetch-Site': 'same-origin' } }), { ...googleEnv, DB }, {});
  assert.equal(everywhere.status, 200);
  assert.match(await everywhere.text(), /todos tus equipos[\s\S]*accounts\.google\.com\/Logout/);
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_sessions WHERE revoked_at IS NULL').get().n, 0);
  const cross = await instance.fetch(new Request('https://example.test/auth/salir-todo', { headers: { Cookie: 'sd_session=' + await sessionStore.createSession(DB, { email, name: '' }), 'Sec-Fetch-Site': 'cross-site' } }), { ...googleEnv, DB }, {});
  assert.equal(cross.headers.get('set-cookie'), null);
  assert.equal(DB.raw.prepare('SELECT count(*) n FROM auth_sessions WHERE revoked_at IS NULL').get().n, 1, 'un enlace de otro sitio no cierra sesiones');
});

test('en equipo compartido las respuestas de la app no se guardan en la caché del navegador', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const shared = await sessionStore.createSession(DB, { email, name: '' }, Date.now(), true);
  const instance = worker();
  const res = await instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: 'sd_session=' + shared } }), { ...googleEnv, DB }, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

// ---------- Código de ingreso por correo ----------
test('entrar con Google deja la sesión pendiente y manda un código al correo; sin el código no hay acceso', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const sent = [];
  const googleFetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok' });
    if (u.includes('openidconnect')) return Response.json({ email, email_verified: true, name: 'Prueba' });
    throw new Error('red inesperada: ' + u);
  };
  const instance = worker({ fetch: googleFetch, sendLoginCode: async (to, code, owners) => { sent.push({ to, code, owners }); return { status: 'sent', from: 'x@example.test' }; } });
  const env2 = { ...googleEnv, DB, DEVELOPER_EMAILS: email };
  const callback = await instance.fetch(new Request('https://example.test/auth/google/callback?code=c&state=s', { headers: { Cookie: 'sd_oauth_state=s' } }), env2, {});
  assert.equal(callback.headers.get('location'), '/auth/codigo');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.match(sent[0].code, /^\d{6}$/);
  assert.ok(sent[0].owners.includes(ownerId));
  const token = /sd_session=(v2\.[^;]+)/.exec(callback.headers.get('set-cookie'))[1];
  const withCookie = (path, init = {}) => new Request(`https://example.test${path}`, { ...init, headers: { Cookie: 'sd_session=' + token, ...(init.headers ?? {}) } });
  const api = await instance.fetch(withCookie('/api/clinical'), env2, {});
  assert.equal(api.status, 401, 'sin código, la API no responde datos');
  const page = await instance.fetch(withCookie('/', { headers: { Accept: 'text/html' } }), env2, {});
  assert.equal(page.headers.get('location'), '/auth/codigo');
  const codePage = await instance.fetch(withCookie('/auth/codigo'), env2, {});
  const html = await codePage.text();
  assert.match(html, /autocomplete="one-time-code"/);
  assert.doesNotMatch(html, new RegExp(email), 'el correo se muestra enmascarado');
  const wrongCode = sent[0].code === '000000' ? '111111' : '000000';
  const wrong = await instance.fetch(withCookie('/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: wrongCode }) }), env2, {});
  assert.equal(wrong.status, 400);
  assert.equal(codePage.headers.get('referrer-policy'), 'same-origin', 'con no-referrer el formulario llegaría con Origin: null');
  // Como lo envía Chrome desde la pantalla del código: mismo sitio y Origin «null».
  const right = await instance.fetch(withCookie('/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: sent[0].code }), headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'null' } }), env2, {});
  assert.equal(right.status, 302);
  assert.equal(right.headers.get('location'), '/');
  const after = await instance.fetch(withCookie('/api/clinical'), env2, {});
  assert.equal(after.status, 200);
});

test('código: cinco errores cierran la sesión; reenviar respeta la espera; reenviar nunca salta el código', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const instance = worker();
  const env2 = { ...googleEnv, DB };
  const token = await sessionStore.createSession(DB, { email, name: '' }, Date.now(), false, true);
  await sessionStore.setLoginCode(DB, token, '123456');
  const post = (path, body) => instance.fetch(new Request('https://example.test' + path, { method: 'POST', body: new URLSearchParams(body), headers: { Cookie: 'sd_session=' + token } }), env2, {});
  const resend = await post('/auth/codigo/reenviar', {});
  assert.match(await resend.text(), /Espera unos segundos/);
  for (let i = 0; i < 4; i++) assert.equal((await post('/auth/codigo', { codigo: '654321' })).status, 400);
  const last = await post('/auth/codigo', { codigo: '654321' });
  assert.equal(last.headers.get('location'), '/?error=codigo');
  assert.equal((await post('/auth/codigo', { codigo: '123456' })).headers.get('location'), '/?error=codigo', 'después del bloqueo ni el código correcto sirve');
  const cross = await instance.fetch(new Request('https://example.test/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: '1' }), headers: { Cookie: 'sd_session=' + token, 'Sec-Fetch-Site': 'cross-site' } }), env2, {});
  assert.equal(cross.headers.get('location'), '/');

  // Reenviar nunca salta el código, aunque no haya cómo enviarlo.
  const open = worker({ sendLoginCode: async () => ({ status: 'no-sender' }) });
  const pending = await sessionStore.createSession(DB, { email, name: '' }, Date.now() - 60_000, false, true);
  const r = await open.fetch(new Request('https://example.test/auth/codigo/reenviar', { method: 'POST', headers: { Cookie: 'sd_session=' + pending } }), env2, {});
  assert.equal(r.status, 200);
  assert.match(await r.text(), /No pudimos enviar el código/);
  sessionStore.forgetCachedSessions();
  assert.equal((await sessionStore.readSession(DB, pending)).pending, true);
});

test('solo entrar con Google, sin ningún Gmail para enviar el código (app sin configurar), entra sin código', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const googleFetch = async (url) => String(url).includes('oauth2.googleapis.com/token') ? Response.json({ access_token: 'tok' }) : Response.json({ email, email_verified: true, name: 'Prueba' });
  const open = worker({ fetch: googleFetch, sendLoginCode: async () => ({ status: 'no-sender' }) });
  const callback = await open.fetch(new Request('https://example.test/auth/google/callback?code=c&state=s', { headers: { Cookie: 'sd_oauth_state=s' } }), { ...googleEnv, DB }, {});
  assert.equal(callback.headers.get('location'), '/');
});

// ---------- Entrada con correo (sin Google) ----------

const openEnv = (DB) => ({ ...googleEnv, DB, CLINIC_OPEN_REGISTRATION: 'true' });
const same = { 'Sec-Fetch-Site': 'same-origin', Origin: 'null' };
const emailPost = (instance, DB, body, headers = {}, extra = {}) =>
  instance.fetch(new Request('https://example.test/auth/correo', { method: 'POST', body: new URLSearchParams(body), headers: { ...same, ...headers } }), { ...openEnv(DB), ...extra }, {});

test('la portada pide el correo primero, permite el formulario y deja Google como opción', async () => {
  const instance = worker();
  const out = await instance.fetch(new Request('https://example.test/', { headers: { Accept: 'text/html' } }), googleEnv, {});
  const html = await out.text();
  assert.match(html, /action="\/auth\/correo"/);
  assert.match(html, /Continuar con Google/);
  assert.equal(out.headers.get('referrer-policy'), 'same-origin', 'con no-referrer el formulario llegaría con Origin: null');
  assert.equal(instance.count(), 0);
});

test('entrar con un correo cualquiera: llega un código, sin él no hay acceso y con él se entra; Google nunca interviene', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const sent = [];
  const instance = worker({ sendLoginCode: async (to, code, owners) => { sent.push({ to, code, owners }); return { status: 'sent', from: 'codigo@speakdent.cl' }; }, fetch: async (u) => { throw new Error('no debe usar la red: ' + u); } });
  const out = await emailPost(instance, DB, { correo: '  Colega@Outlook.com ', entrada: 'personal' });
  assert.equal(out.headers.get('location'), '/auth/codigo');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'colega@outlook.com', 'correo normalizado');
  assert.match(sent[0].code, /^\d{6}$/);
  const cookies = out.headers.get('set-cookie');
  const token = /sd_session=(v2\.[^;]+)/.exec(cookies)[1];
  assert.match(cookies, /sd_via=correo/);
  assert.doesNotMatch(cookies, /accounts\.google/);
  const withCookie = (path, init = {}) => new Request('https://example.test' + path, { ...init, headers: { Cookie: 'sd_session=' + token, ...(init.headers ?? {}) } });
  const env2 = openEnv(DB);
  assert.equal((await instance.fetch(withCookie('/api/clinical'), env2, {})).status, 401, 'sin el código la API no responde');
  const page = await instance.fetch(withCookie('/', { headers: { Accept: 'text/html' } }), env2, {});
  assert.equal(page.headers.get('location'), '/auth/codigo');
  const codeHtml = await (await instance.fetch(withCookie('/auth/codigo'), env2, {})).text();
  assert.doesNotMatch(codeHtml, /colega@outlook/, 'el correo se muestra enmascarado');
  const wrong = await instance.fetch(withCookie('/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: sent[0].code === '000000' ? '111111' : '000000' }), headers: same }), env2, {});
  assert.equal(wrong.status, 400);
  const right = await instance.fetch(withCookie('/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: sent[0].code }), headers: same }), env2, {});
  assert.equal(right.headers.get('location'), '/');
  assert.equal((await instance.fetch(withCookie('/api/clinical'), env2, {})).status, 200);
});

test('con correo escrito el código nunca se salta: si no se puede enviar, no se entra', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  for (const result of [{ status: 'no-sender' }, { status: 'failed', reason: 'x' }]) {
    const instance = worker({ sendLoginCode: async () => result });
    const out = await emailPost(instance, DB, { correo: 'otro' + result.status.length + '@outlook.com', entrada: 'personal' });
    assert.equal(out.headers.get('location'), '/auth/codigo?m=envio');
    const token = /sd_session=(v2\.[^;]+)/.exec(out.headers.get('set-cookie'))[1];
    sessionStore.forgetCachedSessions();
    assert.equal((await sessionStore.readSession(DB, token)).pending, true);
    assert.equal((await instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: 'sd_session=' + token } }), openEnv(DB), {})).status, 401);
    const resend = await instance.fetch(new Request('https://example.test/auth/codigo/reenviar', { method: 'POST', headers: { Cookie: 'sd_session=' + token, ...same } }), openEnv(DB), {});
    assert.equal(resend.status, 200);
    sessionStore.forgetCachedSessions();
    assert.equal((await sessionStore.readSession(DB, token)).pending, true, 'reenviar tampoco la abre');
  }
});

test('el correo escrito no revela si la cuenta existe: misma respuesta, y sin acceso no se envía nada', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const sent = [];
  const instance = worker({ sendLoginCode: async (to) => { sent.push(to); return { status: 'sent', from: 'codigo@speakdent.cl' }; } });
  const known = await emailPost(instance, DB, { correo: email, entrada: 'personal' });
  const closed = await emailPost(instance, DB, { correo: 'desconocido@outlook.com', entrada: 'personal' }, {}, { CLINIC_OPEN_REGISTRATION: 'false' });
  assert.equal(known.headers.get('location'), '/auth/codigo');
  assert.equal(closed.headers.get('location'), '/auth/codigo', 'misma pantalla exista o no la cuenta');
  assert.deepEqual(sent, [email], 'a quien no tiene acceso no se le envía nada');
  const token = /sd_session=(v2\.[^;]+)/.exec(closed.headers.get('set-cookie'))[1];
  const api = await instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: 'sd_session=' + token } }), { ...openEnv(DB), CLINIC_OPEN_REGISTRATION: 'false' }, {});
  assert.equal(api.status, 401);
});

test('correo escrito: rechaza otro sitio y correos inválidos, y limita los códigos por correo y por conexión', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const sent = [];
  const instance = worker({ sendLoginCode: async (to) => { sent.push(to); return { status: 'sent', from: 'codigo@speakdent.cl' }; } });
  const cross = await emailPost(instance, DB, { correo: 'a@outlook.com' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(cross.headers.get('location'), '/');
  assert.equal(sent.length, 0);
  for (const bad of ['', 'sin-arroba', 'a@b.cl, c@d.cl']) assert.equal((await emailPost(instance, DB, { correo: bad })).headers.get('location'), '/?error=correo-invalido');
  assert.equal(sent.length, 0);
  const outcomes = [];
  for (let i = 0; i < 7; i++) outcomes.push((await emailPost(instance, DB, { correo: 'victima@outlook.com' }, { 'CF-Connecting-IP': '198.51.100.' + i })).headers.get('location'));
  assert.deepEqual(outcomes.slice(0, 5), Array(5).fill('/auth/codigo'));
  assert.deepEqual(outcomes.slice(5), Array(2).fill('/?error=demasiados'), 'desde 7 conexiones distintas, a un mismo correo solo llegan 5');
  assert.equal(sent.filter(x => x === 'victima@outlook.com').length, 5);
  const byIp = [];
  for (let i = 0; i <= sessionStore.LOGIN_LIMIT; i++) byIp.push((await emailPost(instance, DB, { correo: 'persona' + i + '@outlook.com' }, { 'CF-Connecting-IP': '203.0.113.50' })).headers.get('location'));
  assert.equal(byIp.at(-1), '/?error=demasiados', 'una sola conexión tampoco puede pedir códigos sin tope');
});

test('equipo compartido con correo: sesión del navegador, 2 horas, aviso de leer el código en el celular y salida sin pedir cerrar Google', async () => {
  sessionStore.forgetCachedSessions();
  const DB = sqliteDb();
  const sent = [];
  const instance = worker({ sendLoginCode: async (to, code) => { sent.push(code); return { status: 'sent', from: 'codigo@speakdent.cl' }; } });
  const out = await emailPost(instance, DB, { correo: 'viaje@outlook.com', entrada: 'clinica', equipo: 'compartido' });
  const raw = out.headers.get('set-cookie');
  assert.match(raw, /sd_session=v2\.[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax(,|$)/, 'sin Max-Age: se borra al cerrar el navegador');
  assert.doesNotMatch(/sd_session=[^,]*/.exec(raw)[0], /Max-Age/);
  const token = /sd_session=(v2\.[^;]+)/.exec(raw)[1];
  const env2 = openEnv(DB);
  const html = await (await instance.fetch(new Request('https://example.test/auth/codigo', { headers: { Cookie: 'sd_session=' + token } }), env2, {})).text();
  assert.match(html, /lee el código en tu celular/);
  await instance.fetch(new Request('https://example.test/auth/codigo', { method: 'POST', body: new URLSearchParams({ codigo: sent[0] }), headers: { Cookie: 'sd_session=' + token, ...same } }), env2, {});
  sessionStore.forgetCachedSessions();
  const row = await sessionStore.readSession(DB, token);
  assert.equal(row.shared, true);
  const bye = await instance.fetch(new Request('https://example.test/auth/salir', { headers: { Cookie: 'sd_session=' + token + '; sd_via=correo', 'Sec-Fetch-Site': 'same-origin' } }), env2, {});
  const byeHtml = await bye.text();
  assert.doesNotMatch(byeHtml, /accounts\.google\.com/, 'quien entró con correo no tiene una sesión de Google que cerrar');
  assert.match(bye.headers.get('set-cookie'), /sd_via=; .*Max-Age=0/);
});

test('2 h 30 sin uso: desde el celular la sesión sigue abierta; desde un computador pide entrar de nuevo', async () => {
  const DB = sqliteDb();
  const instance = worker();
  const agent = { iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  const open = async userAgent => {
    sessionStore.forgetCachedSessions();
    const token = await sessionStore.createSession(DB, { email, name: '' }, Date.now() - 2.5 * 3_600_000);
    return instance.fetch(new Request('https://example.test/api/clinical', { headers: { Cookie: 'sd_session=' + token, 'User-Agent': userAgent } }), openEnv(DB), {});
  };
  assert.equal((await open(agent.iphone)).status, 200);
  assert.equal((await open(agent.windows)).status, 401);
});

