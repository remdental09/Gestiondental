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
