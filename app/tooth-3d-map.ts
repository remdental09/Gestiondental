import type { OdontogramSurface } from "@/app/clinical-data";

export type ToothKind = "incisor" | "canine" | "premolar" | "molar";
export type AxisName = "x" | "y" | "z";

const PRIMARY_LETTERS: Record<number, string> = {
  55: "A", 54: "B", 53: "C", 52: "D", 51: "E", 61: "F", 62: "G", 63: "H", 64: "I", 65: "J",
  75: "K", 74: "L", 73: "M", 72: "N", 71: "O", 81: "P", 82: "Q", 83: "R", 84: "S", 85: "T",
};

/** Same fills as the 2D odontogram surface marks. */
export const SURFACE_MARK_COLORS = {
  caries: "#ef8b83",
  restored: "#6fc1e2",
  other_restoration: "#6fc1e2",
  sealant: "#f3d36b",
  sound: "#a9d9b2",
  not_examined: "#f4ead8",
} as const;

export function surfaceMarkColor(condition: string | undefined): string {
  if (condition === "caries") return SURFACE_MARK_COLORS.caries;
  if (condition === "restored" || condition === "other_restoration") return SURFACE_MARK_COLORS.restored;
  if (condition === "sealant") return SURFACE_MARK_COLORS.sealant;
  if (condition === "sound") return SURFACE_MARK_COLORS.sound;
  return SURFACE_MARK_COLORS.not_examined;
}

export function toothKind(tooth: number): ToothKind {
  const position = tooth % 10;
  const primary = Math.floor(tooth / 10) >= 5;
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (primary || position >= 6) return "molar";
  return "premolar";
}

export function toothKindLabel(kind: ToothKind): string {
  if (kind === "incisor") return "Incisivo";
  if (kind === "canine") return "Canino";
  if (kind === "premolar") return "Premolar";
  return "Molar";
}

export function isUpperTooth(tooth: number): boolean {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
}

export function isPatientRight(tooth: number): boolean {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8;
}

/** Upper molars have three roots; lower molars two; the other types one. */
export function rootCount(tooth: number): number {
  if (toothKind(tooth) !== "molar") return 1;
  return isUpperTooth(tooth) ? 3 : 2;
}

export function bitingFaceName(tooth: number): "Incisal" | "Oclusal" {
  return tooth % 10 <= 3 ? "Incisal" : "Oclusal";
}

export function innerFaceName(tooth: number): "Palatina" | "Lingual" {
  return isUpperTooth(tooth) ? "Palatina" : "Lingual";
}

export function chileLabel(tooth: number): string {
  const primary = PRIMARY_LETTERS[tooth];
  if (primary) return `Chile ${primary}`;
  const quadrant = Math.floor(tooth / 10);
  const position = tooth % 10;
  if (quadrant < 1 || quadrant > 4 || position < 1 || position > 8) return "Chile sin equivalencia";
  const number = quadrant === 1 ? 9 - position : quadrant === 2 ? 8 + position : quadrant === 3 ? 24 + position : 25 - position;
  return `Chile ${number}`;
}

/**
 * Local axes of the inspection model. +Y is the biting face, +Z is vestibular
 * (toward the viewer at rest). Mesial is +X on the patient's right (quadrants
 * 1, 4, 5 and 8) and −X on the patient's left, matching the 2D chart.
 */
export function surfaceAxis(tooth: number, surface: OdontogramSurface): { axis: AxisName; sign: 1 | -1 } {
  if (surface === "O") return { axis: "y", sign: 1 };
  if (surface === "V") return { axis: "z", sign: 1 };
  if (surface === "P") return { axis: "z", sign: -1 };
  const mesialPositiveX = isPatientRight(tooth);
  if (surface === "M") return { axis: "x", sign: mesialPositiveX ? 1 : -1 };
  return { axis: "x", sign: mesialPositiveX ? -1 : 1 };
}
