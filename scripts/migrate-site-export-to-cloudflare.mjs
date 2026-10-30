import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const exportPath = process.argv[2];
if (!exportPath) {
  throw new Error("Provide the absolute path to the downloaded clinical export.");
}

const projectRoot = process.cwd();
const configPath = resolve(projectRoot, "dist/server/wrangler.json");
const wranglerPath = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const exportData = JSON.parse(readFileSync(exportPath, "utf8"));
if (exportData.format !== "gestion-dental-clinical-export" || exportData.version !== 1) {
  throw new Error("Unsupported clinical export format.");
}

const sourceTables = exportData.tables;
const specs = [
  { source: "patients", target: "patients", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["name", "name"], ["birthDate", "birth_date"],
    ["rut", "rut"], ["reason", "reason"], ["status", "status"], ["allergies", "allergies"],
    ["history", "history"], ["driveFolderId", "drive_folder_id"], ["createdAt", "created_at"],
    ["updatedAt", "updated_at"], ["phone", "phone"], ["email", "email"],
  ] },
  { source: "evolutions", target: "evolutions", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["patientId", "patient_id"], ["clinicalDate", "clinical_date"],
    ["recordedAt", "recorded_at"], ["title", "title"], ["body", "body"],
    ["sourceDocumentId", "source_document_id"], ["backupStatus", "backup_status"], ["requestId", "request_id"],
  ] },
  { source: "budgets", target: "budgets", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["patientId", "patient_id"], ["title", "title"],
    ["items", "items"], ["status", "status"], ["createdAt", "created_at"],
  ] },
  { source: "appointments", target: "appointments", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["patientId", "patient_id"], ["day", "day"],
    ["time", "time"], ["reason", "reason"], ["createdAt", "created_at"],
  ] },
  { source: "periodontalExams", target: "periodontal_exams", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["patientId", "patient_id"],
    ["recordedAt", "recorded_at"], ["teeth", "teeth"],
  ] },
  { source: "toothStatuses", target: "tooth_statuses", columns: [
    ["patientId", "patient_id"], ["ownerId", "owner_id"], ["data", "data"], ["updatedAt", "updated_at"],
  ] },
  { source: "clinicalImages", target: "clinical_images", columns: [
    ["id", "id"], ["ownerId", "owner_id"], ["patientId", "patient_id"], ["objectKey", "object_key"],
    ["name", "name"], ["kind", "kind"], ["note", "note"], ["size", "size"],
    ["contentType", "content_type"], ["addedAt", "added_at"],
  ] },
  { source: "driveBackups", target: "drive_backups", columns: [
    ["patientId", "patient_id"], ["ownerId", "owner_id"], ["documentId", "document_id"],
    ["snapshotDigest", "snapshot_digest"], ["verifiedAt", "verified_at"],
  ] },
];

for (const spec of specs) {
  if (!Array.isArray(sourceTables?.[spec.source])) {
    throw new Error(`Export is missing table ${spec.source}.`);
  }
}
if (!Array.isArray(sourceTables.clinicalImages)) {
  throw new Error("Export is missing image metadata.");
}
if (Number(exportData.counts?.unavailableImageFiles ?? 0) !== 0) {
  throw new Error("The export contains image records without their binary files.");
}

function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The export contains a non-finite number.");
    return String(value);
  }
  if (typeof value === "string") {
    const hex = Buffer.from(value, "utf8").toString("hex");
    return `CAST(X'${hex}' AS TEXT)`;
  }
  throw new Error("The export contains an unsupported database value.");
}

const statements = [];
const importedCounts = {};
for (const spec of specs) {
  const rows = sourceTables[spec.source];
  importedCounts[spec.target] = rows.length;
  for (const row of rows) {
    const values = spec.columns.map(([sourceColumn]) => {
      if (!Object.hasOwn(row, sourceColumn)) {
        throw new Error(`A row in ${spec.source} is missing a required column.`);
      }
      return sqlValue(row[sourceColumn]);
    });
    const columns = spec.columns.map(([, targetColumn]) => `"${targetColumn}"`).join(",");
    statements.push(`INSERT INTO "${spec.target}" (${columns}) VALUES (${values.join(",")});`);
  }
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args, "--config", configPath], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Cloudflare import command failed; no source data was written to the repository.");
  }
}

const imageTempPaths = [];
const sqlPath = join(tmpdir(), `gestion-dental-${randomUUID()}.sql`);
try {
  for (const image of sourceTables.clinicalImages) {
    if (!image.contentAvailable || typeof image.contentBase64 !== "string" || !image.objectKey) {
      throw new Error("An image record is missing its exported binary or object key.");
    }
    const bytes = Buffer.from(image.contentBase64, "base64");
    if (bytes.toString("base64") !== image.contentBase64) {
      throw new Error("An image binary is not valid base64.");
    }
    const imagePath = join(tmpdir(), `gestion-dental-${randomUUID()}.bin`);
    imageTempPaths.push(imagePath);
    writeFileSync(imagePath, bytes, { mode: 0o600 });
    runWrangler([
      "r2", "object", "put", `gestion-dental-clinical-images/${image.objectKey}`,
      "--remote", "--file", imagePath, "--content-type", image.contentType || "application/octet-stream",
    ]);
  }

  writeFileSync(sqlPath, statements.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  if (statements.length > 0) {
    runWrangler(["d1", "execute", "gestion-dental-clinical", "--remote", "--file", sqlPath]);
  }
  console.log(JSON.stringify({ uploadedImages: imageTempPaths.length, importedCounts }));
} finally {
  rmSync(sqlPath, { force: true });
  for (const imagePath of imageTempPaths) rmSync(imagePath, { force: true });
}
