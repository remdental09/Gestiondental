import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { patients, periodontalExams } from "@/db/schema";

type Args = Record<string, unknown>;
type Database = ReturnType<typeof getDb>;
type VerifyIdentity = (ownerId: string, patientId: number, name: string, args: Args, db: Database) => Promise<Args | null>;
const object = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);
const only = (value: Args, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

export const periodontalExamTool = {
  name: "save_periodontal_exam",
  title: "Guardar examen periodontal",
  description: "Agrega un examen periodontal independiente para una ficha identificada y relee lo guardado. No fusiona con exámenes previos ni infiere diagnóstico. Por cada sitio informado, bleeding y suppuration son obligatorios: false solo cuando se consignó ausencia; si se desconoce alguno, pide aclaración antes de guardar ese sitio. Si el resultado es incierto, relee la ficha antes de reintentar; no hay idempotencia concurrente.",
  inputSchema: {
    type: "object",
    properties: {
      patientId: { type: "integer", description: "ID de la ficha encontrada" },
      fullName: { type: "string", description: "Nombre registrado en la ficha" },
      identityBirthDate: { type: "string", description: "Fecha de nacimiento si hace falta distinguir homónimos" },
      identityRut: { type: "string", description: "RUT si hace falta distinguir homónimos" },
      teeth: {
        type: "object", description: "Piezas permanentes con claves FDI compactas, por ejemplo 36 para FDI 3.6; sin inferir datos omitidos.",
        additionalProperties: {
          type: "object", properties: {
            sites: { type: "object", description: "Sitios MV, V, DV, ML, L y DL; omitir sitios no registrados. Para sangrado y supuración, false significa ausencia expresamente documentada, no desconocido.", additionalProperties: { type: "object", properties: { depth: { type: ["integer", "null"] }, margin: { type: ["integer", "null"] }, bleeding: { type: "boolean", description: "false solo si se constató ausencia; si no consta, solicita aclaración." }, suppuration: { type: "boolean", description: "false solo si se constató ausencia; si no consta, solicita aclaración." } }, required: ["depth", "margin", "bleeding", "suppuration"], additionalProperties: false } },
            gingivalIndex: { type: "object", description: "Índice Löe-Silness por V, L, D o M", additionalProperties: { type: "integer", minimum: 0, maximum: 3 } },
            mobility: { type: "string", enum: ["", "0", "I", "II", "III"] },
            furcation: { type: "string", enum: ["", "I", "II", "III"] },
          }, additionalProperties: false,
        },
      },
      epb: { type: "object", description: "EPB por sextante 1 a 6", additionalProperties: { type: "string", enum: ["0", "1", "2", "3", "4", "*"] } },
      classification: { type: "object", description: "Clasificación AAP-EFP consignada por el profesional; no inferirla.", properties: { system: { type: "string", enum: ["AAP-EFP 2017"] }, stage: { type: "string", enum: ["I", "II", "III", "IV"] }, grade: { type: "string", enum: ["A", "B", "C"] }, extent: { type: "string", enum: ["localized", "generalized", "molar-incisor"] } }, required: ["system"], additionalProperties: false },
      confirmed: { type: "boolean", description: "true solo tras autorización del clínico" },
    }, required: ["patientId", "fullName", "teeth", "confirmed"], additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
} as const;

/** Valida únicamente valores expresados: no calcula diagnóstico, estadio ni mediciones. */
export function validPeriodontalSnapshot(teeth: unknown, epb: unknown, classification: unknown): boolean {
  if (!object(teeth)) return false;
  let hasContent = false;
  for (const [key, raw] of Object.entries(teeth)) {
    if (!/^[1-4][1-8]$/.test(key) || !object(raw) || !only(raw, ["sites", "gingivalIndex", "mobility", "furcation"])) return false;
    let toothHasContent = false;
    if (raw.sites !== undefined) {
      if (!object(raw.sites)) return false;
      for (const [site, value] of Object.entries(raw.sites)) {
        if (!["MV", "V", "DV", "ML", "L", "DL"].includes(site) || !object(value) || !only(value, ["depth", "margin", "bleeding", "suppuration"])) return false;
        if (!(value.depth === null || (Number.isInteger(value.depth) && Number(value.depth) >= 0 && Number(value.depth) <= 20))) return false;
        if (!(value.margin === null || (Number.isInteger(value.margin) && Number(value.margin) >= -10 && Number(value.margin) <= 20))) return false;
        if (typeof value.bleeding !== "boolean" || typeof value.suppuration !== "boolean") return false;
        toothHasContent = true;
      }
    }
    if (raw.gingivalIndex !== undefined) {
      if (!object(raw.gingivalIndex)) return false;
      for (const [site, value] of Object.entries(raw.gingivalIndex)) {
        if (!["V", "L", "D", "M"].includes(site) || !Number.isInteger(value) || Number(value) < 0 || Number(value) > 3) return false;
        toothHasContent = true;
      }
    }
    if (raw.mobility !== undefined && (typeof raw.mobility !== "string" || !["", "0", "I", "II", "III"].includes(raw.mobility))) return false;
    if (raw.furcation !== undefined && (typeof raw.furcation !== "string" || !["", "I", "II", "III"].includes(raw.furcation))) return false;
    toothHasContent ||= Boolean(raw.mobility || raw.furcation);
    if (!toothHasContent) return false;
    hasContent = true;
  }
  if (epb !== undefined && (!object(epb) || Object.entries(epb).some(([key, value]) => !["1", "2", "3", "4", "5", "6"].includes(key) || typeof value !== "string" || !["0", "1", "2", "3", "4", "*"].includes(value)))) return false;
  if (classification !== undefined && (!object(classification) || !only(classification, ["system", "stage", "grade", "extent"]) || classification.system !== "AAP-EFP 2017" || (classification.stage !== undefined && !["I", "II", "III", "IV"].includes(String(classification.stage))) || (classification.grade !== undefined && !["A", "B", "C"].includes(String(classification.grade))) || (classification.extent !== undefined && !["localized", "generalized", "molar-incisor"].includes(String(classification.extent))))) return false;
  if (object(epb) && Object.keys(epb).length > 0) hasContent = true;
  if (object(classification) && (classification.stage !== undefined || classification.grade !== undefined || classification.extent !== undefined)) hasContent = true;
  return hasContent;
}

/** Agrega una instantánea y verifica su lectura; un resultado incierto exige inspección antes de reintentar. */
export async function savePeriodontalExam(ownerId: string, args: Args, verifyIdentity: VerifyIdentity) {
  if (args.confirmed !== true) return { saved: false, needsConfirmation: true, message: "Confirma el examen periodontal antes de guardarlo." };
  const patientId = Number(args.patientId);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { saved: false, missingFields: ["Paciente"] };
  if (!validPeriodontalSnapshot(args.teeth, args.epb, args.classification)) return { saved: false, invalidFields: ["Examen periodontal"], message: "Revisa las piezas FDI, los sitios y los valores del examen." };
  const snapshot = { teeth: args.teeth, ...(args.epb !== undefined ? { epb: args.epb } : {}), ...(args.classification !== undefined ? { classification: args.classification } : {}) };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 150000) return { saved: false, invalidFields: ["Examen periodontal"], message: "El examen excede el tamaño permitido." };
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { saved: false, error: "No encontré esa ficha. Busca al paciente antes de guardar." };
  const identityError = await verifyIdentity(ownerId, patientId, patient.name, args, db);
  if (identityError) return { saved: false, ...identityError, patient };
  let saved: { id: number } | undefined;
  const recordedAt = new Date().toISOString();
  try {
    [saved] = await db.insert(periodontalExams).values({ ownerId, patientId, recordedAt, teeth: serialized }).returning({ id: periodontalExams.id });
  } catch {
    return { saved: false, verificationFailed: true, message: "No se pudo confirmar la escritura; relee la ficha antes de reintentar." };
  }
  if (!saved?.id) return { saved: false, verificationFailed: true, message: "No se obtuvo el identificador; relee la ficha antes de reintentar." };
  try {
    const [verified] = await db.select({ id: periodontalExams.id, teeth: periodontalExams.teeth, recordedAt: periodontalExams.recordedAt }).from(periodontalExams).where(and(eq(periodontalExams.id, saved.id), eq(periodontalExams.ownerId, ownerId), eq(periodontalExams.patientId, patientId))).limit(1);
    if (verified?.teeth !== serialized || verified.recordedAt !== recordedAt) return { saved: false, verificationFailed: true, examId: saved.id, message: "No se pudo verificar la lectura; inspecciona la ficha antes de reintentar." };
    return { saved: true, verified: true, patient, exam: { id: verified.id, recordedAt: verified.recordedAt, ...snapshot } };
  } catch {
    return { saved: false, verificationFailed: true, examId: saved.id, message: "No se pudo releer el examen; inspecciona la ficha antes de reintentar." };
  }
}
