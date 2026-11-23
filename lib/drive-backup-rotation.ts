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
export const DRIVE_BACKUP_ROTATION_MS = 20 * 60_000; // el Cron del respaldo corre cada 20 minutos: cada pasada parte por otra cuenta

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

/**
 * Tope de consultas a D1 por pasada. Cloudflare corta en 1.000 consultas por invocación del Worker
 * («Too many API requests by single Worker invocation»): pasado ese tope fallan TODAS las consultas siguientes,
 * incluidas la constancia (backup_heartbeat) y la salud del cron (cron_health). Incidente 22/23-11: el respaldo
 * revisaba cientos de fichas por pasada (~16 consultas cada una) y moría sin dejar rastro.
 * Se deja margen para la constancia, la salud y el cursor.
 */
export const DRIVE_D1_QUERY_BUDGET = 700;
/**
 * Consultas que cuesta armar la foto de una ficha: un db.batch con las 11 tablas (cuenta como 1) + dirección y anamnesis
 * (2 cada una). Se deja margen por si el batch falla y se lee tabla por tabla en esa ficha.
 */
export const SNAPSHOT_QUERIES = 8;
/** Consultas extra al copiar una ficha: 2 fotos más (verificación), confirmación, adjuntos, Markdown y bitácora. */
export const BACKUP_QUERIES = SNAPSHOT_QUERIES * 2 + 14;
/** Fichas por página al revisar la cola. */
export const DRIVE_QUEUE_PAGE = 20;

export type QueryBudget = { readonly used: number; readonly left: number; canAfford(cost: number): boolean; spend(cost: number): boolean };

/** Presupuesto de consultas de la pasada: `spend` solo descuenta si alcanza. */
export function queryBudget(limit = DRIVE_D1_QUERY_BUDGET): QueryBudget {
  let used = 0;
  return {
    get used() { return used; },
    get left() { return Math.max(0, limit - used); },
    canAfford: (cost: number) => used + cost <= limit,
    spend(cost: number) { if (used + cost > limit) return false; used += cost; return true; },
  };
}

/**
 * Cuántas fichas revisar en la próxima página sin pasarse del presupuesto (0 = parar).
 * Siempre deja espacio para copiar al menos una ficha pendiente de esa página.
 */
export function affordablePage(budget: QueryBudget, pageSize = DRIVE_QUEUE_PAGE, limit = Number.POSITIVE_INFINITY) {
  const room = Math.min(budget.left, limit) - 1 - BACKUP_QUERIES;
  return Math.max(0, Math.min(pageSize, Math.floor(room / SNAPSHOT_QUERIES)));
}

/**
 * Dónde retomar la próxima pasada. `stoppedBefore` es la primera ficha que quedó sin procesar en esta página
 * (o null si la página se terminó). Al terminar la última página se vuelve a 0 para la siguiente vuelta completa.
 */
export function nextCursor(after: number, stoppedBefore: number | null, nextAfterPatientId: number | null, pageDone: boolean) {
  if (stoppedBefore !== null) return Math.max(after, stoppedBefore - 1);
  if (!pageDone) return after;
  return nextAfterPatientId ?? 0;
}

/** Consultas por cuenta en la primera vuelta: lo que alcanza para revisar al menos 3 fichas y copiar una. */
export function fairQueryShare(available: number, owners: number) {
  if (owners <= 0) return 0;
  return Math.max(SNAPSHOT_QUERIES * 3 + BACKUP_QUERIES, Math.floor(available / owners));
}
