import type { OdontogramData } from "./clinical-data";

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
