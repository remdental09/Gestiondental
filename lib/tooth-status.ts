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
