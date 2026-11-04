import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveOwner, resolveOwnerWithRegistration } from '../app/access-owners.ts';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const ownerId = 'synthetic-owner-id-00001';
const email = 'training@example.test';
const env = { CLINIC_OWNERS: JSON.stringify({ [email]: { ownerId, name: 'Prueba' } }), ACCESS_POLICY_AUD: 'audience-test' };

function worker() {
  const exported = {};
  let forwarded = 0;
  const imports = {
    jose: { createRemoteJWKSet: () => ({}), jwtVerify: async () => { throw new Error('invalid token'); } },
    'vinext/server/fetch-handler': { __esModule: true, default: { fetch: async request => {
      forwarded++;
      return Response.json({ owner: request.headers.get('oai-authenticated-user-id'), clinic: request.headers.get('x-clinic-access-owner-id') });
    } } },
    './app/access-owners': { resolveOwner, resolveOwnerWithRegistration },
  };
  runInNewContext(compiled, { exports: exported, require: name => { assert.ok(name in imports, name); return imports[name]; }, Request, Response, Headers, URL, Map, atob, console });
  return { fetch: exported.default.fetch, count: () => forwarded };
}

const request = path => new Request(`https://example.test${path}`, { headers: { 'oai-authenticated-user-id': 'forged-owner', 'x-clinic-access-owner-id': 'forged-owner' } });
const access = (identity, aud = 'audience-test') => ({ access: { aud, getIdentity: async () => identity } });

test('MCP solo recibe el propietario resuelto tras validar Access, no los headers del cliente', async () => {
  const instance = worker();
  const response = await instance.fetch(request('/mcp'), env, access({ email }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { owner: ownerId, clinic: ownerId });
  assert.equal(instance.count(), 1);
});

test('sin Access, con audiencia incorrecta o identidad no autorizada, no se delega al servidor', async () => {
  for (const context of [{}, access({ email }, 'wrong-audience'), access({ email: 'other@example.test' })]) {
    const instance = worker();
    const response = await instance.fetch(request('/mcp'), env, context);
    assert.equal(response.status, 401);
    assert.equal(instance.count(), 0);
  }
});

test('una aserción JWT inválida no permite suplantar la identidad', async () => {
  const instance = worker();
  const payload = Buffer.from(JSON.stringify({ iss: 'https://example.cloudflareaccess.com' })).toString('base64url');
  const req = new Request('https://example.test/mcp', { headers: { 'Cf-Access-Jwt-Assertion': `x.${payload}.x`, 'oai-authenticated-user-id': 'forged-owner' } });
  const response = await instance.fetch(req, env, {});
  assert.equal(response.status, 401);
  assert.equal(instance.count(), 0);
});

test('la cabecera OAI de compatibilidad solo se inyecta en /mcp', async () => {
  const instance = worker();
  const response = await instance.fetch(request('/api/clinical'), env, access({ email }));
  assert.deepEqual(await response.json(), { owner: null, clinic: ownerId });
});
