import { formatFdiTooth } from "../tooth-numbering.ts";

export type ToothGuidedStep = "diagnosis" | "plan";

export function toothPrompt(step: ToothGuidedStep, tooth: number): string {
  const piece = `la pieza FDI ${formatFdiTooth(tooth)}`;
  return step === "diagnosis"
    ? `¿Cuál es el diagnóstico o hipótesis diagnóstica de ${piece}?`
    : `¿Qué plan de tratamiento preliminar propones para ${piece}?`;
}
