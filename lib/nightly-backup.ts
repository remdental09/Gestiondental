/**
 * Respaldo nocturno a un bucket R2 separado (gestion-dental-respaldos):
 *  - D1: una copia JSON (una línea por fila, gzip) de cada tabla, una vez por día, 30 días de retención.
 *  - R2: copia incremental de las imágenes (solo lo nuevo o cambiado), por tramos en cada pasada.
 * Es una tarea del sistema (todas las cuentas), por eso no filtra por owner_id; nada sale de Cloudflare.
 * Restaurar: `wrangler r2 object get gestion-dental-respaldos/d1/AAAA-MM-DD/<tabla>.jsonl.gz --remote`.
 * D1 además tiene Time Travel (restauración a un minuto exacto) incluido por Cloudflare.
 */
type Obj = { key: string; etag?: string; size?: number; customMetadata?: Record<string, string> };
export type BackupBucket = {
  head(key: string): Promise<Obj | null>;
  get(key: string): Promise<(Obj & { body: ReadableStream; httpMetadata?: Record<string, unknown> }) | null>;
  put(key: string, value: unknown, options?: { httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> }): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string }): Promise<{ objects: Obj[]; truncated: boolean; cursor?: string; delimitedPrefixes?: string[] }>;
  delete(keys: string | string[]): Promise<void>;
};
export type BackupDb = { prepare(sql: string): { bind(...values: unknown[]): { all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } } };
export type BackupEnv = { DB: BackupDb; BUCKET?: BackupBucket; BACKUP_BUCKET?: BackupBucket };

/**
 * Tablas que no se respaldan: internas, efímeras (sesiones, límites de intentos) o con credenciales de Google/correo
 * (si hubiera que restaurar, se vuelve a conectar la cuenta; así ninguna llave queda copiada en otro bucket).
 */
const SKIP = /^(sqlite_|_cf_|d1_migrations$|auth_sessions$|auth_rate_limits$|google_calendar_connections$|google_drive_connections$|mail_senders$|signature_unlock$)/;
const PAGE = 500;
export const RETENTION_DAYS = 30;

const chileDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function dumpD1(db: BackupDb, bucket: BackupBucket, day: string): Promise<{ day: string; tables: Record<string, number> } | { day: string; skipped: "ya existe" }> {
  const manifestKey = `d1/${day}/manifest.json`;
  if (await bucket.head(manifestKey)) return { day, skipped: "ya existe" };
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").bind().all<{ name: string }>();
  const tables: Record<string, number> = {};
  for (const { name } of results) {
    if (SKIP.test(name)) continue;
    const lines: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.prepare(`SELECT * FROM ${quote(name)} LIMIT ? OFFSET ?`).bind(PAGE, offset).all();
      for (const row of page.results) lines.push(JSON.stringify(row));
      if (page.results.length < PAGE) break;
    }
    tables[name] = lines.length;
    await bucket.put(`d1/${day}/${name}.jsonl.gz`, await gzip(lines.join("\n")), { httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" } });
  }
  // El manifiesto va al final: si existe, la copia del día está completa.
  await bucket.put(manifestKey, JSON.stringify({ day, createdAt: new Date().toISOString(), tables }), { httpMetadata: { contentType: "application/json" } });
  return { day, tables };
}

/** Borra las copias de D1 de más de RETENTION_DAYS días. */
export async function pruneD1(bucket: BackupBucket, day: string): Promise<number> {
  const limit = new Date(`${day}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - RETENTION_DAYS);
  const oldest = limit.toISOString().slice(0, 10);
  const listing = await bucket.list({ prefix: "d1/", delimiter: "/" });
  let removed = 0;
  for (const prefix of listing.delimitedPrefixes ?? []) {
    const folder = prefix.slice(3, 13);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(folder) || folder >= oldest) continue;
    const objects = await bucket.list({ prefix });
    const keys = objects.objects.map((object) => object.key);
    if (keys.length) { await bucket.delete(keys); removed += keys.length; }
  }
  return removed;
}

/** Copia incremental de R2: retoma donde quedó (cursor guardado) y copia solo lo nuevo o cambiado. */
export async function copyImages(source: BackupBucket, target: BackupBucket, options: { maxObjects?: number; maxBytes?: number } = {}): Promise<{ revisadas: number; copiadas: number; terminado: boolean }> {
  const maxObjects = options.maxObjects ?? 300;
  const maxBytes = options.maxBytes ?? 80 * 1024 * 1024;
  type CursorState = { cursor?: string };
  const state: CursorState = await target.get("r2/_cursor.json").then((object): Promise<CursorState> | CursorState => object ? new Response(object.body).json() as Promise<CursorState> : {}).catch(() => ({}));
  let cursor = state.cursor || undefined;
  let checked = 0, copied = 0, bytes = 0, done = false;
  while (checked < maxObjects && bytes < maxBytes) {
    const page = await source.list({ cursor, limit: Math.min(100, maxObjects - checked) });
    for (const object of page.objects) {
      checked += 1;
      const existing = await target.head(`r2/${object.key}`);
      if (existing?.customMetadata?.sourceEtag === object.etag) continue;
      const original = await source.get(object.key);
      if (!original) continue;
      await target.put(`r2/${object.key}`, original.body, { httpMetadata: original.httpMetadata, customMetadata: { ...(original.customMetadata ?? {}), sourceEtag: object.etag ?? "" } });
      copied += 1;
      bytes += object.size ?? 0;
    }
    if (!page.truncated) { cursor = undefined; done = true; break; }
    cursor = page.cursor;
  }
  await target.put("r2/_cursor.json", JSON.stringify({ cursor: cursor ?? "" }), { httpMetadata: { contentType: "application/json" } });
  return { revisadas: checked, copiadas: copied, terminado: done };
}

export async function runNightlyBackup(env: BackupEnv, now = new Date()) {
  const target = env.BACKUP_BUCKET;
  if (!target) return { skipped: "sin BACKUP_BUCKET" };
  const day = chileDay(now);
  const d1 = await dumpD1(env.DB, target, day);
  const pruned = await pruneD1(target, day);
  const images = env.BUCKET ? await copyImages(env.BUCKET, target) : { skipped: "sin BUCKET" };
  return { ok: true, d1, borradas: pruned, imagenes: images };
}
