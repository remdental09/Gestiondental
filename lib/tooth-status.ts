/** Estados generales de la pieza que se registran a mano (la dictación aún no los propone). */
export const APICAL_STATUSES = [
  "Periodontitis apical",
  "Absceso apical agudo",
  "Absceso apical crónico (fístula)",
  "Granuloma apical",
  "Quiste radicular",
  "Osteítis condensante",
] as const;
export const FRACTURE_STATUSES = [
  "Fisura coronaria",
  "Fractura coronaria de esmalte",
  "Fractura coronaria con dentina",
  "Fractura coronaria con pulpa expuesta",
  "Fractura corono-radicular",
  "Fractura radicular horizontal",
  "Fractura radicular vertical",
] as const;
export const BASE_STATUSES = ["Sin hallazgos", "Implante", "Implante con pilar", "Corona", "Ausente", "Indicación de exodoncia", "Resto radicular con endodoncia"] as const;
export const ALL_TOOTH_STATUSES: readonly string[] = [...BASE_STATUSES, ...APICAL_STATUSES, ...FRACTURE_STATUSES];
export const isLesionStatus = (status: string) => (APICAL_STATUSES as readonly string[]).includes(status) || (FRACTURE_STATUSES as readonly string[]).includes(status);

/** Estado de una pieza: el estado principal más las lesiones/fracturas que conviven con él. */
export type ToothStatusState = { primary?: string; extras: string[] };

const CLEARS_LESIONS = new Set(["Sin hallazgos", "Ausente", "Indicación de exodoncia", "Implante", "Implante con pilar"]);

/** Aplica un estado a una pieza. Las lesiones se acumulan; los demás estados reemplazan al principal. */
export function applyToothStatus(state: ToothStatusState, status: string): ToothStatusState {
  if (status === "Sin hallazgos") return { extras: [] };
  if (!isLesionStatus(status)) {
    if (CLEARS_LESIONS.has(status)) return { primary: status, extras: [] };
    const kept = [...(state.primary && isLesionStatus(state.primary) ? [state.primary] : []), ...state.extras];
    return { primary: status, extras: kept };
  }
  if (state.primary && CLEARS_LESIONS.has(state.primary) && state.primary !== "Sin hallazgos") return { ...state, extras: [...state.extras] };
  if (!state.primary) return { primary: status, extras: [...state.extras] };
  if (state.primary === status || state.extras.includes(status)) return { ...state, extras: [...state.extras] };
  return { ...state, extras: [...state.extras, status] };
}

/** Quita una lesión concreta; si era la principal, la siguiente pasa a ser la principal. */
export function removeToothLesion(state: ToothStatusState, status: string): ToothStatusState {
  if (state.primary === status) return { primary: state.extras[0], extras: state.extras.slice(1) };
  return { ...state, extras: state.extras.filter((item) => item !== status) };
}

export function allToothStatuses(state: ToothStatusState): string[] {
  return [...(state.primary ? [state.primary] : []), ...state.extras];
}

/** Aplica un estado a una pieza de un odontograma (principal + lesiones adicionales). */
export function applyStatusToChart(chart: { teeth: Record<number, string>; extras?: Record<number, string[]> }, tooth: number, status: string) {
  const next = applyToothStatus({ primary: chart.teeth[tooth], extras: chart.extras?.[tooth] ?? [] }, status);
  if (next.primary && next.primary !== "Sin hallazgos") chart.teeth[tooth] = next.primary; else delete chart.teeth[tooth];
  setExtras(chart, tooth, next.extras);
}

/** Quita una lesión de la pieza (principal o adicional). */
export function removeLesionFromChart(chart: { teeth: Record<number, string>; extras?: Record<number, string[]> }, tooth: number, status: string) {
  const next = removeToothLesion({ primary: chart.teeth[tooth], extras: chart.extras?.[tooth] ?? [] }, status);
  if (next.primary) chart.teeth[tooth] = next.primary; else delete chart.teeth[tooth];
  setExtras(chart, tooth, next.extras);
}

function setExtras(chart: { extras?: Record<number, string[]> }, tooth: number, extras: string[]) {
  if (extras.length) { chart.extras = chart.extras ?? {}; chart.extras[tooth] = extras; }
  else if (chart.extras) delete chart.extras[tooth];
}

/** Deja `extras` coherente: solo lesiones, sin duplicar el principal, y nada en piezas ausentes/implantes/con exodoncia indicada. */
export function pruneChartExtras(chart: { teeth: Record<number, string>; extras?: Record<number, string[]> }) {
  if (!chart.extras) return;
  for (const key of Object.keys(chart.extras)) {
    const tooth = Number(key), primary = chart.teeth[tooth];
    const blocked = primary !== undefined && CLEARS_LESIONS.has(primary) && primary !== "Sin hallazgos";
    const list = blocked ? [] : [...new Set((chart.extras[tooth] ?? []).filter((item) => isLesionStatus(item) && item !== primary))];
    if (list.length) chart.extras[tooth] = list; else delete chart.extras[tooth];
  }
}
