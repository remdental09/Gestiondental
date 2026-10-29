import { and, asc, eq, gt, type AnyColumn } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointments, budgets, clinicalImages, driveBackups, evolutions,
  patients, periodontalExams, toothStatuses,
} from "@/db/schema";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

export async function getDriveSnapshot(ownerId: string, patientId: number) {
  const db = getDb();
  const [patient] = await db.select().from(patients)
    .where(and(eq(patients.ownerId, ownerId), eq(patients.id, patientId))).limit(1);
  if (!patient) return null;

  const filter = (ownerColumn: AnyColumn, patientColumn: AnyColumn) =>
    and(eq(ownerColumn, ownerId), eq(patientColumn, patientId));
  const [notes, plans, visits, exams, teeth, images, backups] = await Promise.all([
    db.select().from(evolutions).where(filter(evolutions.ownerId, evolutions.patientId)).orderBy(asc(evolutions.id)),
    db.select().from(budgets).where(filter(budgets.ownerId, budgets.patientId)).orderBy(asc(budgets.id)),
    db.select().from(appointments).where(filter(appointments.ownerId, appointments.patientId)).orderBy(asc(appointments.id)),
    db.select().from(periodontalExams).where(filter(periodontalExams.ownerId, periodontalExams.patientId)).orderBy(asc(periodontalExams.id)),
    db.select().from(toothStatuses).where(filter(toothStatuses.ownerId, toothStatuses.patientId)).limit(1),
    db.select().from(clinicalImages).where(filter(clinicalImages.ownerId, clinicalImages.patientId)).orderBy(asc(clinicalImages.id)),
    db.select().from(driveBackups).where(filter(driveBackups.ownerId, driveBackups.patientId)).limit(1),
  ]);

  // The backup document contains clinical data, not its own Drive pointers or
  // verification state. This keeps the digest stable after acknowledgement.
  const record = {
    format: "gestion-dental-clinical-backup-v1",
    patient: {
      id: patient.id, name: patient.name, birthDate: patient.birthDate,
      rut: patient.rut || "", phone: patient.phone, email: patient.email,
      reason: patient.reason, status: patient.status,
      allergies: patient.allergies, history: patient.history,
      createdAt: patient.createdAt,
    },
    evolutions: notes.map(n => ({
      id: n.id, clinicalDate: n.clinicalDate, recordedAt: n.recordedAt,
      title: n.title, body: n.body,
    })),
    budgets: plans.map(b => ({
      id: b.id, title: b.title, items: JSON.parse(b.items),
      status: b.status, createdAt: b.createdAt,
    })),
    appointments: visits.map(v => ({
      id: v.id, day: v.day, time: v.time, reason: v.reason,
      createdAt: v.createdAt,
    })),
    periodontalExams: exams.map(e => ({
      id: e.id, recordedAt: e.recordedAt, data: JSON.parse(e.teeth),
    })),
    odontogram: teeth[0] ? JSON.parse(teeth[0].data) : null,
    // Binary files remain in R2. Their metadata is included, but this document
    // alone is not an independent copy of radiographs, photos or PDFs.
    imageMetadata: images.map(i => ({
      id: i.id, name: i.name, kind: i.kind, note: i.note,
      size: i.size, contentType: i.contentType, addedAt: i.addedAt,
      attachmentBackedUp: false,
    })),
  };
  const documentText = "Respaldo de ficha clínica · Gestión Dental\n" + JSON.stringify(record, null, 2) + "\n";
  if (documentText.length > 250_000) throw new Error("La ficha excede el límite del respaldo automático; requiere revisión manual.");
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(documentText)));
  const backup = backups[0];
  return {
    patientId, name: patient.name, driveFolderId: patient.driveFolderId,
    documentTitle: `Respaldo automático Gestión Dental - ficha ${patientId}`,
    documentText, digest,
    previousDocumentId: backup?.documentId ?? null,
    verifiedAt: backup?.verifiedAt ?? null,
    pending: !backup || backup.snapshotDigest !== digest,
    attachmentCount: images.length,
  };
}

export async function listDriveBackupQueue(ownerId: string, afterPatientId: number, limit = 10) {
  const db = getDb();
  const page = await db.select({ id: patients.id }).from(patients)
    .where(and(eq(patients.ownerId, ownerId), gt(patients.id, afterPatientId)))
    .orderBy(asc(patients.id)).limit(limit + 1);
  const hasMore = page.length > limit;
  const selected = page.slice(0, limit);
  const snapshots = await Promise.all(selected.map(p => getDriveSnapshot(ownerId, p.id)));
  return {
    pending: snapshots.filter(s => s?.pending).map(s => ({
      patientId: s!.patientId, name: s!.name, driveFolderId: s!.driveFolderId,
      previousDocumentId: s!.previousDocumentId, documentTitle: s!.documentTitle,
      digest: s!.digest, attachmentCount: s!.attachmentCount,
    })),
    nextAfterPatientId: hasMore ? selected[selected.length - 1].id : null,
  };
}

export async function confirmDriveSnapshot(ownerId: string, patientId: number, documentId: string, digest: string, folderId: string | null) {
  const snapshot = await getDriveSnapshot(ownerId, patientId);
  if (!snapshot) return { saved: false, error: "Ficha no encontrada." };
  if (snapshot.digest !== digest) return { saved: false, stale: true, message: "La ficha cambió durante el respaldo. Vuelve a copiar la versión actual." };
  if (snapshot.previousDocumentId && snapshot.previousDocumentId !== documentId) {
    return { saved: false, error: "El documento no coincide con el respaldo anterior de esta ficha." };
  }
  if (snapshot.driveFolderId && folderId && snapshot.driveFolderId !== folderId) {
    return { saved: false, error: "La carpeta no coincide con la ficha." };
  }
  const db = getDb(), verifiedAt = new Date().toISOString();
  await db.insert(driveBackups).values({ patientId, ownerId, documentId, snapshotDigest: digest, verifiedAt })
    .onConflictDoUpdate({ target: driveBackups.patientId, set: { documentId, snapshotDigest: digest, verifiedAt } });
  if (folderId && !snapshot.driveFolderId) {
    await db.update(patients).set({ driveFolderId: folderId })
      .where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
  }
  await db.update(evolutions).set({ sourceDocumentId: documentId, backupStatus: "source_in_drive" })
    .where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId), eq(evolutions.backupStatus, "not_configured")));
  const verified = await getDriveSnapshot(ownerId, patientId);
  return { saved: !!verified && !verified.pending, patientId, documentId, digest, verifiedAt, attachmentCount: snapshot.attachmentCount };
}
