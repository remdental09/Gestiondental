import type { PerioSiteKey, PerioTooth } from "./clinical-data";

export const PERIO_3D_KEYS: PerioSiteKey[] = ["MV", "V", "DV", "ML", "L", "DL"];

export function periodontalMarkers(tooth: number, outline: { left: number; right: number; front: number; back: number }, sites: PerioTooth["sites"]) {
  const { left, right, front, back } = outline;
  const patientRight = [1, 4, 5, 8].includes(Math.floor(tooth / 10));
  const mesial = patientRight ? right : left, distal = patientRight ? left : right;
  const center = (left + right) / 2;
  const points: Record<PerioSiteKey, [number, number]> = {
    MV: [center + (mesial - center) * 0.65, front + 0.10], V: [center, front + 0.13], DV: [center + (distal - center) * 0.65, front + 0.10],
    ML: [center + (mesial - center) * 0.65, back - 0.10], L: [center, back - 0.13], DL: [center + (distal - center) * 0.65, back - 0.10],
  };
  return PERIO_3D_KEYS.map(key => {
    const reading = sites[key];
    const depth = reading?.depth;
    const measured = depth !== null && depth !== undefined;
    return {
      key, x: points[key][0], z: points[key][1],
      length: measured ? Math.max(0.07, depth * 0.07) : 0.07,
      color: !measured ? 0x94a3b8 : depth >= 6 ? 0xbe123c : depth >= 4 ? 0xb45309 : 0x047857,
      bleeding: Boolean(reading?.bleeding), suppuration: Boolean(reading?.suppuration),
    };
  });
}
