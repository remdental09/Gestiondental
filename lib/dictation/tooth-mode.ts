import type { OdontogramChange, ToothStatus } from "./proposal.ts";
import type { OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";
import type { BudgetItem } from "@/lib/budget-plans";

export type ToothDictationOperation =
  | { kind: "status"; status: ToothStatus; missingReason?: "caries" | "other" | "unknown" }
  | { kind: "surface"; surface: OdontogramSurface; finding: SurfaceFinding }
  | { kind: "crown"; material: string; shade?: string | null; foundation?: "tooth" | "implant" }
  | { kind: "diagnosis"; title: string; detail: string };

export function toothDiagnosisOperation(transcript: string, plan?: string, performed = false): Extract<ToothDictationOperation, { kind: "diagnosis" }> | null {
  const diagnosis = transcript.replace(/\s+/g, " ").trim();
  const treatmentPlan = plan?.replace(/\s+/g, " ").trim();
  if (!diagnosis) return null;
  const detail = treatmentPlan
    ? `Diagnóstico / hipótesis: ${diagnosis.slice(0, 440)}. ${performed ? "Procedimiento realizado" : "Plan de tratamiento preliminar"}: ${treatmentPlan.slice(0, 440)}.`.slice(0, 1000)
    : diagnosis.slice(0, 1000);
  return { kind: "diagnosis", title: treatmentPlan ? (performed ? "Diagnóstico y procedimiento realizado" : "Diagnóstico / hipótesis y plan preliminar") : "Diagnóstico / hipótesis (dictado)", detail };
}

/** A guided plan is always a draft: leave the fee undefined and bind the row to the selected tooth. */
export function toothPlanBudgetItem(label: string, tooth: number, code?: string): BudgetItem {
  return {
    label: label.trim().slice(0, 180),
    amount: 0,
    phase: "Fase 1",
    discountPercent: 0,
    teeth: [tooth],
    ...(code && /^\d{7}$/.test(code) ? { code } : {}),
  };
}

/** Un dictado sin tono conserva el color que ya estaba registrado. */
export function crownShadeAfterDictation(proposed: string | null | undefined, current: string | null | undefined): string | null {
  return proposed ?? current ?? null;
}

export function scopeToothProposal(changes: OdontogramChange[], selectedTooth: number) {
  const otherTeeth = [...new Set(changes.filter((change) => change.tooth !== selectedTooth).map((change) => change.tooth))].sort((a, b) => a - b);
  return {
    otherTeeth,
    changes: otherTeeth.length ? [] : changes.filter((change) => change.tooth === selectedTooth),
  };
}

export function isProximalChange(change: OdontogramChange): boolean {
  return change.kind === "surface" && (change.surface === "M" || change.surface === "D");
}

export function confirmedCariesFaces(
  faces: readonly ("M" | "D")[],
  existing: Partial<Record<OdontogramSurface, SurfaceFinding>> | undefined,
): ToothDictationOperation[] {
  return faces.map(surface => ({
    kind: "surface",
    surface,
    finding: existing?.[surface]?.condition === "caries"
      ? existing[surface]
      : { condition: "caries", depth: null, icdas: null, activity: null },
  }));
}

/** Convierte una propuesta revisable al formato acotado que acepta la escritura atómica del odontograma. */
export function toothDictationOperation(change: OdontogramChange): ToothDictationOperation | null {
  if (change.conflict || change.advisory || change.coherence === "incoherente") return null;
  if (change.kind === "status" && change.status) {
    return { kind: "status", status: change.status, ...(change.missingReason ? { missingReason: change.missingReason } : {}) };
  }
  if (change.kind === "surface" && change.surface && change.finding) {
    return { kind: "surface", surface: change.surface, finding: change.finding };
  }
  if (change.kind === "crown" && change.material) {
    return {
      kind: "crown",
      material: change.material,
      ...(change.shade !== undefined ? { shade: change.shade } : {}),
      ...(change.foundation ? { foundation: change.foundation } : {}),
    };
  }
  return null;
}
