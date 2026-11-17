import { loadProfile } from "@/app/clinician-profile-db";
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
/** `professionalId`: quien emite el presupuesto (su nombre, RUT y especialidad van arriba); por omisión, el titular del espacio. */
export async function renderBudgetPdf(ownerId: string, budgetId: number, mode: BudgetPdfMode, professionalId: string = ownerId) {
  const { budget, patient } = await load(ownerId, budgetId);
  const data = decodeBudgetData(budget.items);
  const [profile, sender] = await Promise.all([loadProfile(professionalId).catch(() => null), getSender(ownerId).catch(() => null)]);
  const bytes = await buildBudgetPdf({
    budget: { id: budget.id, title: budget.title, date: displayDate(budget.createdAt), isAlternative: data.isAlternative, items: data.items },
    patientName: patient.name, patientDocument: patient.rut?.trim() || undefined,
    professionalName: profile ? displayName(profile) : undefined, professionalSpecialty: profile?.specialty || undefined, professionalDocument: profile?.rut || undefined,
    clinicName: profile?.clinicName || undefined, contactEmail: sender?.google_email, mode,
  });
  return { bytes, fileName: budgetPdfFileName({ id: budget.id, isAlternative: data.isAlternative }), isAlternative: data.isAlternative, title: budget.title, patient, profile, sender };
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
export async function sendBudgetPdf(ownerId: string, budgetId: number, mode: BudgetPdfMode, professionalId: string = ownerId) {
  const { email, sender } = await mailTarget(ownerId, budgetId);
  const pdf = await renderBudgetPdf(ownerId, budgetId, mode, professionalId);
  const clinicName = pdf.profile?.clinicName || "";
  const mail = budgetEmail({ patientName: pdf.patient.name, clinicName, professionalName: pdf.profile ? displayName(pdf.profile) : "", title: pdf.title, isAlternative: pdf.isAlternative });
  await sendMailWithSender(sender, buildRawMessage({
    from: sender.google_email, fromName: clinicName || undefined, to: email, replyTo: sender.google_email, ...mail,
    attachments: [{ filename: pdf.fileName, contentType: "application/pdf", base64: toBase64(pdf.bytes) }],
  }));
  return { to: email, from: sender.google_email };
}
