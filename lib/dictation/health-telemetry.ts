/** Contrato deliberadamente pequeño: no acepta contenido de la respuesta clínica. */
export const DICTATION_HEALTH_EVENTS = [
  "flow_started", "flow_completed", "flow_abandoned",
  "audio_started", "audio_error", "transcription_succeeded", "transcription_error",
  "redraft_started", "redraft_succeeded", "redraft_error", "numeric_mismatch",
  "tts_started", "tts_succeeded", "tts_error", "voice_command", "voice_unrecognized",
  "answer_confirmed", "proposal_review_started", "proposal_review_succeeded", "proposal_review_error", "proposal_ready",
  "save_started", "save_succeeded", "save_error",
] as const;

export const DICTATION_HEALTH_STAGES = ["diagnosis", "plan", "proposal", "save", "flow"] as const;
export const DICTATION_HEALTH_PLATFORMS = [
  "ios_safari", "ios_other", "android_chrome", "android_other",
  "desktop_chrome", "desktop_safari", "desktop_firefox", "desktop_edge", "desktop_other", "unknown",
] as const;
export const DICTATION_HEALTH_ERROR_CODES = [
  "none", "permission_denied", "unsupported", "audio_empty", "timeout", "transcription_failed",
  "provider_failed", "numeric_mismatch", "invalid_response", "save_failed",
  "network_error", "other",
] as const;
export const DICTATION_DURATION_BUCKETS = ["lt_1s", "1_3s", "3_10s", "10_30s", "30_60s", "gte_60s"] as const;

export type DictationHealthEventName = (typeof DICTATION_HEALTH_EVENTS)[number];
export type DictationHealthStage = (typeof DICTATION_HEALTH_STAGES)[number];
export type DictationHealthPlatform = (typeof DICTATION_HEALTH_PLATFORMS)[number];
export type DictationHealthErrorCode = (typeof DICTATION_HEALTH_ERROR_CODES)[number];
export type DictationDurationBucket = (typeof DICTATION_DURATION_BUCKETS)[number];

/** Único payload aceptado por POST /api/dictation/telemetry. No agregar texto ni identificadores de ficha/pieza. */
export type DictationHealthEvent = {
  event: DictationHealthEventName;
  stage: DictationHealthStage;
  platform: DictationHealthPlatform;
  errorCode?: DictationHealthErrorCode;
  /** Milisegundos enteros; el servidor guarda solo un bucket, nunca el valor exacto. */
  durationMs?: number;
};

export type DictationHealthInput = Pick<DictationHealthEvent, "event" | "stage" | "platform"> & {
  errorCode: DictationHealthErrorCode;
  durationBucket: DictationDurationBucket | "none";
};

export type DictationHealthStoredRow = DictationHealthInput & { day: string; count: number };
export type DictationHealthCount = { event: DictationHealthEventName; count: number };
export type DictationHealthPlatformSummary = { platform: DictationHealthPlatform; events: number; failures: number };
export type DictationHealthErrorCount = { errorCode: Exclude<DictationHealthErrorCode, "none">; count: number };
export type DictationHealthDurationCount = { bucket: DictationDurationBucket; count: number };
export type DictationHealthStageSummary = {
  stage: DictationHealthStage;
  events: number;
  failures: number;
  completed: number;
  byPlatform: DictationHealthPlatformSummary[];
  byEvent: DictationHealthCount[];
  byErrorCode: DictationHealthErrorCount[];
  durationBuckets: DictationHealthDurationCount[];
};
export type DictationHealthDaySummary = {
  day: string;
  events: number;
  failures: number;
  completed: number;
  byPlatform: DictationHealthPlatformSummary[];
  stages: DictationHealthStageSummary[];
};
export type DictationHealthSummary = {
  days: DictationHealthDaySummary[];
  totals: {
    events: number;
    failures: number;
    completed: number;
    stages: DictationHealthStageSummary[];
    byPlatform: DictationHealthPlatformSummary[];
    durationBuckets: DictationHealthDurationCount[];
  };
};

const eventSet = new Set<string>(DICTATION_HEALTH_EVENTS);
const stageSet = new Set<string>(DICTATION_HEALTH_STAGES);
const platformSet = new Set<string>(DICTATION_HEALTH_PLATFORMS);
const errorSet = new Set<string>(DICTATION_HEALTH_ERROR_CODES);
const durationSet = new Set<string>(DICTATION_DURATION_BUCKETS);
const EVENT_KEYS = new Set(["event", "stage", "platform", "errorCode", "durationMs"]);
const FAILURE_EVENTS = new Set<DictationHealthEventName>([
  "audio_error", "transcription_error", "redraft_error", "numeric_mismatch", "tts_error",
  "proposal_review_error", "voice_unrecognized", "save_error",
]);

/** Rechaza campos extra o valores abiertos antes de que alcancen D1. */
export function parseDictationHealthEvent(value: unknown): DictationHealthEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !EVENT_KEYS.has(key))) return null;
  if (!eventSet.has(String(input.event)) || !stageSet.has(String(input.stage)) || !platformSet.has(String(input.platform))) return null;
  if (input.errorCode !== undefined && !errorSet.has(String(input.errorCode))) return null;
  if (input.durationMs !== undefined && (!Number.isSafeInteger(input.durationMs) || (input.durationMs as number) < 0 || (input.durationMs as number) > 600_000)) return null;
  return {
    event: input.event as DictationHealthEventName,
    stage: input.stage as DictationHealthStage,
    platform: input.platform as DictationHealthPlatform,
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode as DictationHealthErrorCode } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs as number } : {}),
  };
}

export function durationBucketOf(durationMs: number | undefined): DictationDurationBucket | "none" {
  if (durationMs === undefined) return "none";
  if (durationMs < 1_000) return "lt_1s";
  if (durationMs < 3_000) return "1_3s";
  if (durationMs < 10_000) return "3_10s";
  if (durationMs < 30_000) return "10_30s";
  if (durationMs < 60_000) return "30_60s";
  return "gte_60s";
}

export function toDictationHealthInput(event: DictationHealthEvent): DictationHealthInput {
  return {
    event: event.event,
    stage: event.stage,
    platform: event.platform,
    errorCode: event.errorCode ?? "none",
    durationBucket: durationBucketOf(event.durationMs),
  };
}

export function isDictationHealthFailure(event: DictationHealthEventName): boolean {
  return FAILURE_EVENTS.has(event);
}

function orderedCounts<T extends string>(values: Map<string, number>, order: readonly T[]): Array<{ value: T; count: number }> {
  return order.flatMap(value => values.has(value) ? [{ value, count: values.get(value)! }] : []);
}

function makeStageSummary(stage: DictationHealthStage, rows: DictationHealthStoredRow[]): DictationHealthStageSummary {
  const events = new Map<string, number>();
  const platforms = new Map<string, number>();
  const platformFailures = new Map<string, number>();
  const errors = new Map<string, number>();
  const durations = new Map<string, number>();
  let total = 0, failures = 0, completed = 0;
  for (const row of rows) {
    const count = Math.max(0, Math.floor(row.count));
    if (!count || !eventSet.has(row.event) || !errorSet.has(row.errorCode) || (row.durationBucket !== "none" && !durationSet.has(row.durationBucket))) continue;
    total += count;
    const isFailure = FAILURE_EVENTS.has(row.event);
    if (isFailure) {
      failures += count;
      platformFailures.set(row.platform, (platformFailures.get(row.platform) ?? 0) + count);
    }
    if (row.event === "flow_completed") completed += count;
    events.set(row.event, (events.get(row.event) ?? 0) + count);
    platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + count);
    if (row.errorCode !== "none") errors.set(row.errorCode, (errors.get(row.errorCode) ?? 0) + count);
    if (row.durationBucket !== "none") durations.set(row.durationBucket, (durations.get(row.durationBucket) ?? 0) + count);
  }
  return {
    stage, events: total, failures, completed,
    byPlatform: orderedCounts(platforms, DICTATION_HEALTH_PLATFORMS).map(item => ({ platform: item.value, events: item.count, failures: platformFailures.get(item.value) ?? 0 })),
    byEvent: orderedCounts(events, DICTATION_HEALTH_EVENTS).map(item => ({ event: item.value, count: item.count })),
    byErrorCode: orderedCounts(errors, DICTATION_HEALTH_ERROR_CODES.filter(code => code !== "none")).map(item => ({ errorCode: item.value, count: item.count })),
    durationBuckets: orderedCounts(durations, DICTATION_DURATION_BUCKETS).map(item => ({ bucket: item.value, count: item.count })),
  };
}

/** Reduce only validated daily aggregates; no event-level row is ever returned to the client. */
export function summarizeDictationHealth(rows: DictationHealthStoredRow[]): DictationHealthSummary {
  const byDayStage = new Map<string, DictationHealthStoredRow[]>();
  const stagesAll = new Map<DictationHealthStage, DictationHealthStoredRow[]>();
  const days = [...new Set(rows.map(row => row.day).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort((a, b) => b.localeCompare(a));
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !stageSet.has(row.stage)) continue;
    const dayKey = `${row.day}:${row.stage}`;
    byDayStage.set(dayKey, [...(byDayStage.get(dayKey) ?? []), row]);
    stagesAll.set(row.stage, [...(stagesAll.get(row.stage) ?? []), row]);
  }
  const stageRows = (source: Map<DictationHealthStage, DictationHealthStoredRow[]>) => DICTATION_HEALTH_STAGES
    .filter(stage => (source.get(stage)?.length ?? 0) > 0)
    .map(stage => makeStageSummary(stage, source.get(stage)!));
  const daySummaries = days.map(day => {
    const stages = stageRows(new Map(DICTATION_HEALTH_STAGES.flatMap(stage => {
      const grouped = byDayStage.get(`${day}:${stage}`);
      return grouped?.length ? [[stage, grouped] as const] : [];
    })));
    const platforms = new Map<string, number>();
    const platformFailures = new Map<string, number>();
    for (const stage of stages) for (const item of stage.byPlatform) {
      platforms.set(item.platform, (platforms.get(item.platform) ?? 0) + item.events);
      platformFailures.set(item.platform, (platformFailures.get(item.platform) ?? 0) + item.failures);
    }
    return {
      day,
      events: stages.reduce((sum, stage) => sum + stage.events, 0),
      failures: stages.reduce((sum, stage) => sum + stage.failures, 0),
      completed: stages.reduce((sum, stage) => sum + stage.completed, 0),
      byPlatform: orderedCounts(platforms, DICTATION_HEALTH_PLATFORMS).map(item => ({ platform: item.value, events: item.count, failures: platformFailures.get(item.value) ?? 0 })),
      stages,
    };
  });
  const totalStages = stageRows(stagesAll);
  const durationCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  const platformFailures = new Map<string, number>();
  for (const stage of totalStages) for (const bucket of stage.durationBuckets) durationCounts.set(bucket.bucket, (durationCounts.get(bucket.bucket) ?? 0) + bucket.count);
  for (const stage of totalStages) for (const platform of stage.byPlatform) {
    platformCounts.set(platform.platform, (platformCounts.get(platform.platform) ?? 0) + platform.events);
    platformFailures.set(platform.platform, (platformFailures.get(platform.platform) ?? 0) + platform.failures);
  }
  return {
    days: daySummaries,
    totals: {
      events: totalStages.reduce((sum, stage) => sum + stage.events, 0),
      failures: totalStages.reduce((sum, stage) => sum + stage.failures, 0),
      completed: totalStages.reduce((sum, stage) => sum + stage.completed, 0),
      stages: totalStages,
      byPlatform: orderedCounts(platformCounts, DICTATION_HEALTH_PLATFORMS).map(item => ({ platform: item.value, events: item.count, failures: platformFailures.get(item.value) ?? 0 })),
      durationBuckets: orderedCounts(durationCounts, DICTATION_DURATION_BUCKETS).map(item => ({ bucket: item.value, count: item.count })),
    },
  };
}

/** Combine identical events before a single daily upsert; input has already passed the strict allowlist. */
export function aggregateDictationHealthInput(events: DictationHealthEvent[]): Array<DictationHealthInput & { count: number }> {
  const counts = new Map<string, DictationHealthInput & { count: number }>();
  for (const event of events) {
    const row = toDictationHealthInput(event);
    const key = JSON.stringify([row.stage, row.event, row.platform, row.errorCode, row.durationBucket]);
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { ...row, count: 1 });
  }
  return [...counts.values()];
}
