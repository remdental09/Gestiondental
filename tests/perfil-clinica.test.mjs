import test from "node:test";
import assert from "node:assert/strict";
import { checkClinic, formatPhone, EMPTY_CLINIC } from "../lib/clinic-profile.ts";

const base = { ...EMPTY_CLINIC, clinicName: "  Clínica   Sonrisa Sur ", address: "Av. Alemania 123", city: "Temuco", email: "Contacto@Clinica.CL", phone: "912345678", phone2: "+56 45 2123456", openTime: "08:00", closeTime: "22:00" };

test("normaliza nombre, email y teléfonos", () => {
  const r = checkClinic(base);
  assert.ok(r.ok);
  assert.equal(r.clinic.clinicName, "Clínica Sonrisa Sur");
  assert.equal(r.clinic.email, "contacto@clinica.cl");
  assert.equal(r.clinic.phone, "+56 9 1234 5678");
  assert.equal(r.clinic.phone2, "+56 4 5212 3456");
});
test("formatPhone respeta prefijos extranjeros y vacíos", () => {
  assert.equal(formatPhone(""), "");
  assert.equal(formatPhone("+54 11 5555 1234"), "+541155551234");
  assert.equal(formatPhone("56912345678"), "+56 9 1234 5678");
});
test("rechaza datos inválidos", () => {
  assert.equal(checkClinic({ ...base, email: "x" }).ok, false);
  assert.equal(checkClinic({ ...base, phone: "12" }).ok, false);
  assert.equal(checkClinic({ ...base, openTime: "25:00" }).ok, false);
  assert.equal(checkClinic({ ...base, openTime: "22:00", closeTime: "08:00" }).ok, false);
  assert.equal(checkClinic({ ...base, closeTime: "" }).ok, false);
});
test("horario y teléfonos son opcionales", () => {
  assert.ok(checkClinic({ clinicName: "X" }).ok);
  assert.ok(checkClinic(null).ok);
});
test("logo: solo data URL de imagen y con tope de tamaño", () => {
  assert.ok(checkClinic({ ...base, logo: "data:image/png;base64,AAAA" }).ok);
  assert.equal(checkClinic({ ...base, logo: "https://x.cl/a.png" }).ok, false);
  assert.equal(checkClinic({ ...base, logo: "data:image/svg+xml;base64,AAAA" }).ok, false);
  assert.equal(checkClinic({ ...base, logo: "data:image/png;base64," + "A".repeat(90000) }).ok, false);
});
