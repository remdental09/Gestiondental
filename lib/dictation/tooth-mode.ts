import type { OdontogramChange, ToothStatus } from "./proposal.ts";
import type { OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";

export type ToothDictationOperation =
  | { kind: "status"; status: ToothStatus; missingReason?: "caries" | "other" | "unknown" }
  | { kind: "surface"; surface: OdontogramSurface; finding: SurfaceFinding }
  | { kind: "crown"; material: string; shade?: string | null; foundation?: "tooth" | "implant" };

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
