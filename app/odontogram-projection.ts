import type { CrownEvidence } from "@/app/crown-evidence";
import type { CrownDetails, OdontogramData } from "@/app/clinical-data";

export type ChartExpectation = {
  tooth: number;
  status: "Implante" | "Corona";
  crownFoundation: "implant" | "tooth" | null;
};

function copyChart(source: OdontogramData): OdontogramData {
  return {
    teeth: { ...(source.teeth ?? {}) },
    surfaces: { ...(source.surfaces ?? {}) },
    missingReason: { ...(source.missingReason ?? {}) },
    crowns: { ...(source.crowns ?? {}) },
  };
}

function remember(updatedTeeth: number[], tooth: number) {
  if (!updatedTeeth.includes(tooth)) updatedTeeth.push(tooth);
}

/**
 * Projects installed implants and cemented crowns onto a chart copy.
 * A crown on a natural tooth stays «Corona». A crown on an implant keeps «Implante» and the prosthesis.
 */
export function projectEvolutionChart(source: OdontogramData, implants: number[], crown: CrownEvidence | null, chartIsNewer = false): { data: OdontogramData; updatedTeeth: number[]; expectations: ChartExpectation[] } {
  const data = copyChart(source);
  const updatedTeeth: number[] = [];
  const expectations: ChartExpectation[] = [];
  const crownOnThisImplant = (tooth: number) => Boolean(crown?.onImplant && crown.tooth === tooth);

  for (const tooth of chartIsNewer ? [] : implants) {
    const placingCrown = crownOnThisImplant(tooth);
    const existing = data.crowns?.[tooth];
    const keepCrown = placingCrown || existing?.foundation === "implant";
    if (data.teeth[tooth] !== "Implante") {
      data.teeth[tooth] = "Implante";
      delete data.surfaces[tooth];
      delete data.missingReason[tooth];
      if (!keepCrown) delete data.crowns?.[tooth];
      remember(updatedTeeth, tooth);
    } else if (!keepCrown && existing) {
      delete data.crowns?.[tooth];
      delete data.surfaces[tooth];
      delete data.missingReason[tooth];
      remember(updatedTeeth, tooth);
    }
    if (placingCrown && crown) {
      const next: CrownDetails = {
        material: crown.material ?? existing?.material ?? "",
        shade: crown.shade ?? existing?.shade ?? null,
        source: "evolution",
        foundation: "implant",
      };
      const previous = data.crowns?.[tooth];
      if (!previous || previous.foundation !== "implant" || (crown.material && previous.material !== crown.material) || (crown.shade && previous.shade !== crown.shade)) {
        data.crowns![tooth] = { ...previous, ...next };
        remember(updatedTeeth, tooth);
      }
    }
    expectations.push({
      tooth,
      status: "Implante",
      crownFoundation: data.crowns?.[tooth]?.foundation === "implant" ? "implant" : null,
    });
  }

  if (crown?.onImplant && chartIsNewer && data.teeth[crown.tooth] === "Implante" && !data.crowns?.[crown.tooth]) {
    data.crowns![crown.tooth] = { material: crown.material ?? "", shade: crown.shade, source: "evolution", foundation: "implant" };
    remember(updatedTeeth, crown.tooth);
    expectations.push({ tooth: crown.tooth, status: "Implante", crownFoundation: "implant" });
  }

  if (crown && !crown.onImplant) {
    const tooth = crown.tooth;
    const blocked = data.teeth[tooth] === "Implante" || data.teeth[tooth] === "Ausente";
    const canApply = !blocked && (!chartIsNewer || data.teeth[tooth] === "Corona");
    if (canApply) {
      const existing = data.crowns?.[tooth];
      if (!existing && (data.teeth[tooth] !== "Corona" || crown.material)) {
        data.teeth[tooth] = "Corona";
        if (crown.material) data.crowns![tooth] = { material: crown.material, shade: crown.shade, source: "evolution", foundation: "tooth" };
        remember(updatedTeeth, tooth);
      }
      expectations.push({ tooth, status: "Corona", crownFoundation: data.crowns?.[tooth] ? "tooth" : null });
    }
  }

  return { data, updatedTeeth, expectations: expectations.filter((item) => updatedTeeth.includes(item.tooth)) };
}

/** A crown update is verified as Corona. Only an implant position must read Implante. */
export function projectionHolds(saved: OdontogramData, expectations: ChartExpectation[]): boolean {
  return expectations.every((item) => {
    if (saved.teeth[item.tooth] !== item.status) return false;
    const crown = saved.crowns?.[item.tooth];
    if (item.status === "Corona") return crown?.foundation !== "implant";
    if (item.crownFoundation === "implant") return Boolean(crown && crown.foundation === "implant");
    return crown?.foundation !== "implant";
  });
}
