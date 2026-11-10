import type { OdontogramData } from "../app/clinical-data.ts";

export type ChartIssue = { tooth: number; problem: string; fix: string };

const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const PRIMARY = (tooth: number) => Math.floor(tooth / 10) >= 5;
const NAMES: Record<string, string> = { caries: "caries", restored: "obturación", sealant: "sellante", other_restoration: "otra restauración" };

/**
 * Auditoría del odontograma guardado: combinaciones que no pueden existir en una boca real.
 * No corrige nada: lista cada problema con la pieza y qué revisar.
 */
export function auditChart(chart: OdontogramData): ChartIssue[] {
  const issues: ChartIssue[] = [];
  const statusOf = (tooth: number) => chart.teeth[tooth] ?? "Sin hallazgos";
  const teeth = new Set<number>([...Object.keys(chart.teeth), ...Object.keys(chart.surfaces), ...Object.keys(chart.crowns ?? {})].map(Number));
  for (const tooth of [...teeth].sort((a, b) => a - b)) {
    const status = statusOf(tooth);
    const faces = Object.entries(chart.surfaces[tooth] ?? {}).filter(([, f]) => f && f.condition !== "not_examined" && f.condition !== "sound");
    const crown = chart.crowns?.[tooth];
    const implant = status === "Implante" || status === "Implante con pilar";
    const list = faces.map(([face, f]) => `${NAMES[f!.condition] ?? f!.condition} ${face}`).join(", ");
    if ((implant || status === "Ausente") && faces.length)
      issues.push({ tooth, problem: `figura como ${status.toLowerCase()} pero conserva caras de diente natural (${list}).`, fix: "Si las caras son de antes de perder la pieza, déjalas «Sin examinar»; si la pieza sigue ahí, corrige el estado." });
    if (status === "Ausente" && crown)
      issues.push({ tooth, problem: "figura ausente pero tiene una corona registrada.", fix: "Revisa si la pieza está o si la corona va sobre implante." });
    if (crown?.foundation === "implant" && !implant)
      issues.push({ tooth, problem: `tiene corona sobre implante pero el estado es «${status}».`, fix: "Marca la pieza como implante o corrige el soporte de la corona." });
    if (status === "Corona" && faces.some(([, f]) => f?.condition === "sealant"))
      issues.push({ tooth, problem: "tiene corona y un sellante en una cara; bajo una corona no queda superficie sellable.", fix: "Revisa el sellante (probablemente anterior a la corona)." });
    if (PRIMARY(tooth) && [...teeth].some(other => !PRIMARY(other) && (statusOf(other) === "Implante" || statusOf(other) === "Implante con pilar")))
      issues.push({ tooth, problem: "es una pieza temporal en una ficha con implantes (adulto).", fix: "Revisa si se quiso registrar la pieza permanente (p. ej. 3.4 en vez de 7.4)." });
  }
  return issues;
}

export const describeIssue = (issue: ChartIssue) => `FDI ${fdi(issue.tooth)}: ${issue.problem}`;
