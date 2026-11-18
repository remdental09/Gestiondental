import { formatFdiTooth, fdiToChile } from "../tooth-numbering.ts";

export type ToothGuidedStep = "diagnosis" | "plan";

/** Texto visible: conserva FDI y la nomenclatura nacional chilena juntas. */
export function toothPrompt(step: ToothGuidedStep, tooth: number): string {
  const piece = `la pieza FDI ${formatFdiTooth(tooth)} (Chile ${fdiToChile(tooth)})`;
  return step === "diagnosis"
    ? `¿Cuál es el diagnóstico o hipótesis diagnóstica de ${piece}?`
    : `¿Qué plan de tratamiento preliminar propones para ${piece}?`;
}

/** Etiqueta solo con nomenclatura chilena para la locución; permanentes se dicen como pieza número 1–32. */
export function toothChileSpeechLabel(tooth: number): string {
  const chile = fdiToChile(tooth);
  return /^\d+$/.test(chile) ? `la pieza número ${chile}` : `la pieza chilena ${chile}`;
}

/** La voz usa nomenclatura chilena; FDI queda como referencia visual. */
export function toothSpeechPrompt(step: ToothGuidedStep, tooth: number): string {
  const piece = toothChileSpeechLabel(tooth);
  return step === "diagnosis"
    ? `¿Cuál es el diagnóstico o hipótesis diagnóstica de ${piece}?`
    : `¿Qué plan de tratamiento preliminar propones para ${piece}?`;
}
