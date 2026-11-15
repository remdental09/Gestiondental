import type { OdontogramData, OdontogramSurface, SurfaceFinding, ToothHistoryEvent, ToothHistorySnapshot } from "@/app/clinical-data";

export function toothHistorySnapshot(chart: OdontogramData, tooth: number): ToothHistorySnapshot {
  const surfaces = Object.fromEntries(Object.entries(chart.surfaces[tooth] ?? {}).map(([surface, finding]) => [
    surface,
    finding ? { ...finding } : finding,
  ])) as Partial<Record<OdontogramSurface, SurfaceFinding>>;
  const crown = chart.crowns?.[tooth];
  return {
    status: chart.teeth[tooth] ?? "Sin hallazgos",
    surfaces,
    missingReason: chart.missingReason[tooth] ?? null,
    crown: crown ? { ...crown } : null,
    ...(chart.extras?.[tooth]?.length ? { extras: [...chart.extras[tooth]] } : {}),
  };
}

export function appendToothHistory(
  chart: OdontogramData,
  tooth: number,
  eventType: ToothHistoryEvent["eventType"],
  before: ToothHistorySnapshot,
  metadata: Partial<Pick<ToothHistoryEvent, "recordedAt" | "clinicalDate" | "source" | "sourceEvolutionId" | "sourceActionId" | "surface" | "title" | "detail">> = {},
): OdontogramData {
  const after = toothHistorySnapshot(chart, tooth);
  // Los diagnósticos son hitos informativos y pueden no cambiar el estado actual del diente.
  if (JSON.stringify(before) === JSON.stringify(after) && eventType !== "diagnosis") return chart;
  const history = chart.history ?? [];
  const recordedAt = metadata.recordedAt ?? new Date().toISOString();
  const event: ToothHistoryEvent = {
    id: `${recordedAt}:${tooth}:${eventType}:${history.length + 1}`,
    tooth,
    recordedAt,
    eventType,
    ...metadata,
    before,
    after,
  };
  chart.history = [...history, event];
  return chart;
}

const MERGE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Marcar una cara como caries y fijar su profundidad son dos guardados seguidos del mismo gesto clínico.
 * Si el último hito de la pieza es un cambio manual de esa misma cara, hecho hace poco, el nuevo se une a él
 * (antes del primero → después del segundo). Si el resultado vuelve al estado original, no queda hito.
 */
export function mergeRecentSurfaceEvent(chart: OdontogramData, tooth: number, surface: OdontogramSurface): OdontogramData {
  const history = chart.history ?? [];
  if (history.length < 2) return chart;
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;
  const manual = (event: ToothHistoryEvent) => (event.source ?? "manual") === "manual" && !event.sourceActionId && !event.sourceEvolutionId;
  if (last.tooth !== tooth || prev.tooth !== tooth || last.eventType !== "surface" || prev.eventType !== "surface") return chart;
  if (last.surface !== surface || prev.surface !== surface || !manual(last) || !manual(prev)) return chart;
  const gap = Date.parse(last.recordedAt) - Date.parse(prev.recordedAt);
  if (!Number.isFinite(gap) || gap < 0 || gap > MERGE_WINDOW_MS) return chart;
  const rest = history.slice(0, -2);
  if (JSON.stringify(prev.before) === JSON.stringify(last.after)) {
    chart.history = rest;
    return chart;
  }
  chart.history = [...rest, { ...last, id: prev.id, before: prev.before }];
  return chart;
}
