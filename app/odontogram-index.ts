import type { OdontogramData, ToothHistoryEvent } from "./clinical-data";

/**
 * Preconteo COP-D/ceo-d.
 * - P (perdidos): pieza ausente o reemplazada por implante. El implante no borra la pérdida: la pieza se perdió igual.
 *   Solo no cuenta si la causa registrada es «otra causa» (trauma, ortodoncia, agenesia…). Si la causa no está registrada,
 *   cuenta y se informa aparte (`missingUnknownCause`) para que el clínico la revise.
 * - Una indicación de exodoncia conserva la pieza presente: cuenta como C solo si la causa es caries.
 */
export function calculateCariesExperience(teeth: readonly number[], data: OdontogramData) {
  let caries = 0, missing = 0, filled = 0, missingUnknownCause = 0, implantsCounted = 0;
  for (const tooth of teeth) {
    const status = data.teeth[tooth] ?? "Sin hallazgos";
    const implant = status === "Implante" || status === "Implante con pilar" || (status === "Corona" && data.crowns?.[tooth]?.foundation === "implant");
    if (status === "Ausente" || implant) {
      const reason = data.missingReason[tooth];
      if (reason !== "other") {
        missing++;
        if (reason !== "caries") missingUnknownCause++;
        if (implant) implantsCounted++;
      }
      continue;
    }
    const surfaces = Object.values(data.surfaces[tooth] ?? {});
    const hasCaries = (status === "Indicación de exodoncia" && data.missingReason[tooth] === "caries") || surfaces.some(surface => surface?.condition === "caries");
    const hasRestoration = surfaces.some(surface => surface?.condition === "restored" || surface?.condition === "other_restoration");
    if (hasCaries) caries++;
    else if (hasRestoration) filled++;
  }
  return { caries, missing, filled, total: caries + missing + filled, missingUnknownCause, implantsCounted };
}

export type CopPoint = { date: string; caries: number; missing: number; filled: number; total: number; missingUnknownCause?: number; implantsCounted?: number };

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
    if (after.crown) state.crowns![event.tooth] = after.crown; else delete state.crowns![event.tooth];
    if (after.missingReason) state.missingReason[event.tooth] = after.missingReason; else delete state.missingReason[event.tooth];
    const closes = index === ordered.length - 1 || dayOf(ordered[index + 1]) !== dayOf(event);
    if (closes) points.push({ date: dayOf(event), ...calculateCariesExperience(teeth, state) });
  });
  return points;
}
