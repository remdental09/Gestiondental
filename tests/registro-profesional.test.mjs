import test from "node:test";
import assert from "node:assert/strict";
import { checkProfile, displayName, formatRut, validRut, SPECIALTIES } from "../lib/clinician-profile.ts";

test("RUT: módulo 11, con y sin formato", () => {
  assert.equal(validRut("12.345.678-5"), true);
  assert.equal(validRut("123456785"), true);
  assert.equal(validRut("12.345.678-9"), false);
  assert.equal(validRut("11.111.111-1"), true);
  assert.equal(validRut("7.775.555-K"), false);
  assert.equal(validRut(""), false);
  assert.equal(validRut("abc"), false);
});

test("RUT con K como dígito verificador", () => {
  assert.equal(validRut("6.000.000-K"), true);
  assert.equal(validRut("6.000.000-5"), false);
  assert.equal(validRut("10.000.013-K"), true);
});

test("formatRut da puntos y guion", () => {
  assert.equal(formatRut("123456785"), "12.345.678-5");
  assert.equal(formatRut("11111111-1"), "11.111.111-1");
});

test("checkProfile valida y normaliza", () => {
  const ok = checkProfile({ firstName: "  Luis ", lastName: "Rodríguez  M", rut: "123456785", specialty: "Implantología oral" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.profile, { firstName: "Luis", lastName: "Rodríguez M", rut: "12.345.678-5", specialty: "Implantología oral", extraTitles: "", clinicName: "" });
  assert.equal(displayName(ok.profile), "Dr(a). Luis Rodríguez M");
});

test("checkProfile rechaza datos incompletos o inventados", () => {
  const base = { firstName: "Luis", lastName: "Rodríguez", rut: "12.345.678-5", specialty: SPECIALTIES[0] };
  assert.equal(checkProfile({ ...base, firstName: "" }).ok, false);
  assert.equal(checkProfile({ ...base, lastName: "<script>" }).ok, false);
  assert.equal(checkProfile({ ...base, rut: "12.345.678-9" }).ok, false);
  assert.equal(checkProfile({ ...base, specialty: "Brujería" }).ok, false);
  assert.equal(checkProfile(null).ok, false);
});

test("perfil editable: otros títulos opcionales, recortados y con espacios limpios", () => {
  const base = { firstName: "Ana", lastName: "Soto", rut: "12.345.678-5", specialty: "Endodoncia" };
  const sin = checkProfile(base);
  assert.equal(sin.ok, true);
  assert.equal(sin.profile.extraTitles, "");
  const con = checkProfile({ ...base, extraTitles: "  Diplomado   en implantología \n magíster en gestión  " });
  assert.equal(con.profile.extraTitles, "Diplomado en implantología magíster en gestión");
  assert.equal(checkProfile({ ...base, extraTitles: "x".repeat(900) }).profile.extraTitles.length, 300);
  assert.equal(checkProfile({ ...base, specialty: "Inventada" }).ok, false);
  assert.equal(checkProfile({ ...base, rut: "12.345.678-9" }).ok, false);
});

test("nombre de la clínica: opcional, sin espacios de más, máximo 60 caracteres", () => {
  const base = { firstName: "Luis", lastName: "Rodríguez", rut: "123456785", specialty: "Implantología oral" };
  assert.equal(checkProfile(base).profile.clinicName, "");
  assert.equal(checkProfile({ ...base, clinicName: "  Clínica   Sonrisa  Sur " }).profile.clinicName, "Clínica Sonrisa Sur");
  assert.equal(checkProfile({ ...base, clinicName: "x".repeat(200) }).profile.clinicName.length, 60);
  assert.equal(checkProfile({ ...base, clinicName: 5 }).profile.clinicName, "");
});
