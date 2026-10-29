import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
}, table => [index("evolutions_patient_date_idx").on(table.patientId, table.clinicalDate), uniqueIndex("evolutions_owner_request_unique").on(table.ownerId, table.requestId)]);

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  title: text("title").notNull(),
  items: text("items").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("budgets_patient_idx").on(table.patientId)]);

export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  day: text("day").notNull(),
  time: text("time").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("appointments_patient_day_idx").on(table.patientId, table.day)]);

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