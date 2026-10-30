import type { OdontogramSurface } from "@/app/clinical-data";

export type SurfaceScreenSide = "top" | "bottom" | "left" | "right" | "center";

/**
 * Screen position of a surface on the existing occlusal drawing.
 * The upper arch is drawn above the lower one, as if looking at the patient.
 * Vestibular is the outer side (up on the upper arch, down on the lower).
 * Palatina/lingual is the inner side. Mesial points toward the midline.
 * Quadrants 5 and 8 follow the same rule as 1 and 4; 6 and 7 follow 2 and 3.
 */
export function surfaceScreenSide(tooth: number, surface: OdontogramSurface): SurfaceScreenSide {
  const quadrant = Math.floor(tooth / 10);
  const lower = quadrant === 3 || quadrant === 4 || quadrant === 7 || quadrant === 8;
  const mesialRight = quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8;
  if (surface === "O") return "center";
  if (surface === "V") return lower ? "bottom" : "top";
  if (surface === "P") return lower ? "top" : "bottom";
  if (surface === "M") return mesialRight ? "right" : "left";
  return mesialRight ? "left" : "right";
}
