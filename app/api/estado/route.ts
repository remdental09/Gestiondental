import { env } from "cloudflare:workers";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { chileDay, limitsFrom, type UsageRow } from "@/lib/ai-usage";
import { failingJobs, JOB_LABELS, type HealthRow } from "@/lib/cron-health";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Db = { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } } };
const config = env as unknown as Record<string, unknown> & { DB?: Db; CLINIC_OWNER_ID?: string };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** Estado para Configuración: tareas automáticas (sin datos de otras cuentas) y el uso de IA de hoy de esta cuenta. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const account = personalIdOf(user);
  const owner = typeof config.CLINIC_OWNER_ID === "string" ? config.CLINIC_OWNER_ID.trim() : "";
  const isOwner = Boolean(owner) && account === owner && user.userId === owner;
  const rows = await db.prepare("SELECT job, last_run_at, last_ok_at, last_error_at, last_error, runs, failures, partial, duration_ms FROM cron_health ORDER BY job").bind().all<HealthRow>().then((r) => r.results).catch(() => [] as HealthRow[]);
  const usage = await db.prepare("SELECT calls, input_tokens, output_tokens, audio_seconds FROM ai_usage WHERE owner_id = ? AND day = ?").bind(user.userId, chileDay()).first<UsageRow>().catch(() => null);
  const limits = limitsFrom(config);
  const lastRun = rows.reduce<string | null>((latest, row) => (!latest || row.last_run_at > latest ? row.last_run_at : latest), null);
  return json({
    tareas: {
      ultima: lastRun,
      fallando: failingJobs(rows).map((row) => ({ tarea: JOB_LABELS[row.job] ?? row.job, desde: row.last_error_at, ...(isOwner ? { detalle: row.last_error } : {}) })),
    },
    ia: {
      llamadas: Number(usage?.calls ?? 0),
      tokens: Number(usage?.input_tokens ?? 0) + Number(usage?.output_tokens ?? 0),
      audioMinutos: Math.round(Number(usage?.audio_seconds ?? 0) / 60),
      limites: { llamadas: limits.calls, tokens: limits.tokens, audioMinutos: Math.round(limits.audioSeconds / 60) },
    },
  });
}
