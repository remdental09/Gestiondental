/**
 * Presupuesto por pasada de los crons (Google Calendar, revisión de notas): se procesan TODAS las cuentas,
 * empezando por la que lleva más tiempo sin atenderse, hasta agotar el tiempo o la cantidad de la pasada.
 * Lo que no alcanza queda primero en la fila de la pasada siguiente (no hay tope fijo de cuentas).
 */
export type CronBudget = { take(): boolean; readonly used: number; readonly skipped: number };

export const CRON_MAX_ACCOUNTS = 60;
export const CRON_MAX_MS = 25_000;

export function cronBudget(options: { maxItems?: number; maxMs?: number; clock?: () => number } = {}): CronBudget {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const maxItems = Math.max(1, options.maxItems ?? CRON_MAX_ACCOUNTS);
  const maxMs = Math.max(1, options.maxMs ?? CRON_MAX_MS);
  let used = 0, skipped = 0;
  return {
    take() {
      if (used >= maxItems || clock() - started >= maxMs) { skipped++; return false; }
      used++;
      return true;
    },
    get used() { return used; },
    get skipped() { return skipped; },
  };
}

/** Más antigua primero; nunca atendida (null/vacío) va antes que todas. Orden estable para empates. */
export function oldestFirst<T>(rows: readonly T[], lastRun: (row: T) => string | null | undefined): T[] {
  return rows.map((row, index) => ({ row, index, at: lastRun(row) || "" }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.index - b.index))
    .map(item => item.row);
}

/** Corta una lista de sentencias en tandas para db.batch (D1 acepta lotes; se mantienen chicos por el límite de CPU). */
export function chunks<T>(items: readonly T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}
