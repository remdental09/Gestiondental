import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const patients = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  birthDate: text("birth_date").notNull().default(""),
  rut: text("rut"),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  reason: text("reason").notNull().default("Evaluación"),
  status: text("status").notNull().default("Evaluación"),
  allergies: text("allergies").notNull().default("Sin registrar"),
  history: text("history").notNull().default("Sin registrar"),
  driveFolderId: text("drive_folder_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("patients_owner_rut_unique").on(table.ownerId, table.rut), index("patients_owner_name_idx").on(table.ownerId, table.name)]);

export const evolutions = sqliteTable("evolutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  clinicalDate: text("clinical_date").notNull(),
  recordedAt: text("recorded_at").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sourceDocumentId: text("source_document_id"),
  backupStatus: text("backup_status").notNull().default("not_configured"),
  requestId: text("request_id"),
  /**
   * «vigente» o «anulada». Por la Ley 20.584 la ficha clínica se conserva: una evolución no se borra,
   * se anula con motivo, fecha y autor, y queda visible tachada al pedir «Ver anuladas».
   */
  status: text("status").notNull().default("vigente"),
  annulledAt: text("annulled_at"),
  annulledBy: text("annulled_by"),
  annulReason: text("annul_reason"),
  /** Si esta evolución reemplaza a otra (anular + nueva), el id de la anulada. */
  replacesId: integer("replaces_id"),
}, table => [index("evolutions_patient_date_idx").on(table.patientId, table.clinicalDate), uniqueIndex("evolutions_owner_request_unique").on(table.ownerId, table.requestId)]);

/**
 * Etiquetas de diagnóstico de una evolución, confirmadas por el profesional. `code` es CIE-11 del catálogo
 * verificado (lib/icd11-catalog.ts) o "" para conceptos sin código; la pieza (FDI, p. ej. 24) y los hallazgos
 * van aparte del código. `suggestedFrom`: «AAE», «caries-pulpar» o «aproximado» si fue una equivalencia sugerida y confirmada.
 */
export const evolutionDiagnoses = sqliteTable("evolution_diagnoses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  evolutionId: integer("evolution_id").notNull().references(() => evolutions.id),
  code: text("code").notNull().default(""),
  title: text("title").notNull(),
  tooth: integer("tooth"),
  findings: text("findings").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  origin: text("origin").notNull().default("manual"),
  suggestedFrom: text("suggested_from"),
  createdAt: text("created_at").notNull(),
}, table => [
  index("evolution_diagnoses_evolution_idx").on(table.evolutionId),
  index("evolution_diagnoses_patient_code_idx").on(table.patientId, table.code),
]);

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  title: text("title").notNull(),
  items: text("items").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("budgets_patient_idx").on(table.patientId)]);

/** Recetas, certificados y consentimientos guardados por paciente como borradores imprimibles. */
export const patientDocuments = sqliteTable("patient_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("borrador"),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  /** Emisión: al emitir el documento queda bloqueado, con código secreto para el QR y huella de su contenido. */
  verifyToken: text("verify_token"),
  contentHash: text("content_hash").notNull().default(""),
  issuedAt: text("issued_at").notNull().default(""),
  revokedAt: text("revoked_at").notNull().default(""),
  revokedReason: text("revoked_reason").notNull().default(""),
  replacesId: integer("replaces_id"),
}, table => [
  index("patient_documents_owner_patient_idx").on(table.ownerId, table.patientId, table.id),
  uniqueIndex("patient_documents_verify_token_idx").on(table.verifyToken),
]);

/** Firma electrónica simple del paciente en un consentimiento emitido. Una fila pendiente es un enlace de firma (solo se guarda la huella del código); al firmar pasa a «firmado». Máximo una firma por documento. */
export const consentSignatures = sqliteTable("consent_signatures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => patientDocuments.id),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  status: text("status").notNull(),
  tokenHash: text("token_hash"),
  tokenExpiresAt: text("token_expires_at").notNull().default(""),
  signerName: text("signer_name").notNull().default(""),
  signerRole: text("signer_role").notNull().default(""),
  signerRelation: text("signer_relation").notNull().default(""),
  image: text("image").notNull().default(""),
  signedAt: text("signed_at").notNull().default(""),
  method: text("method").notNull().default(""),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  signatureHash: text("signature_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, table => [
  index("consent_signatures_document_idx").on(table.documentId),
  index("consent_signatures_owner_patient_idx").on(table.ownerId, table.patientId),
  uniqueIndex("consent_signatures_token_idx").on(table.tokenHash),
  uniqueIndex("consent_signatures_one_signed_idx").on(table.documentId).where(sql`${table.status} = 'firmado'`),
]);

/** Firma/timbre gráfico personal; cada documento y presupuesto usa la imagen de su autor. */
export const professionalDocumentSettings = sqliteTable("professional_document_settings", {
  professionalId: text("professional_id").primaryKey(),
  documentMark: text("document_mark").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  day: text("day").notNull(),
  time: text("time").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("appointments_patient_day_idx").on(table.patientId, table.day)]);

/** Pagos y abonos recibidos. amount en pesos chilenos enteros; paid_on en YYYY-MM-DD (America/Santiago). */
export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  budgetId: integer("budget_id").references(() => budgets.id),
  amount: integer("amount").notNull(),
  method: text("method").notNull(),
  concept: text("concept").notNull().default(""),
  paidOn: text("paid_on").notNull(),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
}, table => [
  index("payments_patient_idx").on(table.patientId, table.paidOn),
  uniqueIndex("payments_owner_request_unique").on(table.ownerId, table.requestId),
]);

export const periodontalExams = sqliteTable("periodontal_exams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  recordedAt: text("recorded_at").notNull(),
  teeth: text("teeth").notNull(),
}, table => [index("periodontal_patient_idx").on(table.patientId)]);

export const toothStatuses = sqliteTable("tooth_statuses", {
  patientId: integer("patient_id").primaryKey().references(() => patients.id),
  ownerId: text("owner_id").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const clinicalImages = sqliteTable("clinical_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  objectKey: text("object_key").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  note: text("note").notNull().default(""),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  addedAt: text("added_at").notNull(),
}, table => [index("images_patient_idx").on(table.patientId)]);

export const driveBackups = sqliteTable("drive_backups", {
  patientId: integer("patient_id").primaryKey().references(() => patients.id),
  ownerId: text("owner_id").notNull(),
  documentId: text("document_id").notNull(),
  snapshotDigest: text("snapshot_digest").notNull(),
  verifiedAt: text("verified_at").notNull(),
}, table => [index("drive_backups_owner_idx").on(table.ownerId)]);

export const calendarEvents = sqliteTable("calendar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  calendarId: text("calendar_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  title: text("title").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  sourceTimeZone: text("source_time_zone").notNull().default("America/Santiago"),
  htmlLink: text("html_link"),
  status: text("status").notNull().default("confirmed"),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  patientId: integer("patient_id").references(() => patients.id),
  importedAt: text("imported_at").notNull(),
  sourceUpdatedAt: text("source_updated_at"),
}, table => [
  uniqueIndex("calendar_events_owner_source_unique").on(table.ownerId, table.calendarId, table.googleEventId),
  index("calendar_events_owner_start_idx").on(table.ownerId, table.startAt),
]);

/** Aggregates diarios técnicos del dictado guiado; no contiene audio ni texto clínico. */
export const dictationHealthDaily = sqliteTable("dictation_health_daily", {
  ownerId: text("owner_id").notNull(),
  day: text("day").notNull(),
  stage: text("stage").notNull(),
  event: text("event").notNull(),
  platform: text("platform").notNull(),
  errorCode: text("error_code").notNull().default("none"),
  durationBucket: text("duration_bucket").notNull().default("none"),
  count: integer("count").notNull().default(0),
}, table => [
  primaryKey({ name: "dictation_health_daily_pk", columns: [table.ownerId, table.day, table.stage, table.event, table.platform, table.errorCode, table.durationBucket] }),
  index("dictation_health_daily_day_idx").on(table.day),
]);
