/**
 * Turno justo del respaldo automático en Drive entre todas las cuentas.
 *
 * Antes cada pasada procesaba 5 fichas en total y siempre partía por la misma cuenta (orden por owner_id):
 * con muchos dentistas, los últimos de la fila podían quedar sin respaldo de rescate.
 * Ahora (plan pagado de Workers: 10.000 subpeticiones y 15 min por Cron):
 *  - cada pasada procesa hasta DRIVE_BACKUP_MAX_PER_RUN fichas;
 *  - el punto de partida rota cada pasada, así ninguna cuenta queda siempre al final;
 *  - primera vuelta: cada cuenta recibe una cuota pareja; segunda vuelta: lo que sobre, en el mismo orden;
 *  - se deja de empezar fichas nuevas al pasar DRIVE_BACKUP_MAX_MS (lo pendiente sigue en la próxima pasada).
 */
export const DRIVE_BACKUP_MAX_PER_RUN = 60; // ~10 llamadas a Google por ficha → ~600 subpeticiones, lejos de 10.000
export const DRIVE_BACKUP_MIN_SHARE = 3;
export const DRIVE_BACKUP_MAX_MS = 5 * 60_000;
export const DRIVE_BACKUP_ROTATION_MS = 10 * 60_000; // el Cron más frecuente del respaldo corre cada 10 minutos

/** Orden rotado: cada ventana de 10 minutos parte por una cuenta distinta. */
export function rotateOwners<T>(items: T[], nowMs: number): T[] {
  if (items.length < 2) return items.slice();
  const start = Math.floor(nowMs / DRIVE_BACKUP_ROTATION_MS) % items.length;
  return items.slice(start).concat(items.slice(0, start));
}

/** Cuota por cuenta en la primera vuelta. */
export function fairShare(totalBudget: number, owners: number): number {
  if (owners <= 0) return 0;
  return Math.max(DRIVE_BACKUP_MIN_SHARE, Math.ceil(totalBudget / owners));
}

/** Reloj de la pasada: indica cuándo dejar de empezar fichas nuevas. */
export function runClock(maxMs = DRIVE_BACKUP_MAX_MS, clock: () => number = Date.now) {
  const started = clock();
  return { expired: () => clock() - started >= maxMs };
}
