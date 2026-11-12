import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveOwner, resolveOwnerWithRegistration } from '../app/access-owners.ts';
import { aboutPage, privacyPage } from '../lib/public-pages.ts';
import * as portada from '../lib/portada-page.ts';
import * as googleLogin from '../lib/google-login.ts';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const ownerId = 'synthetic-owner-id-00001';
const email = 'training@example.test';
const env = { CLINIC_OWNERS: JSON.stringify({ [email]: { ownerId, name: 'Prueba' } }), ACCESS_POLICY_AUD: 'audience-test' };

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
      return Response.json({ owner: request.headers.get('oai-authenticated-user-id'), clinic: request.headers.get('x-clinic-access-owner-id') });
    } } },
    './app/access-owners': { resolveOwner, resolveOwnerWithRegistration },
    './lib/public-pages': { aboutPage, privacyPage },
    './lib/portada-page': portada,
    './lib/google-login': googleLogin,
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
  assert.deepEqual(await accessResponse.json(), { owner: null, clinic: ownerId });
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
  assert.deepEqual(await response.json(), { owner: null, clinic: ownerId });
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
  assert.match(await page.text(), /Entrar con Google/);
  assert.equal(instance.count(), 0);
  const start = await instance.fetch(new Request('https://example.test/auth/google'), googleEnv, {});
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.hostname, 'accounts.google.com');
  assert.match(start.headers.get('set-cookie'), /sd_oauth_state=/);
  const badState = await instance.fetch(new Request('https://example.test/auth/google/callback?code=x&state=otro', { headers: { Cookie: 'sd_oauth_state=esperado' } }), googleEnv, {});
  assert.equal(badState.headers.get('location'), '/?error=vencido');
  const out = await instance.fetch(new Request('https://example.test/auth/salir'), googleEnv, {});
  assert.match(out.headers.get('set-cookie'), /sd_session=; .*Max-Age=0/);
});
