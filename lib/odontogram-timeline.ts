import type { OdontogramData, OdontogramSurface, ToothHistoryEvent, ToothHistorySnapshot } from "../app/clinical-data.ts";

/**
 * El odontograma como resultado de su historia.
 * Cada hito guarda la pieza antes y después; su EFECTO es la diferencia entre ambos (estado, caras, motivo de ausencia, corona).
 * Re-aplicar esos efectos en orden permite: (a) ver el odontograma de cualquier fecha y
 * (b) quitar los efectos de una evolución borrada o anulada sin perder lo que se hizo después.
 */

const SURFACES: OdontogramSurface[] = ["V", "P", "M", "D", "O"];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = <T,>(value: T): T => (value == null ? value : JSON.parse(JSON.stringify(value)));

/** Fecha clínica del hito (la fecha de atención si existe; si no, el día en que se registró). */
export const eventDate = (event: ToothHistoryEvent) => event.clinicalDate || event.recordedAt.slice(0, 10);
const chronological = (a: ToothHistoryEvent, b: ToothHistoryEvent) => eventDate(a).localeCompare(eventDate(b)) || a.recordedAt.localeCompare(b.recordedAt);

export function snapshotOf(chart: OdontogramData, tooth: number): ToothHistorySnapshot {
  return {
    status: chart.teeth[tooth] ?? "Sin hallazgos",
    surfaces: clone(chart.surfaces[tooth] ?? {}),
    missingReason: chart.missingReason[tooth] ?? null,
    crown: clone(chart.crowns?.[tooth] ?? null),
  };
}

/** Aplica sobre `state` solo lo que el hito cambió (no su foto completa). */
export function applyEffect(state: ToothHistorySnapshot, event: ToothHistoryEvent): ToothHistorySnapshot {
  const before = event.before, after = event.after;
  if (!after) return state;
  if (!before) return clone(after);
  const next = clone(state);
  if (before.status !== after.status) next.status = after.status;
  if (!same(before.missingReason, after.missingReason)) next.missingReason = after.missingReason;
  if (!same(before.crown, after.crown)) next.crown = clone(after.crown);
  for (const surface of SURFACES) {
    if (same(before.surfaces?.[surface], after.surfaces?.[surface])) continue;
    if (after.surfaces?.[surface]) next.surfaces = { ...next.surfaces, [surface]: clone(after.surfaces[surface]) };
    else { const { [surface]: _gone, ...rest } = next.surfaces; next.surfaces = rest; }
  }
  return next;
}

function writeSnapshot(chart: OdontogramData, tooth: number, state: ToothHistorySnapshot) {
  if (state.status && state.status !== "Sin hallazgos") chart.teeth[tooth] = state.status; else delete chart.teeth[tooth];
  if (Object.keys(state.surfaces ?? {}).length) chart.surfaces[tooth] = clone(state.surfaces); else delete chart.surfaces[tooth];
  if (state.missingReason) chart.missingReason[tooth] = state.missingReason; else delete chart.missingReason[tooth];
  chart.crowns = chart.crowns ?? {};
  if (state.crown) chart.crowns[tooth] = clone(state.crown); else delete chart.crowns[tooth];
}

/** Estado de una pieza re-aplicando sus hitos desde el estado previo al primero. */
function replay(events: ToothHistoryEvent[]): ToothHistorySnapshot | null {
  const ordered = [...events].sort(chronological);
  const first = ordered.find((event) => event.before);
  if (!first?.before) return ordered.length ? clone(ordered[ordered.length - 1].after ?? null) : null;
  return ordered.reduce((state, event) => applyEffect(state, event), clone(first.before));
}

/**
 * Quita del odontograma todo lo que hizo una evolución (borrada o anulada) y recalcula cada pieza afectada
 * con los hitos que quedan, de cualquier especialidad o cambio manual.
 */
export function revertEvolution(chart: OdontogramData, evolutionId: number): { chart: OdontogramData; teeth: number[] } {
  const history = chart.history ?? [];
  const removed = history.filter((event) => event.sourceEvolutionId === evolutionId);
  if (!removed.length) return { chart, teeth: [] };
  const next: OdontogramData = { ...clone(chart), history: history.filter((event) => event.sourceEvolutionId !== evolutionId) };
  const teeth = [...new Set(removed.map((event) => event.tooth))];
  for (const tooth of teeth) {
    const all = history.filter((event) => event.tooth === tooth).sort(chronological);
    const base = all.find((event) => event.before)?.before ?? { status: "Sin hallazgos", surfaces: {}, missingReason: null, crown: null };
    const state = all.filter((event) => event.sourceEvolutionId !== evolutionId).reduce((acc, event) => applyEffect(acc, event), clone(base));
    writeSnapshot(next, tooth, state);
  }
  return { chart: next, teeth };
}

/** El odontograma tal como estaba al final del día `date` (AAAA-MM-DD). Solo lectura. */
export function chartAt(chart: OdontogramData, date: string): OdontogramData {
  const history = chart.history ?? [];
  const at: OdontogramData = { ...clone(chart), history: history.filter((event) => eventDate(event) <= date) };
  const teeth = [...new Set(history.map((event) => event.tooth))];
  for (const tooth of teeth) {
    const own = history.filter((event) => event.tooth === tooth);
    const ordered = [...own].sort(chronological);
    const base = ordered.find((event) => event.before)?.before;
    if (!base) continue;
    const state = ordered.filter((event) => eventDate(event) <= date).reduce((acc, event) => applyEffect(acc, event), clone(base));
    writeSnapshot(at, tooth, state);
  }
  return at;
}

/** Días con cambios en el odontograma, del más reciente al más antiguo (para el selector de fecha). */
export function chartDates(chart: OdontogramData): string[] {
  return [...new Set((chart.history ?? []).filter((event) => event.eventType !== "diagnosis").map(eventDate))].sort().reverse();
}

export { replay as replayToothHistory };
