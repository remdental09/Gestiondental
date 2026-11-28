import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex, index, real } from "drizzle-orm/sqlite-core";

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

/** Enlaces de admisión compartidos con pacientes: solo se almacena la huella del token. */
export const patientIntakeLinks = sqliteTable("patient_intake_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  usedAt: text("used_at"),
  patientId: integer("patient_id").references(() => patients.id, { onDelete: "set null" }),
  submittedName: text("submitted_name"),
  submittedBirthDate: text("submitted_birth_date"),
  submittedRut: text("submitted_rut"),
  submittedPhone: text("submitted_phone"),
  submittedEmail: text("submitted_email"),
}, table => [
  uniqueIndex("patient_intake_links_token_idx").on(table.tokenHash),
  index("patient_intake_links_owner_created_idx").on(table.ownerId, table.createdAt),
  index("patient_intake_links_patient_idx").on(table.patientId),
]);

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
  /**
   * Si esta evolución la compiló un implante (una etapa de implantología), su ficha y su fase: así se ve,
   * dentro del propio módulo, como la evolución de esa etapa (no es una nota aparte, es la misma tabla).
   * `onDelete: "set null"`: si se borra el implante, la evolución se conserva (es historia clínica real), solo
   * deja de estar vinculada a una ficha que ya no existe; si no, borrar el implante quedaría bloqueado.
   */
  implantId: integer("implant_id").references(() => implants.id, { onDelete: "set null" }),
  stagePhase: text("stage_phase"),
}, table => [index("evolutions_patient_date_idx").on(table.patientId, table.clinicalDate), index("evolutions_owner_date_idx").on(table.ownerId, table.clinicalDate, table.recordedAt), uniqueIndex("evolutions_owner_request_unique").on(table.ownerId, table.requestId), index("evolutions_implant_phase_idx").on(table.implantId, table.stagePhase)]);

/**
 * Etiquetas de diagnóstico de una evolución, confirmadas por el profesional. `code` es CIE-11 del catálogo
 * verificado (lib/icd11-catalog.ts) o "" para conceptos sin código; la pieza (FDI, p. ej. 24) y los hallazgos
 * van aparte del código. `suggestedFrom`: «AAE», «caries-pulpar», «aproximado» o «nota» (propuesto por la app según lo descrito) si no fue dictado tal cual.
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
  index("evolution_diagnoses_owner_id_idx").on(table.ownerId, table.id),
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
}, table => [index("budgets_patient_idx").on(table.patientId), index("budgets_owner_id_idx").on(table.ownerId, table.id)]);

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
  /** Timbre del profesional (imagen), se imprime bajo su firma; mismo formato y protección que la firma. */
  stampMark: text("stamp_mark").notNull().default(""),
  /** Posición y tamaño del timbre (JSON {dx, dy, scale} medido desde su lugar de siempre); vacío = sin diseño propio. */
  stampLayout: text("stamp_layout").notNull().default(""),
  /** Timbre sin fondo (PNG con transparencia), generado en el navegador a partir de `stampMark`; vacío = no hay. Se borra si cambia la imagen. */
  stampClean: text("stamp_clean").notNull().default(""),
  /** Firma y timbre unidos en una sola imagen (PNG con transparencia, generada en el navegador); vacío = no hay. Se borra si cambia la firma o el timbre. */
  mergedMark: text("merged_mark").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/** Bloqueo de la firma del profesional: huella del código enviado al correo, intentos y hasta cuándo vale el permiso de cambio. */
export const signatureUnlock = sqliteTable("signature_unlock", {
  professionalId: text("professional_id").primaryKey(),
  codeHash: text("code_hash").notNull().default(""),
  expiresAt: text("expires_at").notNull().default(""),
  attempts: integer("attempts").notNull().default(0),
  unlockedUntil: text("unlocked_until").notNull().default(""),
  lastSentAt: text("last_sent_at").notNull().default(""),
});

/** Firmas anteriores del profesional (cambiadas o quitadas), para auditoría. */
export const signatureHistory = sqliteTable("signature_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  professionalId: text("professional_id").notNull(),
  image: text("image").notNull(),
  action: text("action").notNull(),
  replacedAt: text("replaced_at").notNull(),
}, table => [index("signature_history_professional_idx").on(table.professionalId)]);

export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  day: text("day").notNull(),
  time: text("time").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("appointments_patient_day_idx").on(table.patientId, table.day), index("appointments_owner_day_idx").on(table.ownerId, table.day)]);

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
  index("payments_owner_paid_idx").on(table.ownerId, table.paidOn, table.id),
  uniqueIndex("payments_owner_request_unique").on(table.ownerId, table.requestId),
]);

export const periodontalExams = sqliteTable("periodontal_exams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  recordedAt: text("recorded_at").notNull(),
  teeth: text("teeth").notNull(),
}, table => [index("periodontal_patient_idx").on(table.patientId), index("periodontal_owner_id_idx").on(table.ownerId, table.id)]);

export const toothStatuses = sqliteTable("tooth_statuses", {
  patientId: integer("patient_id").primaryKey().references(() => patients.id),
  ownerId: text("owner_id").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("tooth_statuses_owner_patient_idx").on(table.ownerId, table.patientId)]);

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
}, table => [index("images_patient_idx").on(table.patientId), index("images_owner_id_idx").on(table.ownerId, table.id)]);

/** Trazabilidad de productos biomédicos (implantes, injertos, membranas…): foto de la etiqueta + datos confirmados por el profesional. */
export const biomedicalProducts = sqliteTable("biomedical_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  /** Foto de la etiqueta (clinical_images, tipo «Producto biomédico»). */
  imageId: integer("image_id"),
  category: text("category").notNull(),
  brand: text("brand").notNull().default(""),
  reference: text("reference").notNull().default(""),
  lot: text("lot").notNull().default(""),
  serial: text("serial").notNull().default(""),
  expiry: text("expiry").notNull().default(""),
  manufacturer: text("manufacturer").notNull().default(""),
  /** Pieza FDI con punto («1.6») o vacío. */
  tooth: text("tooth").notNull().default(""),
  note: text("note").notNull().default(""),
  /** Fecha clínica de colocación (AAAA-MM-DD, America/Santiago). */
  placedOn: text("placed_on").notNull(),
  /** 1 si los datos se propusieron con IA desde la foto (el profesional los confirmó o corrigió). */
  aiRead: integer("ai_read").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  model: text("model").notNull().default(""),
  diameter: text("diameter").notNull().default(""),
  length: text("length").notNull().default(""),
  registration: text("registration").notNull().default(""),
  manufactured: text("manufactured").notNull().default(""),
  gtin: text("gtin").notNull().default(""),
  /** JSON [{label, value}] con el resto de lo impreso. */
  details: text("details").notNull().default("[]"),
  /** Contenido literal del código leído. */
  code: text("code").notNull().default(""),
  /** Pieza o material anotado en una fase de un implante (ficha de Implantología). null = no está en ninguna. */
  implantId: integer("implant_id"),
  /** Fase del implante donde se usó («cirugia», «conexion»…); vacío si no está en ninguna. */
  stage: text("stage").notNull().default(""),
  /** Qué es, con las palabras del profesional («Pilar», «Scan body», «Material»…). */
  kind: text("kind").notNull().default(""),
}, table => [index("biomedical_products_patient_idx").on(table.ownerId, table.patientId)]);

/** Ficha por implante (implantología). `images` es JSON: [{ imageId, view }] sobre clinical_images del mismo paciente. */
export const implants = sqliteTable("implants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  /** Pieza FDI permanente con punto («3.6»). */
  tooth: text("tooth").notNull(),
  phase: text("phase").notNull().default(""),
  brand: text("brand").notNull().default(""),
  system: text("system").notNull().default(""),
  /** Tipo de conexión confirmado por el profesional; vacío = sin registrar. */
  connection: text("connection").notNull().default(""),
  /** JSON [{phase, date}] en el orden en que se registró. */
  history: text("history").notNull().default("[]"),
  diameter: real("diameter"),
  length: real("length"),
  /** AAAA-MM-DD o vacío si aún no se instala o no se registró. */
  placedOn: text("placed_on").notNull().default(""),
  torque: integer("torque"),
  isq: integer("isq"),
  /** Etiqueta escaneada (biomedical_products, categoría implante). */
  productId: integer("product_id"),
  images: text("images").notNull().default("[]"),
  /** JSON {fase: nota} con lo que el profesional anotó en cada fase. */
  stageNotes: text("stage_notes").notNull().default("{}"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("implants_patient_idx").on(table.ownerId, table.patientId)]);

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

/** Cuota de almacenamiento R2 por espacio (owner_id). Ver lib/space-quota.ts. */
export const spaceQuotas = sqliteTable("space_quotas", {
  ownerId: text("owner_id").primaryKey(),
  planName: text("plan_name").notNull().default("gratis"),
  quotaBytes: integer("quota_bytes").notNull().default(524288000),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
