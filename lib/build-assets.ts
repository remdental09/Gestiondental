/**
 * Archivos del build (`/_next/static/…`, con hash en el nombre). Pasan por el Worker para que solo una respuesta
 * correcta quede en caché «para siempre». Antes el asset server respondía también los 404 con
 * `Cache-Control: immutable` (regla de `_headers`), y si Safari pedía un archivo justo durante un despliegue
 * (HTML nuevo, archivos aún no visibles) se quedaba con ese 404 un año: la app no arrancaba y la pantalla
 * seguía en «Cargando fichas…» aunque se recargara o se volviera a iniciar sesión.
 */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const NO_STORE = "no-store";

/** ¿Es un archivo del build? (también bajo un prefijo, p. ej. `/x/_next/static/…`). */
export function isBuildAssetPath(path: string): boolean {
  return /^(?:\/[^/]+)?\/_next\/static\//.test(path);
}

type AssetFetcher = { fetch(request: Request): Promise<Response> };

/** Sirve un archivo del build: inmutable solo si existe; un faltante (404, error) nunca se guarda en caché. */
export async function serveBuildAsset(request: Request, assets: AssetFetcher): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": NO_STORE } });
  let response: Response;
  try {
    response = await assets.fetch(request);
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": NO_STORE } });
  }
  const headers = new Headers(response.headers);
  const ok = response.status === 200 || response.status === 304 || response.status === 206;
  headers.set("Cache-Control", ok ? IMMUTABLE_CACHE : NO_STORE);
  if (!ok) headers.delete("ETag");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
