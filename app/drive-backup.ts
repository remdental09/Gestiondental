import { and, asc, eq, gt, type AnyColumn } from "drizzle-orm";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { ensureConsentSignatureTable } from "@/app/consent-signature-db";
import { fichaMarkdown } from "@/lib/backup-markdown";
import { backupImplant } from "@/lib/implants";
import { loadAnamnesis } from "@/app/anamnesis-db";
import { loadAddresses } from "@/app/patient-address-db";
import { getDb } from "@/db";
import {
  appointments, budgets, clinicalImages, consentSignatures, driveBackups, evolutions,
  biomedicalProducts, implants, patientDocuments, patients, periodontalExams, toothStatuses,
} from "@/db/schema";
import { decodeBudgetData } from "@/lib/budget-plans";
import { attachmentFileName } from "@/lib/attachment-name";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

export async function getDriveSnapshot(ownerId: string, patientId: number, connectedAt: string | null = null) {
  const db = getDb();
  const filter = (ownerColumn: AnyColumn, patientColumn: AnyColumn) =>
    and(eq(ownerColumn, ownerId), eq(patientColumn, patientId));
  // Tablas que se crean o amplían en caliente: se aseguran antes (una vez por proceso).
  const extrasReady = await Promise.all([
    ensureDocumentIssuanceColumns().then(() => true).catch(() => false),
    ensureConsentSignatureTable().then(() => true).catch(() => false),
  ]);
  const queries = {
    patient: () => db.select().from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.id, patientId))).limit(1),
    notes: () => db.select().from(evolutions).where(filter(evolutions.ownerId, evolutions.patientId)).orderBy(asc(evolutions.id)),
    plans: () => db.select().from(budgets).where(filter(budgets.ownerId, budgets.patientId)).orderBy(asc(budgets.id)),
    visits: () => db.select().from(appointments).where(filter(appointments.ownerId, appointments.patientId)).orderBy(asc(appointments.id)),
    exams: () => db.select().from(periodontalExams).where(filter(periodontalExams.ownerId, periodontalExams.patientId)).orderBy(asc(periodontalExams.id)),
    teeth: () => db.select().from(toothStatuses).where(filter(toothStatuses.ownerId, toothStatuses.patientId)).limit(1),
    attachments: () => db.select().from(clinicalImages).where(filter(clinicalImages.ownerId, clinicalImages.patientId)).orderBy(asc(clinicalImages.id)),
    documents: () => db.select().from(patientDocuments).where(filter(patientDocuments.ownerId, patientDocuments.patientId)).orderBy(asc(patientDocuments.id)),
    backups: () => db.select().from(driveBackups).where(filter(driveBackups.ownerId, driveBackups.patientId)).limit(1),
    signatures: () => db.select().from(consentSignatures).where(and(eq(consentSignatures.ownerId, ownerId), eq(consentSignatures.patientId, patientId), eq(consentSignatures.status, "firmado"))),
    products: () => db.select().from(biomedicalProducts).where(filter(biomedicalProducts.ownerId, biomedicalProducts.patientId)).orderBy(asc(biomedicalProducts.id)),
    implants: () => db.select().from(implants).where(filter(implants.ownerId, implants.patientId)).orderBy(asc(implants.id)),
  };
  type Rows = {
    patient: (typeof patients.$inferSelect)[]; notes: (typeof evolutions.$inferSelect)[]; plans: (typeof budgets.$inferSelect)[];
    visits: (typeof appointments.$inferSelect)[]; exams: (typeof periodontalExams.$inferSelect)[]; teeth: (typeof toothStatuses.$inferSelect)[];
    attachments: (typeof clinicalImages.$inferSelect)[]; documents: (typeof patientDocuments.$inferSelect)[]; backups: (typeof driveBackups.$inferSelect)[];
    signatures: (typeof consentSignatures.$inferSelect)[]; products: (typeof biomedicalProducts.$inferSelect)[];
    implantRows: (typeof implants.$inferSelect)[];
  };
  let rows: Rows | null = null;
  // Todo en un solo db.batch: cuenta como UNA consulta contra el tope de 1.000 por invocación del Worker
  // (antes eran 11 idas y vueltas por ficha y el respaldo automático se quedaba sin consultas).
  if (extrasReady.every(Boolean)) {
    try {
      const [patient, notes, plans, visits, exams, teeth, images, documents, backups, signatures, products, implantRows] = await db.batch([
        queries.patient(), queries.notes(), queries.plans(), queries.visits(), queries.exams(), queries.teeth(),
        queries.attachments(), queries.documents(), queries.backups(), queries.signatures(), queries.products(), queries.implants(),
      ]);
      rows = { patient, notes, plans, visits, exams, teeth, attachments: images, documents, backups, signatures, products, implantRows };
    } catch { rows = null; /* p. ej. una tabla opcional aún no existe: se lee por separado */ }
  }
  if (!rows) {
    const [patient, notes, plans, visits, exams, teeth, images, documents, backups, signatures, products, implantRows] = await Promise.all([
      queries.patient(), queries.notes(), queries.plans(), queries.visits(), queries.exams(), queries.teeth(), queries.attachments(),
      Promise.resolve().then(queries.documents).catch(() => [] as (typeof patientDocuments.$inferSelect)[]),
      queries.backups(),
      Promise.resolve().then(queries.signatures).catch(() => [] as (typeof consentSignatures.$inferSelect)[]),
      // Trazabilidad de productos biomédicos: si la tabla aún no existe o falla, el respaldo sigue sin ella.
      Promise.resolve().then(queries.products).catch(() => [] as (typeof biomedicalProducts.$inferSelect)[]),
      Promise.resolve().then(queries.implants).catch(() => [] as (typeof implants.$inferSelect)[]),
    ]);
    rows = { patient, notes, plans, visits, exams, teeth, attachments: images, documents, backups, signatures, products, implantRows };
  }
  const [patient] = rows.patient;
  if (!patient) return null;
  const { notes, plans, visits, exams, teeth, attachments: images, documents, backups, signatures, products, implantRows } = rows;

  const [address, anamnesis] = await Promise.all([
    loadAddresses(ownerId).then(map => map.get(patientId) ?? null).catch(() => null),
    loadAnamnesis(ownerId, patientId).then(found => found ? (({ updatedAt: _u, ...rest }) => rest)(found) : null).catch(() => null),
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
    address,
    anamnesis,
    // Solo si hay productos: el respaldo de fichas sin ellos conserva su huella.
    ...(products.length ? { biomedicalProducts: products.map(p => ({
      id: p.id, category: p.category, brand: p.brand, reference: p.reference, lot: p.lot, serial: p.serial, expiry: p.expiry,
      manufacturer: p.manufacturer, tooth: p.tooth, note: p.note, placedOn: p.placedOn, createdByName: p.createdByName, createdAt: p.createdAt,
    })) } : {}),
    ...(implantRows.length ? { implants: implantRows.map(row => backupImplant(row, new Set(images.map(i => i.id)))) } : {}),
    // Las anuladas se respaldan igual (Ley 20.584), marcadas con motivo, fecha y autor.
    evolutions: notes.map(n => ({
      id: n.id, clinicalDate: n.clinicalDate, recordedAt: n.recordedAt,
      title: n.status === "anulada" ? `[ANULADA] ${n.title}` : n.title, body: n.body,
      ...(n.status === "anulada" ? { status: "anulada", annulledAt: n.annulledAt, annulledBy: n.annulledBy, annulReason: n.annulReason } : {}),
      ...(n.replacesId ? { replacesId: n.replacesId } : {}),
    })),
    budgets: plans.map(b => {
      const data = decodeBudgetData(b.items);
      return {
        id: b.id, title: b.title, items: data.items,
        ...(data.isAlternative ? { isAlternative: true, parentBudgetId: data.parentBudgetId } : {}),
        status: b.status, createdAt: b.createdAt,
      };
    }),
    documents: documents.map(document => ({
      id: document.id, kind: document.kind, title: document.title, content: document.content,
      status: document.status, createdByName: document.createdByName, createdAt: document.createdAt,
      // Solo los consentimientos firmados llevan este dato: el respaldo de fichas sin firmas no cambia.
      ...(signatures.find(signature => signature.documentId === document.id) ? { signature: (({ signerName, signerRole, signerRelation, signedAt, method, signatureHash }) => ({ signerName, signerRole, signerRelation, signedAt, method, signatureHash }))(signatures.find(signature => signature.documentId === document.id)!) } : {}),
    })),
    appointments: visits.map(v => ({
      id: v.id, day: v.day, time: v.time, reason: v.reason,
      createdAt: v.createdAt,
    })),
    periodontalExams: exams.map(e => ({
      id: e.id, recordedAt: e.recordedAt, data: JSON.parse(e.teeth),
    })),
    odontogram: teeth[0] ? JSON.parse(teeth[0].data) : null,
    // Los binarios se copian a Drive como archivos «Adjunto N - nombre» en la carpeta del paciente;
    // la ficha solo se confirma tras verificar cada archivo en Drive (ver backupAttachments).
    imageMetadata: images.map(i => ({
      id: i.id, name: i.name, kind: i.kind, note: i.note,
      size: i.size, contentType: i.contentType, addedAt: i.addedAt,
      driveFile: attachmentFileName(i.id, i.name, i.contentType),
    })),
  };
  // Markdown legible primero; al final, los datos completos en JSON para poder restaurar la ficha.
  const markdown = fichaMarkdown(record);
  const documentText = markdown + "\n---\n\n## Datos estructurados (JSON, para restaurar)\n\n```json\n" + JSON.stringify(record, null, 2) + "\n```\n";
  if (documentText.length > 250_000) throw new Error("La ficha excede el límite del respaldo automático; requiere revisión manual.");
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(documentText)));
  const backup = backups[0];
  return {
    patientId, name: patient.name, driveFolderId: patient.driveFolderId,
    documentTitle: `Respaldo automático Gestión Dental - ficha ${patientId}`,
    documentText, markdown, digest,
    previousDocumentId: backup?.documentId ?? null,
    verifiedAt: backup?.verifiedAt ?? null,
    // Un respaldo anterior a la conexión actual de Drive está en otro Drive (o en el sistema anterior): se vuelve a copiar.
    pending: !backup || backup.snapshotDigest !== digest || Boolean(connectedAt && backup.verifiedAt < connectedAt),
    attachmentCount: images.length,
  };
}

export async function listDriveBackupQueue(ownerId: string, afterPatientId: number, limit = 10, connectedAt: string | null = null) {
  const db = getDb();
  const page = await db.select({ id: patients.id }).from(patients)
    .where(and(eq(patients.ownerId, ownerId), gt(patients.id, afterPatientId)))
    .orderBy(asc(patients.id)).limit(limit + 1);
  const hasMore = page.length > limit;
  const selected = page.slice(0, limit);
  const snapshots = await Promise.all(selected.map(p => getDriveSnapshot(ownerId, p.id, connectedAt)));
  return {
    pending: snapshots.filter(s => s?.pending).map(s => ({
      patientId: s!.patientId, name: s!.name, driveFolderId: s!.driveFolderId,
      previousDocumentId: s!.previousDocumentId, documentTitle: s!.documentTitle,
      digest: s!.digest, attachmentCount: s!.attachmentCount,
    })),
    nextAfterPatientId: hasMore ? selected[selected.length - 1].id : null,
    scanned: selected.length,
  };
}

export async function confirmDriveSnapshot(ownerId: string, patientId: number, documentId: string, digest: string, folderId: string | null, allowReplacement = false, connectedAt: string | null = null) {
  const snapshot = await getDriveSnapshot(ownerId, patientId, connectedAt);
  if (!snapshot) return { saved: false, error: "Ficha no encontrada." };
  if (snapshot.digest !== digest) return { saved: false, stale: true, message: "La ficha cambió durante el respaldo. Vuelve a copiar la versión actual." };
  if (snapshot.previousDocumentId && snapshot.previousDocumentId !== documentId && !allowReplacement) {
    return { saved: false, error: "El documento no coincide con el respaldo anterior de esta ficha." };
  }
  if (snapshot.driveFolderId && folderId && snapshot.driveFolderId !== folderId && !allowReplacement) {
    return { saved: false, error: "La carpeta no coincide con la ficha." };
  }
  const db = getDb(), verifiedAt = new Date().toISOString();
  await db.insert(driveBackups).values({ patientId, ownerId, documentId, snapshotDigest: digest, verifiedAt })
    .onConflictDoUpdate({ target: driveBackups.patientId, set: { documentId, snapshotDigest: digest, verifiedAt } });
  if (folderId && (!snapshot.driveFolderId || (allowReplacement && snapshot.driveFolderId !== folderId))) {
    await db.update(patients).set({ driveFolderId: folderId })
      .where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
  }
  await db.update(evolutions).set({ sourceDocumentId: documentId, backupStatus: "source_in_drive" })
    .where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId), eq(evolutions.backupStatus, "not_configured")));
  const verified = await getDriveSnapshot(ownerId, patientId);
  return { saved: !!verified && !verified.pending, patientId, documentId, digest, verifiedAt, attachmentCount: snapshot.attachmentCount };
}
