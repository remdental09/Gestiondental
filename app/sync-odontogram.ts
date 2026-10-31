import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { toothStatuses } from "@/db/schema";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import type { OdontogramData } from "@/app/clinical-data";
import { projectEvolutionChart, projectionHolds } from "@/app/odontogram-projection";

// The clinical note remains the history; the chart is a projection of the current state.
export async function syncInstalledImplants(ownerId: string, patientId: number, body: string, recordedAt: string) {
  const implants = installedImplantTeeth(body);
  const crown = cementedCrownFromEvolution(body);
  if (!implants.length && !crown) return { updatedTeeth: [] as number[], odontogram: null as OdontogramData | null };
  const db = getDb();
  const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  // A later manual examination must win over replaying an earlier evolution.
  const chartIsNewer = Boolean(old && old.updatedAt > recordedAt);
  const raw = old ? JSON.parse(old.data) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Odontograma inválido");
  const source: OdontogramData = {
    teeth: { ...(raw.teeth ?? {}) }, surfaces: { ...(raw.surfaces ?? {}) },
    missingReason: { ...(raw.missingReason ?? {}) }, crowns: { ...(raw.crowns ?? {}) },
  };
  const projected = projectEvolutionChart(source, implants, crown, chartIsNewer);
  if (!projected.updatedTeeth.length) return { updatedTeeth: projected.updatedTeeth, odontogram: projected.data };
  const updatedAt = new Date().toISOString();
  await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(projected.data), updatedAt })
    .onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(projected.data), updatedAt } });
  const [verified] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  const saved: OdontogramData = verified ? JSON.parse(verified.data) : { teeth: {}, surfaces: {}, missingReason: {} };
  if (!verified || !projectionHolds(saved, projected.expectations)) throw new Error("No se verificó el odontograma");
  return { updatedTeeth: projected.updatedTeeth, odontogram: projected.data };
}
