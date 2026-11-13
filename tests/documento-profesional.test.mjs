import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProfile, professionalDocumentTypeOf } from "../lib/clinician-profile.ts";

const base = { firstName: "Ana", lastName: "Pérez", specialty: "Odontología general" };

test("el RUT chileno sigue validándose con dígito verificador", () => {
  assert.equal(checkProfile({ ...base, rut: "12345678-5" }).ok, true);
  assert.equal(checkProfile({ ...base, rut: "12345678-9" }).ok, false);
  assert.equal(checkProfile({ ...base, rut: "AB123456", documentType: "rut" }).ok, false);
});

test("un profesional de otro país entra con su documento", () => {
  for (const rut of ["1-0234-0567", "8-123-456", "2345 67890 1234", "p1234567"]) {
    const r = checkProfile({ ...base, rut, documentType: "extranjero" });
    assert.equal(r.ok, true, rut);
  }
  const r = checkProfile({ ...base, rut: "1-0234-0567", documentType: "extranjero" });
  assert.equal(r.ok && r.profile.rut, "102340567");
});

test("documentos extranjeros inválidos se rechazan", () => {
  for (const rut of ["", "12", "ABCDEFGH", "1".repeat(21)]) assert.equal(checkProfile({ ...base, rut, documentType: "extranjero" }).ok, false, rut);
});

test("al reabrir el perfil se reconoce el tipo", () => {
  assert.equal(professionalDocumentTypeOf("12.345.678-5"), "rut");
  assert.equal(professionalDocumentTypeOf("102340567"), "extranjero");
});

test("los dos formularios ofrecen el tipo de documento", () => {
  for (const f of ["components/professional-registration.tsx", "components/profile-dialog.tsx"]) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(s, /professional-document-type/);
    assert.match(s, /Documento extranjero/);
  }
});
