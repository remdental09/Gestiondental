import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { patients, periodontalExams, toothStatuses } from "@/db/schema";

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);

/** Lee las estructuras guardadas sin inventar un examen vacío cuando los datos están dañados. */
export async function readDentalChart(ownerId: string, patientIdInput: unknown) {
  if (!ownerId.trim()) return { found: false, error: "Se requiere una identidad autenticada." };
  const patientId = Number(patientIdInput);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { found: false, error: "El ID de paciente no es válido." };
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, name: patients.name }).from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { found: false, error: "No encontré esa ficha en Gestión Dental." };
  const [charts, exams] = await Promise.all([
    db.select({ data: toothStatuses.data, updatedAt: toothStatuses.updatedAt }).from(toothStatuses)
      .where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1),
    db.select({ id: periodontalExams.id, recordedAt: periodontalExams.recordedAt, teeth: periodontalExams.teeth }).from(periodontalExams)
      .where(and(eq(periodontalExams.ownerId, ownerId), eq(periodontalExams.patientId, patientId)))
      .orderBy(desc(periodontalExams.recordedAt), desc(periodontalExams.id)).limit(10),
  ]);
  try {
    let odontogram: ObjectValue | null = null;
    if (charts[0]) {
      const parsed: unknown = JSON.parse(charts[0].data);
      if (!isObject(parsed) || ["teeth", "surfaces", "missingReason", "crowns"].some(key => parsed[key] !== undefined && !isObject(parsed[key])) || (parsed.history !== undefined && !Array.isArray(parsed.history))) throw new Error("odontogram");
      odontogram = parsed;
    }
    const periodontalHistory = exams.map(exam => {
      const parsed: unknown = JSON.parse(exam.teeth);
      if (!isObject(parsed)) throw new Error("periodontal");
      // Versiones anteriores guardaban directamente el mapa de piezas.
      if ("teeth" in parsed && !isObject(parsed.teeth)) throw new Error("periodontal");
      const snapshot = "teeth" in parsed ? parsed : { teeth: parsed };
      return { ...snapshot, id: exam.id, recordedAt: exam.recordedAt };
    });
    return { found: true, patient, odontogram, odontogramUpdatedAt: charts[0]?.updatedAt ?? null, periodontalExams: periodontalHistory };
  } catch {
    return { found: false, readError: true, error: "No se pudo leer con seguridad el odontograma o el periodontograma almacenado. Revisa la ficha antes de modificarla." };
  }
}
