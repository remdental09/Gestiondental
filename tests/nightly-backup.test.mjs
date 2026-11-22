import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyImages, dumpD1, pruneD1, runNightlyBackup } from "../lib/nightly-backup.ts";

function memoryBucket(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, { body: value, etag: `e-${value}`, size: String(value).length, customMetadata: {} }]));
  const ops = { put: 0, get: 0 };
  const text = async (body) => typeof body === "string" ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : new Response(body).text();
  return {
    store, ops,
    async head(key) { const o = store.get(key); return o ? { key, etag: o.etag, size: o.size, customMetadata: o.customMetadata } : null; },
    async get(key) { ops.get++; const o = store.get(key); if (!o) return null; return { key, etag: o.etag, body: new Response(o.body).body, customMetadata: o.customMetadata, httpMetadata: {} }; },
    async put(key, value, options = {}) { ops.put++; const body = await text(value); store.set(key, { body, etag: `e-${typeof body === "string" ? body : body.length}`, size: body.length, customMetadata: options.customMetadata ?? {} }); },
    async list({ prefix = "", cursor, limit = 1000, delimiter } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (delimiter) {
        const prefixes = [...new Set(keys.map((k) => k.slice(prefix.length)).filter((k) => k.includes(delimiter)).map((k) => prefix + k.slice(0, k.indexOf(delimiter) + 1)))];
        return { objects: [], truncated: false, delimitedPrefixes: prefixes };
      }
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return { objects: slice.map((key) => ({ key, etag: store.get(key).etag, size: store.get(key).size })), truncated, cursor: truncated ? String(start + limit) : undefined };
    },
    async delete(keys) { for (const key of [].concat(keys)) store.delete(key); },
  };
}

function fakeDb(tables) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      return { bind(...values) { queries.push(sql); return { async all() {
        if (sql.includes("sqlite_master")) return { results: Object.keys(tables).map((name) => ({ name })) };
        const name = sql.match(/FROM "([^"]+)"/)[1];
        const [limit, offset] = values;
        return { results: tables[name].slice(offset, offset + limit) };
      } }; } };
    },
  };
}

test("D1: una copia por tabla, sin sesiones ni credenciales, y el manifiesto al final", async () => {
  const bucket = memoryBucket();
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: i, owner_id: "a" }));
  const db = fakeDb({ patients: rows, auth_sessions: [{ id: "x" }], google_drive_connections: [{ refresh: "secreto" }], sqlite_sequence: [], d1_migrations: [] });
  const result = await dumpD1(db, bucket, "2026-11-21");
  assert.deepEqual(result.tables, { patients: 1203 });
  assert.ok(bucket.store.has("d1/2026-11-21/patients.jsonl.gz"));
  assert.ok(!bucket.store.has("d1/2026-11-21/auth_sessions.jsonl.gz"));
  assert.ok(!bucket.store.has("d1/2026-11-21/google_drive_connections.jsonl.gz"));
  assert.equal([...bucket.store.keys()].at(-1), "d1/2026-11-21/manifest.json");
  // Segunda pasada del mismo día: no repite.
  assert.deepEqual(await dumpD1(db, bucket, "2026-11-21"), { day: "2026-11-21", skipped: "ya existe" });
});

test("retención: borra copias de más de 30 días", async () => {
  const bucket = memoryBucket({ "d1/2026-10-01/manifest.json": "x", "d1/2026-10-01/patients.jsonl.gz": "y", "d1/2026-11-01/manifest.json": "z", "r2/a.jpg": "img" });
  assert.equal(await pruneD1(bucket, "2026-11-21"), 2);
  assert.deepEqual([...bucket.store.keys()].sort(), ["d1/2026-11-01/manifest.json", "r2/a.jpg"]);
});

test("imágenes: copia incremental por tramos y no repite lo ya copiado", async () => {
  const seed = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`u/${i}.jpg`, `img${i}`]));
  const source = memoryBucket(seed);
  const target = memoryBucket();
  const first = await copyImages(source, target, { maxObjects: 4 });
  assert.deepEqual(first, { revisadas: 4, copiadas: 4, terminado: false });
  const second = await copyImages(source, target, { maxObjects: 4 });
  assert.equal(second.copiadas, 3);
  assert.equal(second.terminado, true);
  for (const key of Object.keys(seed)) assert.ok(target.store.has(`r2/${key}`), key);
  const third = await copyImages(source, target, { maxObjects: 10 });
  assert.equal(third.copiadas, 0);
});

test("sin bucket de respaldo no hace nada; con él respalda D1 e imágenes", async () => {
  assert.deepEqual(await runNightlyBackup({ DB: fakeDb({}) }), { skipped: "sin BACKUP_BUCKET" });
  const result = await runNightlyBackup({ DB: fakeDb({ patients: [{ id: 1 }] }), BUCKET: memoryBucket({ "a.jpg": "1" }), BACKUP_BUCKET: memoryBucket() }, new Date("2026-11-22T02:10:00Z"));
  assert.equal(result.ok, true);
  assert.equal(result.d1.day, "2026-11-21");
  assert.equal(result.imagenes.copiadas, 1);
});

// El binding BACKUP_BUCKET se agrega cuando el token de despliegue tenga permiso sobre gestion-dental-respaldos;
// mientras tanto la tarea queda inactiva (devuelve «sin BACKUP_BUCKET»).
test("tarea en el cron nocturno", () => {
  const scheduled = readFileSync(new URL("../app/scheduled.ts", import.meta.url), "utf8");
  assert.match(scheduled, /cron === BACKUP_CRON\) \{\s*const \{ runNightlyBackup \}/);
});
