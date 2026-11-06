import type { OdontogramData, ToothHistoryEvent } from "./clinical-data";

/** Preconteo COP-D/ceo-d: una indicación de exodoncia conserva la pieza presente. */
export function calculateCariesExperience(teeth: readonly number[], data: OdontogramData) {
  let caries = 0, missing = 0, filled = 0;
  for (const tooth of teeth) {
    const status = data.teeth[tooth] ?? "Sin hallazgos";
    if (status === "Ausente") {
      if (data.missingReason[tooth] === "caries") missing++;
      continue;
    }
    if (status === "Implante" || status === "Implante con pilar") continue;
    const surfaces = Object.values(data.surfaces[tooth] ?? {});
    const hasCaries = (status === "Indicación de exodoncia" && data.missingReason[tooth] === "caries") || surfaces.some(surface => surface?.condition === "caries");
    const hasRestoration = surfaces.some(surface => surface?.condition === "restored" || surface?.condition === "other_restoration");
    if (hasCaries) caries++;
    else if (hasRestoration) filled++;
  }
  return { caries, missing, filled, total: caries + missing + filled };
}

export type CopPoint = { date: string; caries: number; missing: number; filled: number; total: number };

/**
 * Evolución del COP-D/ceo-d por fecha: se reconstruye el estado de cada pieza con el «después» de sus hitos
 * (ordenados por fecha clínica) y se recalcula el índice al cierre de cada fecha distinta.
 */
export function copEvolution(teeth: readonly number[], history: readonly ToothHistoryEvent[]): CopPoint[] {
  const dayOf = (event: ToothHistoryEvent) => (event.clinicalDate || event.recordedAt).slice(0, 10);
  const ordered = history
    .filter(event => event.after && teeth.includes(event.tooth))
    .slice()
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.recordedAt.localeCompare(b.recordedAt));
  const state: OdontogramData = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {}, history: [] };
  const points: CopPoint[] = [];
  ordered.forEach((event, index) => {
    const after = event.after!;
    if (after.status && after.status !== "Sin hallazgos") state.teeth[event.tooth] = after.status; else delete state.teeth[event.tooth];
    state.surfaces[event.tooth] = after.surfaces ?? {};
    if (after.missingReason) state.missingReason[event.tooth] = after.missingReason; else delete state.missingReason[event.tooth];
    const closes = index === ordered.length - 1 || dayOf(ordered[index + 1]) !== dayOf(event);
    if (closes) points.push({ date: dayOf(event), ...calculateCariesExperience(teeth, state) });
  });
  return points;
}
