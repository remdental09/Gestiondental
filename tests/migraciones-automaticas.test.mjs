import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { planMigrations, BASELINE } from "../scripts/apply-migrations.mjs";

const files = ["0019_call_contacts.sql", "0020_stamp_mark.sql", "0021_biomedical_products.sql", "0022_nueva.sql", "meta", "0018_appointment_cycle.sql"];

test("migraciones: primera ejecución anota la línea base y solo ejecuta lo posterior", () => {
  const plan = planMigrations(files, []);
  assert.deepEqual(plan.baseline, ["0018_appointment_cycle.sql", "0019_call_contacts.sql", "0020_stamp_mark.sql", "0021_biomedical_products.sql"]);
  assert.deepEqual(plan.run, ["0022_nueva.sql"]);
});

test("migraciones: después solo corren las que faltan, una vez y en orden", () => {
  const base = ["0018_appointment_cycle.sql", "0019_call_contacts.sql", "0020_stamp_mark.sql", "0021_biomedical_products.sql"];
  assert.deepEqual(planMigrations(files, base).run, ["0022_nueva.sql"]);
  assert.deepEqual(planMigrations(files, [...base, "0022_nueva.sql"]).run, []);
});

test("migraciones: la línea base existe en drizzle/ y el workflow ejecuta el script tras las migraciones antiguas", () => {
  assert.ok(readdirSync(new URL("../drizzle/", import.meta.url)).includes(BASELINE));
  const workflow = readFileSync(new URL("../.github/workflows/deploy-cloudflare-worker.yml", import.meta.url), "utf8");
  assert.ok(workflow.indexOf("0018_appointment_cycle.sql") < workflow.indexOf("node scripts/apply-migrations.mjs"));
  assert.ok(workflow.indexOf("node scripts/apply-migrations.mjs") < workflow.indexOf("Desplegar Worker compilado"));
});
