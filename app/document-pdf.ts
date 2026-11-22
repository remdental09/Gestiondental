import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { patientDocuments, patients } from "@/db/schema";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { ensureConsentSignatureTable } from "@/app/consent-signature-db";
import { consentSignatures } from "@/db/schema";
import { loadApprovedRegistrations } from "@/app/prestador-db";
import { loadProfileTitles } from "@/app/clinician-profile-db";
import { loadClinic } from "@/app/clinic-profile-db";
import { loadDocumentMark } from "@/app/document-mark-db";
import { getSender, mailDb, ensureMailTables } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { buildRawMessage, isValidEmail, documentEmail, signRequestEmail, signedCopyEmail } from "@/lib/appointment-mail";
import { ageFromBirthDate, cleanClinicalDocumentContent, parseMedications, medicationLine, splitPrescriptionLines, requiresHabilitacionQr, habilitacionNoun, isPrescriptionKind, type ClinicalDocumentKind } from "@/lib/clinical-documents";
import { buildDocumentPdf, type DocumentPdfInput } from "@/lib/document-pdf";
import { shortCode, verificationUrl } from "@/lib/document-verification";
import { formatChileanRut, isValidChileanRut } from "@/lib/patient-document";
import { asProfessionalTitle } from "@/lib/clinician-profile";
import { registrationLine } from "@/lib/prestador-certificate";
import { SIGNER_ROLE_LABEL, SIGN_METHOD_LABEL, SIGN_LINK_HOURS, isSignMethod, isSignerRole } from "@/lib/consent-signature";

const toBase64 = (bytes: Uint8Array) => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const dateLong = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(d); };
const CONSENT_FIELDS: [string, string][] = [["procedimiento", "PROCEDIMIENTO PROPUESTO"], ["descripcion", "DESCRIPCIÓN Y ALCANCE"], ["riesgos", "RIESGOS Y POSIBLES COMPLICACIONES"], ["alternativas", "ALTERNATIVAS Y CONSECUENCIAS DE NO TRATAR"], ["declaracion", "DECLARACIONES O ACUERDOS ESPECÍFICOS"]];

const FILE_PREFIX: Record<string, string> = { receta: "receta", receta_magistral: "receta-magistral", orden: "orden", certificado: "certificado", consentimiento: "consentimiento" };
const OTHER_FIELDS: Record<"orden" | "certificado", [string, string][]> = {
  orden: [["diagnostico", "DIAGNÓSTICO O JUSTIFICACIÓN CLÍNICA"], ["examenes", "EXÁMENES O PROCEDIMIENTOS SOLICITADOS"], ["observaciones", "OBSERVACIONES"]],
  certificado: [["motivo", "MOTIVO DEL CERTIFICADO"], ["observaciones", "OBSERVACIONES"], ["vigencia", "FECHA O VIGENCIA"]],
};

export const documentPdfFileName = (kind: string, id: number) => `${FILE_PREFIX[kind] ?? "documento"}-${String(id).padStart(5, "0")}.pdf`;

/** PDF de un documento emitido del profesional (nunca de otro). Exige el QR de habilitación en recetas y consentimientos. */
export async function renderDocumentPdf(ownerId: string, documentId: number, origin: string) {
  await ensureDocumentIssuanceColumns();
  const db = getDb();
  const [doc] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, documentId), eq(patientDocuments.ownerId, ownerId))).limit(1);
  if (!doc) throw new Error("No encontré ese documento.");
  if (doc.status !== "emitido" || !doc.verifyToken || !doc.contentHash) throw new Error("Solo se puede enviar un documento emitido (con QR de verificación).");
  if (!(doc.kind in FILE_PREFIX)) throw new Error("Este tipo de documento no se envía en PDF.");
  const [patient] = await db.select().from(patients).where(and(eq(patients.id, doc.patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) throw new Error("No encontré la ficha del paciente.");
  const [regs, titles, clinic, mark] = await Promise.all([loadApprovedRegistrations([doc.createdBy]).catch(() => new Map()), loadProfileTitles([doc.createdBy]).catch(() => new Map()), loadClinic(ownerId).catch(() => null), loadDocumentMark(doc.createdBy).catch(() => "")]);
  const reg = regs.get(doc.createdBy) ?? null;
  if (requiresHabilitacionQr(doc.kind) && !reg?.qrUrl) throw new Error(`${habilitacionNoun(doc.kind).esta} no se puede enviar sin el QR de habilitación de la Superintendencia de Salud.`);
  const kind = doc.kind as ClinicalDocumentKind;
  let raw: unknown = {}; try { raw = JSON.parse(doc.content); } catch { /* contenido ilegible: se envía vacío */ }
  const content = cleanClinicalDocumentContent(kind, raw);
  const title = asProfessionalTitle(titles.get(doc.createdBy) ?? /^(Dr\(a\)\.|Dra\.|Dr\.)/.exec(doc.createdByName)?.[1]);
  const doctorName = reg?.fullName ? `${title} ${reg.fullName}`.trim() : doc.createdByName || "Profesional";
  const doctorLines = reg ? [reg.run ? `RUT ${formatChileanRut(reg.run)}` : "", `${reg.profession} (${registrationLine(reg)})`, reg.specialties.join(" · ")].filter(Boolean) : [];
  const age = ageFromBirthDate(patient.birthDate);
  const sections: DocumentPdfInput["sections"] = [];
  const text = (key: string) => (content[key] ?? "").trim();
  if (isPrescriptionKind(kind)) {
    const items = [
      ...(kind === "receta" ? parseMedications(content.medicamentos) : []).map(m => ({ name: m.nombre, lines: [medicationLine(m), m.indicaciones ?? "", m.cantidad ? `Cantidad a dispensar: ${m.cantidad}` : ""].filter(Boolean) })),
      ...(kind === "receta" ? splitPrescriptionLines(text("prescripcion")).map(l => ({ name: l.name, lines: l.detail ? [l.detail] : [] })) : []),
    ];
    if (kind === "receta_magistral") sections.push({ heading: "FÓRMULA MAGISTRAL", lines: [text("prescripcion") || "—"] });
    else sections.push({ heading: "Rp.", lines: [] }, ...items.flatMap((item, index) => [{ lines: [`${index + 1}. ${item.name}`], strong: true }, { lines: item.lines }]));
    if (text("instrucciones")) sections.push({ heading: "INDICACIONES AL PACIENTE", lines: [text("instrucciones")] });
  } else for (const [key, label] of kind === "consentimiento" ? CONSENT_FIELDS : OTHER_FIELDS[kind as "orden" | "certificado"]) { if (kind === "consentimiento" || text(key)) sections.push({ heading: label, lines: [text(key) || "—"] }); }
  let signature: DocumentPdfInput["patientSignature"];
  if (kind === "consentimiento") {
    await ensureConsentSignatureTable();
    const [row] = await db.select().from(consentSignatures).where(and(eq(consentSignatures.documentId, doc.id), eq(consentSignatures.ownerId, ownerId), eq(consentSignatures.status, "firmado"))).limit(1);
    if (row) {
      const role = isSignerRole(row.signerRole) ? SIGNER_ROLE_LABEL[row.signerRole] : "";
      signature = { image: row.image, name: row.signerName, lines: [`${row.signerRole === "representante" && row.signerRelation ? `${row.signerRelation}, ` : ""}${role}`.replace(/^, /, ""), `Firmado electrónicamente el ${dateLong(row.signedAt)} (${isSignMethod(row.method) ? SIGN_METHOD_LABEL[row.method] : "en pantalla"}). Firma electrónica simple.`] };
    }
  }
  const input: DocumentPdfInput = {
    title: doc.title, number: String(doc.id).padStart(5, "0"), clinicName: clinic?.clinicName || "Consulta odontológica",
    clinicLines: [[clinic?.address, clinic?.city].filter(Boolean).join(", "), [clinic?.phone, clinic?.email].filter(Boolean).join(" · ")].filter(Boolean), logo: clinic?.logo || undefined,
    doctorName, doctorLines, habilitacion: reg?.qrUrl ? { url: reg.qrUrl, regSis: reg.regSis, code: reg.validationCode || undefined } : undefined,
    patientLines: [`Paciente: ${patient.name}`, `Nro. de documento: ${patient.rut ? (isValidChileanRut(patient.rut) ? formatChileanRut(patient.rut) : patient.rut) : "Sin registrar"}`, `Edad: ${age === null ? "Sin registrar" : `${age} años`}`],
    issuedDate: dateLong(doc.issuedAt || doc.createdAt), sections,
    note: kind === "consentimiento" ? "Borrador para revisión clínica. Este texto no sustituye la conversación con el paciente ni la verificación del contenido aplicable al procedimiento y sus circunstancias." : undefined,
    verification: { url: verificationUrl(origin, doc.verifyToken), code: shortCode(doc.contentHash), text: "Escanee para confirmar que fue emitido desde Gestión Dental y está vigente." },
    doctorMark: mark || undefined, patientLabel: kind === "consentimiento" ? "Firma del paciente" : undefined, patientSignature: signature,
  };
  return { bytes: await buildDocumentPdf(input), fileName: documentPdfFileName(kind, doc.id), patient, doctorName, clinicName: clinic?.clinicName || "", kind };
}

async function mailTarget(ownerId: string, patientEmail: string, patientName: string) {
  if (!isValidEmail(patientEmail)) throw new Error(`La ficha de ${patientName} no tiene un correo electrónico válido. Agrégalo en «Editar datos».`);
  const db = mailDb(); if (db) await ensureMailTables(db);
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío (Agenda → correo a pacientes).");
  return { to: patientEmail.trim(), sender };
}

/** A quién y desde dónde se enviaría (para confirmar antes). */
export async function previewDocumentMail(ownerId: string, documentId: number) {
  const [doc] = await getDb().select({ patientId: patientDocuments.patientId }).from(patientDocuments).where(and(eq(patientDocuments.id, documentId), eq(patientDocuments.ownerId, ownerId))).limit(1);
  if (!doc) throw new Error("No encontré ese documento.");
  const [patient] = await getDb().select().from(patients).where(and(eq(patients.id, doc.patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) throw new Error("No encontré la ficha del paciente.");
  const { to, sender } = await mailTarget(ownerId, patient.email, patient.name);
  return { patientName: patient.name, to, from: sender.google_email };
}

/** Genera el PDF y lo envía de inmediato al correo registrado del paciente. */
export async function sendDocumentPdf(ownerId: string, documentId: number, origin: string) {
  const pdf = await renderDocumentPdf(ownerId, documentId, origin);
  const { to, sender } = await mailTarget(ownerId, pdf.patient.email, pdf.patient.name);
  const mail = documentEmail({ patientName: pdf.patient.name, clinicName: pdf.clinicName, doctorName: pdf.doctorName, kind: pdf.kind });
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: pdf.clinicName || undefined, to, replyTo: sender.google_email, ...mail,
    attachments: [{ filename: pdf.fileName, contentType: "application/pdf", base64: toBase64(pdf.bytes) }] }));
  return { to, from: sender.google_email };
}

/** Antes de crear un enlace de firma: confirma que hay correo del paciente y correo de envío conectado (así no queda un enlace sin enviar). */
export async function signMailTarget(ownerId: string, patientEmail: string, patientName: string) {
  return mailTarget(ownerId, patientEmail, patientName);
}

/** Envía al paciente el enlace de firma con el botón «Revisar y firmar». */
export async function sendSignRequestMail(ownerId: string, input: { patientEmail: string; patientName: string; doctorName: string; url: string }) {
  const { to, sender } = await mailTarget(ownerId, input.patientEmail, input.patientName);
  const clinic = await loadClinic(ownerId).catch(() => null);
  const mail = signRequestEmail({ patientName: input.patientName, clinicName: clinic?.clinicName || "", doctorName: input.doctorName, url: input.url, hours: SIGN_LINK_HOURS });
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: clinic?.clinicName || undefined, to, replyTo: sender.google_email, ...mail }));
  return { to, from: sender.google_email };
}

/** Apenas el paciente firma: le llega al correo de su ficha el PDF del consentimiento ya firmado. */
export async function sendSignedCopy(ownerId: string, documentId: number, origin: string, code: string) {
  const pdf = await renderDocumentPdf(ownerId, documentId, origin);
  const { to, sender } = await mailTarget(ownerId, pdf.patient.email, pdf.patient.name);
  const mail = signedCopyEmail({ patientName: pdf.patient.name, clinicName: pdf.clinicName, doctorName: pdf.doctorName, code });
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: pdf.clinicName || undefined, to, replyTo: sender.google_email, ...mail,
    attachments: [{ filename: pdf.fileName, contentType: "application/pdf", base64: toBase64(pdf.bytes) }] }));
  return { to };
}
