import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { evolutions, patients } from "@/db/schema";
import { ClinicalImportError, normalizeName, parseRecords, requestIdFor, type RecordPreview } from "@/app/clinical-import-validation";
export { ClinicalImportError } from "@/app/clinical-import-validation";

export async function runDriveRecordImport(ownerId: string, input: unknown, confirmed: boolean) {
  const records = parseRecords(input);
  const db = getDb();
  const folderIds = records.map(record => record.driveFolderId);
  const requestIds = records.flatMap(record => record.notes.map(requestIdFor));
  const [linkedPatients, priorNotes, ownerPatients] = await Promise.all([
    db.select({ id: patients.id, name: patients.name, driveFolderId: patients.driveFolderId })
      .from(patients).where(and(eq(patients.ownerId, ownerId), inArray(patients.driveFolderId, folderIds))),
    db.select({ requestId: evolutions.requestId, patientId: evolutions.patientId })
      .from(evolutions).where(and(eq(evolutions.ownerId, ownerId), inArray(evolutions.requestId, requestIds))),
    db.select({ name: patients.name, driveFolderId: patients.driveFolderId })
      .from(patients).where(eq(patients.ownerId, ownerId)).limit(10000),
  ]);
  const patientByFolder = new Map(linkedPatients.filter(p => p.driveFolderId).map(p => [p.driveFolderId as string, p]));
  const noteByRequestId = new Map(priorNotes.filter(n => n.requestId).map(n => [n.requestId as string, n]));
  const previews: RecordPreview[] = [];

  for (const record of records) {
    const linked = patientByFolder.get(record.driveFolderId);
    const sameNameMatches = linked ? 0 : ownerPatients.filter(p => normalizeName(p.name) === normalizeName(record.name) && p.driveFolderId !== record.driveFolderId).length;
    let notesToCreate = 0;
    let notesAlreadyPresent = 0;
    for (const note of record.notes) {
      const old = noteByRequestId.get(requestIdFor(note));
      if (old && (!linked || old.patientId !== linked.id)) {
        throw new ClinicalImportError("Un documento con esta fecha ya está vinculado a otra ficha. No se importó el lote.", 409);
      }
      if (old) notesAlreadyPresent++;
      else notesToCreate++;
    }
    previews.push({
      name: record.name,
      patientAlreadyLinked: Boolean(linked),
      linkedPatientName: linked?.name ?? null,
      notesToCreate,
      notesAlreadyPresent,
      sameNameMatches,
    });
  }

  if (confirmed && previews.some((item, index) => item.sameNameMatches > 0 && !records[index].confirmedDifferentPatient)) {
    return {
      imported: false,
      needsClarification: true,
      message: "Hay fichas con el mismo nombre. Confirma por separado que cada registro nuevo corresponde a otra persona antes de importar; no se combinaron pacientes.",
      preview: previews,
    };
  }

  if (!confirmed) return { imported: false, needsConfirmation: true, preview: previews };

  const result = { patientsCreated: 0, notesCreated: 0, patientsExisting: 0, notesExisting: 0 };
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    let patient = patientByFolder.get(record.driveFolderId);
    if (!patient) {
      const [created] = await db.insert(patients).values({
        ownerId,
        name: record.name,
        birthDate: record.birthDate,
        reason: record.reason,
        status: "Sin registrar",
        history: record.history,
        allergies: record.allergies,
        driveFolderId: record.driveFolderId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning({ id: patients.id, name: patients.name, driveFolderId: patients.driveFolderId });
      patient = created;
      patientByFolder.set(record.driveFolderId, patient);
      result.patientsCreated++;
    } else result.patientsExisting++;

    for (const note of record.notes) {
      const requestId = requestIdFor(note);
      const old = noteByRequestId.get(requestId);
      if (old) {
        if (old.patientId !== patient.id) throw new ClinicalImportError("Documento ya asignado a otra ficha. El lote se detuvo.", 409);
        result.notesExisting++;
        continue;
      }
      await db.insert(evolutions).values({
        ownerId,
        patientId: patient.id,
        clinicalDate: note.clinicalDate,
        recordedAt: new Date().toISOString(),
        title: note.title,
        body: note.body,
        sourceDocumentId: note.sourceDocumentId,
        requestId,
        backupStatus: "source_in_drive",
      });
      result.notesCreated++;
    }
  }
  const [savedPatients, savedNotes] = await Promise.all([
    db.select({ id: patients.id, driveFolderId: patients.driveFolderId }).from(patients)
      .where(and(eq(patients.ownerId, ownerId), inArray(patients.driveFolderId, folderIds))),
    db.select({ requestId: evolutions.requestId, patientId: evolutions.patientId }).from(evolutions)
      .where(and(eq(evolutions.ownerId, ownerId), inArray(evolutions.requestId, requestIds))),
  ]);
  const savedByFolder = new Map(savedPatients.map(p => [p.driveFolderId, p.id]));
  const savedByRequest = new Map(savedNotes.map(n => [n.requestId, n.patientId]));
  if (records.some(record => !savedByFolder.has(record.driveFolderId) || record.notes.some(note => savedByRequest.get(requestIdFor(note)) !== savedByFolder.get(record.driveFolderId)))) {
    throw new ClinicalImportError("Se realizaron cambios, pero la lectura posterior no confirmó todo el lote. Revisa las fichas antes de reintentar.", 503);
  }
  return { imported: true, verified: true, result };
}
