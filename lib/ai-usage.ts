/**
 * Uso de IA por cuenta y por día (hora de Chile) y tope diario.
 * Protege el costo: una cuenta (o un error en un bucle) no puede gastar sin límite.
 * Los topes se pueden cambiar con variables del Worker sin redeploy de código.
 */
export type UsageDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

export type AiLimits = { calls: number; tokens: number; audioSeconds: number };
export const DEFAULT_AI_LIMITS: AiLimits = { calls: 400, tokens: 6_000_000, audioSeconds: 4 * 3600 };

export const AI_USAGE_DDL = "CREATE TABLE IF NOT EXISTS ai_usage (owner_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, audio_seconds INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, day))";

export const AI_LIMIT_MESSAGE = "Llegaste al límite diario de IA de tu cuenta. Se renueva a medianoche (hora de Chile). Mientras tanto puedes escribir la evolución a mano; nada de lo guardado se pierde.";

/** Día calendario en Chile (los topes se renuevan a medianoche de Santiago). */
export function chileDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const positive = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Topes desde el entorno (AI_DAILY_CALLS, AI_DAILY_TOKENS, AI_DAILY_AUDIO_MINUTES); si faltan, los de fábrica. */
export function limitsFrom(env: Record<string, unknown> | undefined): AiLimits {
  return {
    calls: positive(env?.AI_DAILY_CALLS, DEFAULT_AI_LIMITS.calls),
    tokens: positive(env?.AI_DAILY_TOKENS, DEFAULT_AI_LIMITS.tokens),
    audioSeconds: env?.AI_DAILY_AUDIO_MINUTES ? positive(env.AI_DAILY_AUDIO_MINUTES, 240) * 60 : DEFAULT_AI_LIMITS.audioSeconds,
  };
}

export type UsageRow = { calls: number; input_tokens: number; output_tokens: number; audio_seconds: number };

export function overLimit(row: UsageRow | null, limits: AiLimits, kind: "text" | "audio" = "text"): boolean {
  if (!row) return false;
  if (Number(row.calls) >= limits.calls) return true;
  if (Number(row.input_tokens) + Number(row.output_tokens) >= limits.tokens) return true;
  return kind === "audio" && Number(row.audio_seconds) >= limits.audioSeconds;
}

/**
 * ¿Puede esta cuenta usar IA ahora? Si la tabla o D1 fallan, se permite (el tope protege el costo;
 * no debe impedir trabajar por un error de la base).
 */
export async function aiAllowed(db: UsageDb | null | undefined, ownerId: string, limits: AiLimits, kind: "text" | "audio" = "text", now = new Date()): Promise<boolean> {
  if (!db || !ownerId) return true;
  try {
    const row = await db.prepare("SELECT calls, input_tokens, output_tokens, audio_seconds FROM ai_usage WHERE owner_id = ? AND day = ?").bind(ownerId, chileDay(now)).first<UsageRow>();
    return !overLimit(row, limits, kind);
  } catch {
    return true;
  }
}

/** Suma un uso (una llamada, tokens y/o segundos de audio). Nunca lanza. */
export async function recordAiUsage(db: UsageDb | null | undefined, ownerId: string, usage: { calls?: number; inputTokens?: number; outputTokens?: number; audioSeconds?: number }, now = new Date()): Promise<void> {
  if (!db || !ownerId) return;
  const calls = Math.max(0, Math.floor(usage.calls ?? 1));
  const input = Math.max(0, Math.floor(usage.inputTokens ?? 0));
  const output = Math.max(0, Math.floor(usage.outputTokens ?? 0));
  const audio = Math.max(0, Math.round(usage.audioSeconds ?? 0));
  try {
    await db.prepare("INSERT INTO ai_usage (owner_id, day, calls, input_tokens, output_tokens, audio_seconds, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, day) DO UPDATE SET calls = ai_usage.calls + excluded.calls, input_tokens = ai_usage.input_tokens + excluded.input_tokens, output_tokens = ai_usage.output_tokens + excluded.output_tokens, audio_seconds = ai_usage.audio_seconds + excluded.audio_seconds, updated_at = excluded.updated_at")
      .bind(ownerId, chileDay(now), calls, input, output, audio, now.toISOString()).run();
  } catch { /* el registro de uso nunca rompe el dictado */ }
}

/** Segundos de audio aproximados según el peso (Opus/AAC de voz ≈ 4–16 KB/s; se usa 8 KB/s). */
export const approxAudioSeconds = (bytes: number) => Math.max(1, Math.round(bytes / 8000));

/** Acumulador de tokens para varias llamadas dentro de una misma solicitud. */
export function usageCollector() {
  const total = { inputTokens: 0, outputTokens: 0, calls: 0 };
  return {
    total,
    onUsage: (usage: { prompt_tokens?: number; completion_tokens?: number }) => {
      total.calls += 1;
      total.inputTokens += Number(usage.prompt_tokens) || 0;
      total.outputTokens += Number(usage.completion_tokens) || 0;
    },
  };
}
