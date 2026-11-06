/**
 * Avisos suaves de una evolución: diagnóstico, plan y prestación que no aparecen en lo dictado.
 * Nunca bloquean el guardado ni crean datos: el profesional vincula, agrega o descarta cada aviso.
 * Una evolución puede ser solo el seguimiento de un diagnóstico antiguo, así que ninguno es obligatorio.
 */
export type EvolutionNoticeKey = "diagnostico" | "plan" | "prestacion";

export type EvolutionNoticeInput = {
  /** Procedimientos dictados como realizados. */
  procedures: number;
  /** Cambios aceptados en el odontograma. */
  acceptedTeeth: number;
  /** Lecturas periodontales aceptadas. */
  perio: number;
  /** Diagnósticos aceptados en esta evolución (incluye caries derivadas). */
  diagnoses: number;
  /** Presupuesto o plan propuesto en el dictado. */
  budget: number;
  /** El texto de la evolución ya trae una sección de plan de tratamiento. */
  planInBody: boolean;
  /** La ficha ya tiene presupuestos o un plan registrado. */
  chartHasPlan: boolean;
  /** Hay texto de evolución propuesto. */
  hasBody: boolean;
};

export type EvolutionNotice = { key: EvolutionNoticeKey; text: string };

export function evolutionNotices(input: EvolutionNoticeInput, dismissed: ReadonlySet<EvolutionNoticeKey> = new Set()): EvolutionNotice[] {
  if (!input.hasBody) return [];
  const hasPrestacion = input.procedures > 0 || input.acceptedTeeth > 0 || input.perio > 0;
  const hasPlan = input.budget > 0 || input.planInBody || input.chartHasPlan;
  const hasDiagnosis = input.diagnoses > 0;
  const notices: EvolutionNotice[] = [];
  if ((hasPrestacion || input.budget > 0) && !hasDiagnosis) {
    notices.push({ key: "diagnostico", text: "Esta evolución no tiene diagnóstico. Puedes vincular el vigente de la ficha, agregarlo ahora o dejarlo así." });
  }
  if (hasPrestacion && !hasPlan) {
    notices.push({ key: "plan", text: "No se dictó un plan de tratamiento y la ficha no tiene uno registrado." });
  }
  if (!hasPrestacion) {
    notices.push({ key: "prestacion", text: "No se detectó ninguna prestación realizada en esta evolución." });
  }
  return notices.filter((notice) => !dismissed.has(notice.key));
}
