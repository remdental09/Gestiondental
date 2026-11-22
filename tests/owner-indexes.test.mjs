import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Cada lectura de /api/clinical filtra por owner_id: sin estos índices D1 recorre (y cobra) las filas de todas las cuentas.
test("migración 0013 aditiva con índices por owner_id", () => {
  const sql = readFileSync(new URL("../drizzle/0013_owner_indexes.sql", import.meta.url), "utf8");
  for (const [table, cols] of [["budgets", "`owner_id`,`id`"], ["appointments", "`owner_id`,`day`"], ["periodontal_exams", "`owner_id`,`id`"], ["tooth_statuses", "`owner_id`,`patient_id`"], ["clinical_images", "`owner_id`,`id`"], ["evolution_diagnoses", "`owner_id`,`id`"], ["evolutions", "`owner_id`,`clinical_date`,`recorded_at`"], ["payments", "`owner_id`,`paid_on`,`id`"]]) {
    assert.ok(sql.includes(`ON \`${table}\` (${cols})`), table);
  }
  assert.doesNotMatch(sql, /DROP|ALTER|DELETE|UPDATE/i);
  for (const line of sql.split("\n").filter(Boolean)) assert.match(line, /^CREATE INDEX IF NOT EXISTS/);
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0013_owner_indexes" && entry.idx === 13));
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const name of ["budgets_owner_id_idx", "appointments_owner_day_idx", "periodontal_owner_id_idx", "tooth_statuses_owner_patient_idx", "images_owner_id_idx", "evolution_diagnoses_owner_id_idx", "evolutions_owner_date_idx", "payments_owner_paid_idx"]) assert.ok(schema.includes(`"${name}"`), name);
});
