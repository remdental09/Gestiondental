import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("el aviso de «Nuevo paciente» valida el documento según su tipo (no siempre como RUT)", () => {
  assert.match(page, /const patientValidation=validatePatientDraft\(\{name,birthDate,rut,docType,phone,email,reason\}\);/);
});

test("al guardar un paciente nuevo se envía el tipo de documento elegido", () => {
  assert.match(page, /const patientDraft=\{name,birthDate:birth,rut,docType,phone,email,reason\};/);
  assert.doesNotMatch(page, /const patientDraft=\{name,birthDate:birth,rut,phone,/);
});
