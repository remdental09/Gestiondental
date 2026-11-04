import { and, eq } from "drizzle-orm";
import { formatFdi, type OdontogramData, type OdontogramSurface, type SurfaceFinding } from "@/app/clinical-data";
import { appendToothHistory, toothHistorySnapshot } from "@/app/odontogram-history";
import { isCariesDepth } from "@/lib/caries";
import { getDb } from "@/db";
import { toothStatuses } from "@/db/schema";

const teeth = new Set([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]);
const keys = new Set(["V", "P", "M", "D", "O"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Call only after explicit authorization and patient/owner identity verification. */
export async function persistMcpToothSurface(ownerId: string, patientId: number, tooth: number, surface: string, rawFinding: unknown) {
  if (!Number.isSafeInteger(tooth) || !teeth.has(tooth) || !keys.has(surface) || !object(rawFinding)) return { saved: false, invalidFields: ["Pieza o superficie"] };
  const condition = text(rawFinding.condition);
  if (!["not_examined", "sound", "caries", "restored", "sealant", "other_restoration"].includes(condition)) return { saved: false, invalidFields: ["Estado de superficie"] };
  let finding: SurfaceFinding;
  if (condition === "caries") {
    const depth = rawFinding.depth;
    if ((depth != null && depth !== "" && !isCariesDepth(depth)) || (rawFinding.icdas != null && rawFinding.icdas !== "") || (rawFinding.activity != null && rawFinding.activity !== "")) return { saved: false, invalidFields: ["Profundidad de caries"], error: "Registra caries por profundidad; los datos anteriores de ICDAS y actividad se conservan automáticamente." };
    finding = { condition: "caries", depth: isCariesDepth(depth) ? depth : null, icdas: null, activity: null };
  } else {
    const stage = condition === "restored" ? text(rawFinding.restorationStage) : "";
    const material = condition === "restored" ? text(rawFinding.restorationMaterial) : "";
    if ((stage && !["provisional", "definitive"].includes(stage)) || (material && !["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Otro"].includes(material))) return { saved: false, invalidFields: ["Detalle de restauración"] };
    finding = { condition: condition as SurfaceFinding["condition"], depth: null, icdas: null, activity: null, ...(stage ? { restorationStage: stage as SurfaceFinding["restorationStage"] } : {}), ...(material ? { restorationMaterial: material as SurfaceFinding["restorationMaterial"] } : {}) };
  }

  const db = getDb();
  const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  let raw: unknown;
  try { raw = old ? JSON.parse(old.data) : {}; }
  catch { return { saved: false, error: "El odontograma existente no se pudo leer; no se modificó." }; }
  if (!object(raw)) return { saved: false, error: "El odontograma existente no tiene un formato válido; no se modificó." };
  for (const key of ["teeth", "surfaces", "missingReason", "crowns"]) if (raw[key] != null && !object(raw[key])) return { saved: false, error: "El odontograma existente tiene datos inválidos; no se modificó." };
  if (raw.history != null && !Array.isArray(raw.history)) return { saved: false, error: "El historial del odontograma no se pudo leer; no se modificó." };
  const record = (value: unknown) => object(value) ? value : {};
  const currentState = record(raw.teeth)[String(tooth)], legacyState = raw[String(tooth)];
  if ((currentState != null && typeof currentState !== "string") || (legacyState != null && typeof legacyState !== "string") || (typeof currentState === "string" && typeof legacyState === "string" && currentState !== legacyState)) return { saved: false, error: "Hay estados incompatibles para la pieza; revisa el odontograma antes de escribir." };
  const states = { ...record(raw.teeth) } as Record<number, string>;
  for (const [key, value] of Object.entries(raw)) if (/^\d{2}$/.test(key) && typeof value === "string" && !(key in states)) states[Number(key)] = value;
  const surfaces = { ...record(raw.surfaces) } as OdontogramData["surfaces"];
  if (surfaces[tooth] != null && !object(surfaces[tooth])) return { saved: false, error: "Las superficies registradas no se pudieron leer; no se modificó." };
  const chart: OdontogramData = { teeth: states, surfaces, missingReason: { ...record(raw.missingReason) } as OdontogramData["missingReason"], crowns: { ...record(raw.crowns) } as NonNullable<OdontogramData["crowns"]>, history: Array.isArray(raw.history) ? [...raw.history] as NonNullable<OdontogramData["history"]> : [] };
  if (["Ausente", "Implante", "Implante con pilar"].includes(chart.teeth[tooth] ?? "")) return { saved: false, error: "No se registran superficies dentarias en dientes ausentes o implantes." };
  const crown = chart.crowns?.[tooth];
  if (crown != null && !object(crown)) return { saved: false, error: "El detalle de corona no se pudo leer; no se modificó." };
  if (crown?.foundation === "implant") return { saved: false, error: "La corona figura sobre implante; revisa el soporte antes de registrar superficies dentarias." };
  const prior = chart.surfaces[tooth]?.[surface as OdontogramSurface];
  if (prior != null && !object(prior)) return { saved: false, error: "El hallazgo previo no se pudo leer; no se modificó." };
  if (finding.condition === "caries" && prior?.condition === "caries") {
    if ((prior.icdas != null && (!Number.isInteger(prior.icdas) || prior.icdas < 1 || prior.icdas > 6)) || (prior.activity != null && !["active", "inactive", "uncertain"].includes(prior.activity))) return { saved: false, error: "Los datos anteriores de caries no se pudieron leer; no se modificó." };
    finding = { ...finding, icdas: prior.icdas ?? null, activity: prior.activity ?? null };
  }
  if (finding.condition === "restored" && prior?.condition === "restored") finding = { ...finding, ...(!finding.restorationStage && prior.restorationStage ? { restorationStage: prior.restorationStage } : {}), ...(!finding.restorationMaterial && prior.restorationMaterial ? { restorationMaterial: prior.restorationMaterial } : {}) };
  const before = toothHistorySnapshot(chart, tooth);
  chart.surfaces[tooth] = { ...(chart.surfaces[tooth] ?? {}), [surface]: finding };
  const updatedAt = new Date().toISOString();
  appendToothHistory(chart, tooth, "surface", before, { recordedAt: updatedAt, source: "manual", surface: surface as OdontogramSurface, title: "Hallazgo actualizado en cara " + surface });
  const serialized = JSON.stringify({ ...raw, ...chart });
  const changed = old
    ? await db.update(toothStatuses).set({ data: serialized, updatedAt }).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId), eq(toothStatuses.data, old.data))).returning({ patientId: toothStatuses.patientId })
    : await db.insert(toothStatuses).values({ ownerId, patientId, data: serialized, updatedAt }).onConflictDoNothing({ target: toothStatuses.patientId }).returning({ patientId: toothStatuses.patientId });
  if (!changed.length) return { saved: false, concurrentChange: true, message: "El odontograma cambió en otra sesión; vuelve a leerlo antes de reintentar." };
  const [verified] = await db.select({ data: toothStatuses.data }).from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  if (!verified || verified.data !== serialized) return { saved: false, verificationFailed: true, message: "No se pudo verificar el odontograma; relee la ficha antes de reintentar." };
  return { saved: true, verified: true, patientId, toothFDI: tooth, toothFDILabel: formatFdi(tooth), surface, finding, odontogram: JSON.parse(verified.data) };
}
