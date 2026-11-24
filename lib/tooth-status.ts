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
/** Etapas de una endodoncia: la pieza queda abierta («en proceso») hasta que se obtura («terminada»). Se acumulan sobre el estado principal. */
export const ENDO_STATUSES = ["Endodoncia en proceso", "Endodoncia terminada"] as const;
export const BASE_STATUSES = ["Sin hallazgos", "Implante", "Implante con pilar", "Corona", "Ausente", "Indicación de exodoncia", "Resto radicular con endodoncia"] as const;
export const ALL_TOOTH_STATUSES: readonly string[] = [...BASE_STATUSES, ...ENDO_STATUSES, ...APICAL_STATUSES, ...FRACTURE_STATUSES];
/** Las lesiones periapicales son etapas de un mismo proceso: la nueva reemplaza a la anterior (que queda en el historial). */
export const isApicalStatus = (status: string) => (APICAL_STATUSES as readonly string[]).includes(status);
export const isEndoStatus = (status: string) => (ENDO_STATUSES as readonly string[]).includes(status);
/** Estados que son etapas de un mismo proceso: el nuevo reemplaza al anterior de su cadena. */
const sameChain = (a: string, b: string) => (isApicalStatus(a) && isApicalStatus(b)) || (isEndoStatus(a) && isEndoStatus(b));
export const isLesionStatus = (status: string) => isEndoStatus(status) || (APICAL_STATUSES as readonly string[]).includes(status) || (FRACTURE_STATUSES as readonly string[]).includes(status);

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
  const primary = state.primary === "Sin hallazgos" ? undefined : state.primary;
  if (primary === status || state.extras.includes(status)) return { ...state, extras: [...state.extras] };
  // Periodontitis → absceso → granuloma → quiste → osteítis: el proceso apical evoluciona, no se suma.
  const extras = state.extras.filter((item) => !sameChain(item, status));
  if (!primary || sameChain(status, primary)) return { primary: status, extras };
  return { primary, extras: [...extras, status] };
}

/** Qué hace una lesión nueva sobre la pieza: se suma, reemplaza la etapa apical anterior o ya estaba. */
export function lesionEffect(state: ToothStatusState, status: string): { kind: "suma" | "igual" } | { kind: "reemplaza"; replaced: string } {
  const all = allToothStatuses(state);
  if (all.includes(status)) return { kind: "igual" };
  const previous = all.find((item) => sameChain(item, status));
  return previous ? { kind: "reemplaza", replaced: previous } : { kind: "suma" };
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
    let list = blocked ? [] : [...new Set((chart.extras[tooth] ?? []).filter((item) => isLesionStatus(item) && item !== primary))];
    // Solo una etapa apical vigente: la más reciente (al final de la lista); las anteriores quedan en el historial.
    for (const inChain of [isApicalStatus, isEndoStatus]) {
      const chain = list.filter(inChain);
      if (primary && inChain(primary) && chain.length) { chart.teeth[tooth] = chain[chain.length - 1]!; list = list.filter((item) => !inChain(item)); }
      else if (chain.length > 1) list = list.filter((item) => !inChain(item) || item === chain[chain.length - 1]);
    }
    if (list.length) chart.extras[tooth] = list; else delete chart.extras[tooth];
  }
}
