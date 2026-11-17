import { loadProfile } from "@/app/clinician-profile-db";
import { loadClinic } from "@/app/clinic-profile-db";
import { loadBudgetFormat } from "@/app/budget-format-db";
import { DEFAULT_FORMAT, clinicForBudget, formatForPdf, type BudgetFormat } from "@/lib/budget-format";
import { budgetAuthorOf, type TeamDb } from "@/app/clinic-team-db";
import { getSender, mailDb, ensureMailTables } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { budgetEmail, buildRawMessage, isValidEmail } from "@/lib/appointment-mail";
import { buildBudgetPdf, budgetPdfFileName, type BudgetPdfMode } from "@/lib/budget-pdf";
import { decodeBudgetData } from "@/lib/budget-plans";
import { displayName } from "@/lib/clinician-profile";

const toBase64 = (bytes: Uint8Array) => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const displayDate = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Presupuesto y paciente del profesional (nunca de otro), con sus datos para armar el documento. */
async function load(ownerId: string, budgetId: number) {
  const db = mailDb();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureMailTables(db);
  const budget = await db.prepare("SELECT id, patient_id AS patientId, title, items, created_at AS createdAt FROM budgets WHERE owner_id = ? AND id = ?").bind(ownerId, budgetId).first<{ id: number; patientId: number; title: string; items: string; createdAt: string }>();
  if (!budget) throw new Error("No encontré ese presupuesto.");
  const patient = await db.prepare("SELECT id, name, rut, email FROM patients WHERE owner_id = ? AND id = ?").bind(ownerId, budget.patientId).first<{ id: number; name: string; rut: string | null; email: string }>();
  if (!patient) throw new Error("No encontré la ficha del paciente.");
  return { budget, patient };
}

/** PDF del presupuesto con los datos del profesional, la clínica y el paciente; hora de emisión en hora de Chile. */
/**
 * Arriba van nombre, especialidad y RUT de quien ARMÓ el presupuesto (en una clínica, el colega que lo estableció),
 * lo descargue o envíe quien sea. Los presupuestos sin autor registrado son del titular del espacio.
 */
export async function renderBudgetPdf(ownerId: string, budgetId: number, mode: BudgetPdfMode, draft?: { viewerId: string; format: BudgetFormat }) {
  const { budget, patient } = await load(ownerId, budgetId);
  // Solo una fila ausente significa «titular»; si la lectura falla, mejor avisar que firmar con el profesional equivocado.
  const authorDb = mailDb();
  const author = authorDb ? await budgetAuthorOf(authorDb as unknown as TeamDb, ownerId, budgetId).catch(() => { throw new Error("No pude confirmar qué profesional armó este presupuesto. Intenta de nuevo en un momento."); }) : null;
  const professionalId = author || ownerId;
  const data = decodeBudgetData(budget.items);
  const [profile, sender, space, format, clinic] = await Promise.all([
    loadProfile(professionalId).catch(() => null), getSender(ownerId).catch(() => null),
    professionalId === ownerId ? Promise.resolve(null) : loadProfile(ownerId).catch(() => null),
    // Formato de quien armó el presupuesto; logo de la clínica (el espacio), no de la consulta personal del colega.
    loadBudgetFormat(professionalId).catch(() => ({ ...DEFAULT_FORMAT })), loadClinic(ownerId).catch(() => null),
  ]);
  // El nombre de la clínica es el del espacio (cuyo correo envía), no el de la consulta personal del profesional.
  const clinicName = (professionalId === ownerId ? profile?.clinicName : space?.clinicName) || undefined;
  // Un diseño en borrador (vista previa antes de guardar) solo vale para quien armó el presupuesto: nadie ve el PDF «de otro» con su propio diseño.
  const { format: pdfFormat, editable } = formatForPdf(format, draft, professionalId);
  const bytes = await buildBudgetPdf({
    budget: { id: budget.id, title: budget.title, date: displayDate(budget.createdAt), isAlternative: data.isAlternative, items: data.items },
    patientName: patient.name, patientDocument: patient.rut?.trim() || undefined,
    professionalName: profile ? displayName(profile) : undefined, professionalSpecialty: profile?.specialty || undefined, professionalDocument: profile?.rut || undefined,
    clinicName, contactEmail: sender?.google_email, mode,
    format: clinicForBudget(pdfFormat, professionalId === ownerId, clinic), professionalTitles: profile?.extraTitles || undefined, logo: clinic?.logo || undefined,
  });
  return { bytes, editable, fileName: budgetPdfFileName({ id: budget.id, isAlternative: data.isAlternative }), isAlternative: data.isAlternative, title: budget.title, patient, profile, sender, clinicName: clinicName || "" };
}

/** Destino del correo: correo registrado del paciente y cuenta de envío. Lanza un error claro si no se puede enviar. */
async function mailTarget(ownerId: string, budgetId: number) {
  const { patient } = await load(ownerId, budgetId);
  if (!isValidEmail(patient.email)) throw new Error(`La ficha de ${patient.name} no tiene un correo electrónico válido. Agrégalo en «Editar datos».`);
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío (Agenda → correo a pacientes).");
  return { patient, email: patient.email.trim(), sender };
}

/** A quién y desde dónde se enviaría, para que el profesional lo confirme antes de enviar. */
export async function previewBudgetMail(ownerId: string, budgetId: number) {
  const { patient, email, sender } = await mailTarget(ownerId, budgetId);
  return { patientName: patient.name, to: email, from: sender.google_email };
}

/** Genera el PDF del presupuesto y lo envía de inmediato al correo registrado del paciente. */
export async function sendBudgetPdf(ownerId: string, budgetId: number, mode: BudgetPdfMode) {
  const { email, sender } = await mailTarget(ownerId, budgetId);
  const pdf = await renderBudgetPdf(ownerId, budgetId, mode);
  const clinicName = pdf.clinicName;
  const mail = budgetEmail({ patientName: pdf.patient.name, clinicName, professionalName: pdf.profile ? displayName(pdf.profile) : "", title: pdf.title, isAlternative: pdf.isAlternative });
  await sendMailWithSender(sender, buildRawMessage({
    from: sender.google_email, fromName: clinicName || undefined, to: email, replyTo: sender.google_email, ...mail,
    attachments: [{ filename: pdf.fileName, contentType: "application/pdf", base64: toBase64(pdf.bytes) }],
  }));
  return { to: email, from: sender.google_email };
}
