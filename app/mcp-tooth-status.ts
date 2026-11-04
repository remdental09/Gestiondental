import { and, eq } from "drizzle-orm";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { appendToothHistory, toothHistorySnapshot } from "@/app/odontogram-history";
import { getDb } from "@/db";
import { toothStatuses } from "@/db/schema";

/** Call only after the patient and owner identity have been verified. */
export async function persistMcpToothStatus(ownerId: string, patientId: number, tooth: number, status: string) {
  const db = getDb();
  const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  let raw: unknown;
  try { raw = old ? JSON.parse(old.data) : {}; }
  catch { return { saved: false, error: "El odontograma existente no se pudo leer con seguridad; no se modificó." }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { saved: false, error: "El odontograma existente no tiene un formato válido; no se modificó." };
  const source = raw as Record<string, unknown>;
  for (const key of ["teeth", "surfaces", "missingReason", "crowns"]) {
    const value = source[key];
    if (value != null && (typeof value !== "object" || Array.isArray(value))) return { saved: false, error: "El odontograma existente tiene datos inválidos; no se modificó." };
  }
  if (source.history != null && !Array.isArray(source.history)) return { saved: false, error: "El historial del odontograma no se pudo leer; no se modificó." };
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const teeth = { ...record(source.teeth) } as Record<number, string>;
  // Fichas antiguas pueden guardar los estados en claves FDI directamente en la raíz.
  for (const [key, value] of Object.entries(source)) if (/^\d{2}$/.test(key) && typeof value === "string" && !(key in teeth)) teeth[Number(key)] = value;
  const data: OdontogramData = {
    teeth,
    surfaces: { ...record(source.surfaces) } as OdontogramData["surfaces"],
    missingReason: { ...record(source.missingReason) } as OdontogramData["missingReason"],
    crowns: { ...record(source.crowns) } as NonNullable<OdontogramData["crowns"]>,
    history: Array.isArray(source.history) ? [...source.history] as NonNullable<OdontogramData["history"]> : [],
  };
  const crown = data.crowns?.[tooth];
  if (crown != null && (typeof crown !== "object" || Array.isArray(crown))) return { saved: false, error: "El detalle de corona no se pudo leer; no se modificó." };
  const before = toothHistorySnapshot(data, tooth);
  if (status === "Sin hallazgos") delete data.teeth[tooth];
  else data.teeth[tooth] = status;
  if (status === "Corona" && data.crowns?.[tooth]) data.crowns[tooth] = { ...data.crowns[tooth], foundation: "tooth" };
  else if (!(status === "Implante" && data.crowns?.[tooth]?.foundation === "implant")) delete data.crowns?.[tooth];
  const updatedAt = new Date().toISOString();
  appendToothHistory(data, tooth, "status", before, { recordedAt: updatedAt, source: "manual", title: status === "Sin hallazgos" ? "Estado registrado: sin hallazgos" : "Estado actualizado: " + status });
  const preserved: Record<string, unknown> = { ...source, ...data };
  // Evita que la lectura de fichas antiguas resucite un estado eliminado o corregido.
  delete preserved[String(tooth)];
  const serialized = JSON.stringify(preserved);
  // No sobrescribir cambios de otra sesión que llegaron después de nuestra lectura.
  const changed = old
    ? await db.update(toothStatuses).set({ data: serialized, updatedAt }).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId), eq(toothStatuses.data, old.data))).returning({ patientId: toothStatuses.patientId })
    : await db.insert(toothStatuses).values({ ownerId, patientId, data: serialized, updatedAt }).onConflictDoNothing({ target: toothStatuses.patientId }).returning({ patientId: toothStatuses.patientId });
  if (!changed.length) return { saved: false, concurrentChange: true, message: "El odontograma cambió en otra sesión; vuelve a leerlo antes de reintentar." };
  const [verified] = await db.select({ data: toothStatuses.data }).from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  if (!verified || verified.data !== serialized) return { saved: false, verificationFailed: true, message: "No se pudo verificar el odontograma; relee la ficha antes de reintentar." };
  return { saved: true, verified: true, patientId, toothFDI: tooth, toothFDILabel: formatFdi(tooth), status, odontogram: preserved };
}
