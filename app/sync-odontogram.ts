import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { toothStatuses } from "@/db/schema";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import type { OdontogramData } from "@/app/clinical-data";

// The clinical note remains the history; the chart is a projection of the current state.
export async function syncInstalledImplants(ownerId: string, patientId: number, body: string, recordedAt: string) {
  const teeth = installedImplantTeeth(body);
  const crown = cementedCrownFromEvolution(body);
  if (!teeth.length && !crown) return { updatedTeeth: [] as number[], odontogram: null as OdontogramData | null };
  const db = getDb();
  const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  // A later manual examination must win over replaying an earlier evolution.
  const chartIsNewer = Boolean(old && old.updatedAt > recordedAt);
  const raw = old ? JSON.parse(old.data) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Odontograma inválido");
  const data: OdontogramData = {
    teeth: { ...(raw.teeth ?? {}) }, surfaces: { ...(raw.surfaces ?? {}) },
    missingReason: { ...(raw.missingReason ?? {}) }, crowns: { ...(raw.crowns ?? {}) },
  };
  const updatedTeeth: number[] = [];
  for (const tooth of chartIsNewer ? [] : teeth) {
    if (data.teeth[tooth] === "Implante") continue;
    data.teeth[tooth] = "Implante";
    // Surface findings and missing-tooth reason described the former tooth, not the new implant.
    delete data.surfaces[tooth];
    delete data.missingReason[tooth];
    delete data.crowns?.[tooth];
    updatedTeeth.push(tooth);
  }
  if (crown && (!chartIsNewer || data.teeth[crown.tooth] === "Corona") && data.teeth[crown.tooth] !== "Implante" && data.teeth[crown.tooth] !== "Ausente") {
    const existing = data.crowns?.[crown.tooth];
    if (!existing && (data.teeth[crown.tooth] !== "Corona" || crown.material)) {
      data.teeth[crown.tooth] = "Corona";
      if (crown.material) data.crowns![crown.tooth] = { material: crown.material, shade: crown.shade, source: "evolution" };
      updatedTeeth.push(crown.tooth);
    }
  }
  if (!updatedTeeth.length) return { updatedTeeth, odontogram: data };
  const updatedAt = new Date().toISOString();
  await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt })
    .onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
  const [verified] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  if (!verified || updatedTeeth.some(tooth => JSON.parse(verified.data).teeth[tooth] !== "Implante")) throw new Error("No se verificó el odontograma");
  return { updatedTeeth, odontogram: data };
}
