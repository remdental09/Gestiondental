/**
 * Salud de las tareas automáticas (cron): última ejecución, último éxito y último error.
 * Es una tabla global por tarea; a la pantalla solo llega el estado (al día / con errores) y la hora,
 * nunca datos de otras cuentas. El detalle del error lo ve solo el titular de la aplicación.
 */
export type HealthDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
  };
};

export type HealthRow = { job: string; last_run_at: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null; runs: number; failures: number; partial: number; duration_ms: number };

/** Cuántos elementos fallaron en el resultado (listas con { ok: false } o un objeto { ok: false }). */
export function failedItems(result: unknown): number {
  if (Array.isArray(result)) return result.filter((item) => item && typeof item === "object" && (item as { ok?: unknown }).ok === false).length;
  if (result && typeof result === "object" && (result as { ok?: unknown }).ok === false) return 1;
  return 0;
}

/** Mensaje corto y sin correos ni tokens, apto para guardar. */
export function safeError(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]").replace(/\b(ya29\.|sk-)[\w-]+/g, "[token]").replace(/\s+/g, " ").slice(0, 200);
}

const UPSERT = "INSERT INTO cron_health (job, last_run_at, last_ok_at, last_error_at, last_error, runs, failures, partial, duration_ms) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(job) DO UPDATE SET last_run_at = excluded.last_run_at, last_ok_at = COALESCE(excluded.last_ok_at, cron_health.last_ok_at), last_error_at = COALESCE(excluded.last_error_at, cron_health.last_error_at), last_error = COALESCE(excluded.last_error, cron_health.last_error), runs = cron_health.runs + 1, failures = cron_health.failures + excluded.failures, partial = excluded.partial, duration_ms = excluded.duration_ms";

/**
 * Ejecuta una tarea y registra su salud. Nunca lanza: un error se anota, se registra en consola
 * (visible en los logs del Worker) y se devuelve como { ok: false }.
 */
export async function runJob<T>(db: HealthDb | null | undefined, job: string, task: () => Promise<T>, now: () => Date = () => new Date()): Promise<T | { ok: false; detail: string }> {
  const started = now();
  let result: T | { ok: false; detail: string };
  let error: string | null = null;
  try {
    result = await task();
  } catch (cause) {
    error = safeError(cause);
    console.error("cron-error", job, error);
    result = { ok: false, detail: error };
  }
  const partial = error ? 0 : failedItems(result);
  if (partial) console.warn("cron-parcial", job, partial);
  const finished = now();
  const at = finished.toISOString();
  if (db) {
    try {
      await db.prepare(UPSERT).bind(job, at, error ? null : at, error ? at : null, error, error ? 1 : 0, partial, Math.max(0, finished.getTime() - started.getTime())).run();
    } catch { /* la salud nunca rompe la tarea */ }
  }
  return result;
}

/** Tareas cuyo último error es posterior a su último éxito: están fallando ahora. */
export function failingJobs(rows: HealthRow[]): HealthRow[] {
  return rows.filter((row) => row.last_error_at && (!row.last_ok_at || row.last_error_at > row.last_ok_at));
}

export const JOB_LABELS: Record<string, string> = {
  "google-calendars": "Calendarios de Google",
  "calendar-sync": "Calendario (ICS)",
  "google-pending": "Citas pendientes de enviar a Google",
  "google-two-way": "Cambios hechos en Google Calendar",
  "agenda-changes": "Avisos de cambios de agenda",
  "appointment-reminders": "Recordatorios de citas",
  "agenda-digest": "Agenda semanal por correo",
  "note-audits": "Revisión de evoluciones",
  "drive-backup": "Respaldo en Google Drive",
  "nightly-backup": "Respaldo nocturno (D1 e imágenes)",
  "backup-watchdog": "Vigilante diario de respaldos",
};
