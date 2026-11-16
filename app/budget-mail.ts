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

/** Destino del correo: paciente de ese presupuesto y su correo registrado. Lanza un error claro si no se puede enviar. */
async function target(ownerId: string, budgetId: number) {
  const db = mailDb();
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureMailTables(db);
  const budget = await db.prepare("SELECT id, patient_id AS patientId, title, items, created_at AS createdAt FROM budgets WHERE owner_id = ? AND id = ?").bind(ownerId, budgetId).first<{ id: number; patientId: number; title: string; items: string; createdAt: string }>();
  if (!budget) throw new Error("No encontré ese presupuesto.");
  const patient = await db.prepare("SELECT id, name, email FROM patients WHERE owner_id = ? AND id = ?").bind(ownerId, budget.patientId).first<{ id: number; name: string; email: string }>();
  if (!patient) throw new Error("No encontré la ficha del paciente.");
  if (!isValidEmail(patient.email)) throw new Error(`La ficha de ${patient.name} no tiene un correo electrónico válido. Agrégalo en «Editar datos».`);
  const sender = await getSender(ownerId);
  if (!sender) throw new Error("Primero conecta el correo de envío (Agenda → correo a pacientes).");
  return { budget, patient, email: patient.email.trim(), sender };
}

/** A quién y desde dónde se enviaría, para que el profesional lo confirme antes de enviar. */
export async function previewBudgetMail(ownerId: string, budgetId: number) {
  const { patient, email, sender } = await target(ownerId, budgetId);
  return { patientName: patient.name, to: email, from: sender.google_email };
}

/** Genera el PDF del presupuesto y lo envía de inmediato al correo registrado del paciente. */
export async function sendBudgetPdf(ownerId: string, budgetId: number, mode: BudgetPdfMode) {
  const { budget, patient, email, sender } = await target(ownerId, budgetId);
  const data = decodeBudgetData(budget.items);
  const profile = await loadProfile(ownerId).catch(() => null);
  const professionalName = profile ? displayName(profile) : "";
  const clinicName = profile?.clinicName || "";
  const pdf = await buildBudgetPdf({ budget: { id: budget.id, title: budget.title, date: displayDate(budget.createdAt), isAlternative: data.isAlternative, items: data.items }, patientName: patient.name, professionalName, clinicName, mode });
  const mail = budgetEmail({ patientName: patient.name, clinicName, professionalName, title: budget.title, isAlternative: data.isAlternative });
  await sendMailWithSender(sender, buildRawMessage({
    from: sender.google_email, fromName: clinicName || undefined, to: email, replyTo: sender.google_email, ...mail,
    attachments: [{ filename: budgetPdfFileName({ id: budget.id, isAlternative: data.isAlternative }), contentType: "application/pdf", base64: toBase64(pdf) }],
  }));
  return { to: email, from: sender.google_email };
}
