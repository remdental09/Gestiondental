import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBuildAssetPath, serveBuildAsset, IMMUTABLE_CACHE } from '../lib/build-assets.ts';

// Incidente 22-11: un 404 de /_next/static salía con «immutable» (regla de _headers) y Safari lo guardaba un año:
// la app no arrancaba y quedaba en «Cargando fichas…». Un faltante nunca debe quedar en caché.
const immutable404 = { fetch: async () => new Response(null, { status: 404, headers: { 'Cache-Control': IMMUTABLE_CACHE, ETag: '"x"' } }) };
const found = { fetch: async () => new Response('export{}', { status: 200, headers: { 'Content-Type': 'text/javascript', ETag: '"abc"' } }) };
const req = (path, method = 'GET') => new Request('https://speakdent.cl' + path, { method });

test('reconoce los archivos del build', () => {
  assert.equal(isBuildAssetPath('/_next/static/chunks/index-NGjyt_Y_.js'), true);
  assert.equal(isBuildAssetPath('/es/_next/static/css/app.css'), true);
  assert.equal(isBuildAssetPath('/'), false);
  assert.equal(isBuildAssetPath('/api/clinical'), false);
  assert.equal(isBuildAssetPath('/a/b/_next/static/x.js'), false);
});

test('un archivo del build que falta responde 404 sin caché (nunca immutable)', async () => {
  const response = await serveBuildAsset(req('/_next/static/chunks/page-viejo.js'), immutable404);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('ETag'), null);
});

test('un archivo existente se sirve inmutable con su contenido', async () => {
  const response = await serveBuildAsset(req('/_next/static/chunks/index.js'), found);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), IMMUTABLE_CACHE);
  assert.equal(response.headers.get('Content-Type'), 'text/javascript');
  assert.equal(await response.text(), 'export{}');
});

test('si el asset server falla, 503 sin caché; otros métodos, 405', async () => {
  const broken = await serveBuildAsset(req('/_next/static/chunks/a.js'), { fetch: async () => { throw new Error('caído'); } });
  assert.equal(broken.status, 503);
  assert.equal(broken.headers.get('Cache-Control'), 'no-store');
  assert.equal((await serveBuildAsset(req('/_next/static/chunks/a.js', 'POST'), found)).status, 405);
});

test('la configuración manda /_next/static al Worker (no directo al asset server con la regla immutable)', () => {
  const config = readFileSync(new URL('../wrangler.cloudflare.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"run_worker_first":\s*true/);
  assert.doesNotMatch(config, /!\/_next\/static/);
  const worker = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /isBuildAssetPath\(new URL\(request\.url\)\.pathname\)\) return serveBuildAsset/);
});

test('el arranque de emergencia vuelve a pedir sin caché el archivo que falló antes de recargar', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /fetch\(u,\{cache:"reload"\}\)\.then\(again,again\)/);
});
