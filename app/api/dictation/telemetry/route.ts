import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  aggregateDictationHealthInput,
  parseDictationHealthEvent,
  summarizeDictationHealth,
  type DictationHealthEvent,
  type DictationHealthStoredRow,
} from "@/lib/dictation/health-telemetry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
type Db = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
};
const config = env as unknown as { DB?: Db; CLINIC_OWNER_ID?: string };
const MAX_BODY_BYTES = 12 * 1024;
const MAX_EVENTS_PER_POST = 32;
const RETENTION_DAYS = 30;
// A single constant scope keeps tenant and professional identifiers out of the aggregate table.
const TELEMETRY_SCOPE = "application";
const CREATE_TABLE = "CREATE TABLE IF NOT EXISTS dictation_health_daily (" +
  "owner_id TEXT NOT NULL, day TEXT NOT NULL, stage TEXT NOT NULL, event TEXT NOT NULL, " +
  "platform TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT 'none', " +
  "duration_bucket TEXT NOT NULL DEFAULT 'none', count INTEGER NOT NULL DEFAULT 0, " +
  "PRIMARY KEY (owner_id, day, stage, event, platform, error_code, duration_bucket))";
const CREATE_INDEX = "CREATE INDEX IF NOT EXISTS dictation_health_daily_day_idx ON dictation_health_daily (day)";
const UPSERT = "INSERT INTO dictation_health_daily " +
  "(owner_id, day, stage, event, platform, error_code, duration_bucket, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(owner_id, day, stage, event, platform, error_code, duration_bucket) " +
  "DO UPDATE SET count = dictation_health_daily.count + excluded.count";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
let schemaReady: Promise<void> | null = null;

async function ensureTelemetrySchema(db: Db): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.prepare(CREATE_TABLE).run();
      await db.prepare(CREATE_INDEX).run();
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function santiagoDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function retentionCutoff(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(year, month - 1, day));
  cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
  return cutoff.toISOString().slice(0, 10);
}

async function authenticatedUser() {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: json({ error: "Inicia sesión." }, 401) };
  return { user };
}

async function ownerUser() {
  const auth = await authenticatedUser();
  if ("error" in auth) return auth;
  const owner = config.CLINIC_OWNER_ID?.trim();
  if (!owner || auth.user.userId !== owner || (auth.user.personalId && auth.user.personalId !== owner)) return { error: json({ error: "Solo el titular de la aplicación puede ver esta telemetría." }, 403) };
  return { ...auth, owner };
}

async function boundedRequestText(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

function parseBatch(raw: unknown): DictationHealthEvent[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const rawEvents = Object.hasOwn(body, "events")
    ? Object.keys(body).length === 1 && Array.isArray(body.events) ? body.events : null
    : [raw];
  if (!rawEvents || rawEvents.length < 1 || rawEvents.length > MAX_EVENTS_PER_POST) return null;
  const events = rawEvents.map(parseDictationHealthEvent);
  return events.every((event): event is DictationHealthEvent => event !== null) ? events : null;
}

/** El cliente solo envía enumeraciones y duraciones acotadas; D1 recibe únicamente conteos agregados. */
export async function POST(request: Request) {
  const auth = await authenticatedUser();
  if ("error" in auth) return auth.error;
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Envía eventos JSON." }, 415);
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const bodyText = await boundedRequestText(request);
  if (bodyText === null) return json({ error: "Solicitud vacía o demasiado grande." }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return json({ error: "Solicitud inválida." }, 400); }
  const events = parseBatch(parsed);
  if (!events) return json({ error: `Envía entre 1 y ${MAX_EVENTS_PER_POST} eventos enumerados.` }, 400);

  const day = santiagoDay(new Date());
  const cutoff = retentionCutoff(day);
  const grouped = aggregateDictationHealthInput(events);
  const statements = grouped.map(row => db.prepare(UPSERT).bind(TELEMETRY_SCOPE, day, row.stage, row.event, row.platform, row.errorCode, row.durationBucket, row.count));
  // Toda escritura de la petición y la depuración de vencidos es una sola operación D1.
  statements.push(db.prepare("DELETE FROM dictation_health_daily WHERE day < ?").bind(cutoff));
  try {
    await ensureTelemetrySchema(db);
    await db.batch(statements);
    return json({ ok: true, accepted: events.length }, 202);
  } catch {
    return json({ error: "No se pudo registrar la telemetría." }, 503);
  }
}

/** GET protegido al titular; la respuesta contiene conteos diarios por etapa, nunca eventos individuales. */
export async function GET() {
  const auth = await ownerUser();
  if ("error" in auth) return auth.error;
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const today = santiagoDay(new Date());
  const cutoff = retentionCutoff(today);
  try {
    await ensureTelemetrySchema(db);
    await db.prepare("DELETE FROM dictation_health_daily WHERE day < ?").bind(cutoff).run();
    const rows = (await db.prepare(
      "SELECT day, stage, event, platform, error_code AS errorCode, duration_bucket AS durationBucket, count " +
      "FROM dictation_health_daily WHERE owner_id = ? AND day >= ? ORDER BY day DESC"
    ).bind(TELEMETRY_SCOPE, cutoff).all<DictationHealthStoredRow>()).results;
    return json(summarizeDictationHealth(rows));
  } catch {
    return json({ error: "No se pudo leer la telemetría." }, 503);
  }
}
