import test from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, normalizeProfile, normalizeContacts, profileHasData, profilePhonesValid, validExtraPhone, MAX_CONTACTS } from "../lib/patient-profile.ts";

// Datos ficticios: no corresponden a pacientes reales.
test("una entrada vacía o inválida devuelve el perfil vacío, titular por defecto", () => {
  assert.deepEqual(normalizeProfile(undefined), emptyProfile());
  assert.deepEqual(normalizeProfile("texto"), emptyProfile());
  assert.equal(emptyProfile().holderType, "titular");
  assert.equal(profileHasData(emptyProfile()), false);
});

test("las listas cerradas descartan valores desconocidos y aceptan los de la lista", () => {
  const p = normalizeProfile({ gender: "Femenino", insurance: "Fonasa", maritalStatus: "inventado", referral: "Prensa", patientType: "Particular", education: "Media" });
  assert.equal(p.gender, "Femenino");
  assert.equal(p.insurance, "Fonasa");
  assert.equal(p.referral, "Prensa");
  assert.equal(p.maritalStatus, "");
  assert.equal(profileHasData(p), true);
});

test("los textos libres se limpian y se acotan", () => {
  const p = normalizeProfile({ socialName: "  Ana   Paz  ", address2: "x".repeat(500), city: "Santiago" });
  assert.equal(p.socialName, "Ana Paz");
  assert.equal(p.address2.length, 160);
  assert.equal(p.city, "Santiago");
});

test("titular/carga: solo «carga» cambia el valor por defecto", () => {
  assert.equal(normalizeProfile({ holderType: "carga" }).holderType, "carga");
  assert.equal(normalizeProfile({ holderType: "otro" }).holderType, "titular");
});

test("acompañantes y responsables: se descartan filas vacías y se limita la cantidad", () => {
  const contacts = normalizeContacts([{ name: "Luz Soto", relationship: "Madre", phone: "+56 9 1111 2222" }, { name: "", phone: "" }, null]);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].relationship, "Madre");
  const many = normalizeContacts(Array.from({ length: 20 }, (_, i) => ({ name: `Persona ${i}` })));
  assert.equal(many.length, MAX_CONTACTS);
  assert.deepEqual(normalizeContacts("no es lista"), []);
});

test("los teléfonos adicionales vacíos son válidos y los mal formados no", () => {
  assert.equal(validExtraPhone(""), true);
  assert.equal(validExtraPhone("+56 2 2345 6789"), true);
  assert.equal(validExtraPhone("abc"), false);
  assert.equal(validExtraPhone("123"), false);
  assert.equal(profilePhonesValid(normalizeProfile({ homePhone: "22345678" })), true);
  assert.equal(profilePhonesValid(normalizeProfile({ officePhone: "hola" })), false, "el servidor rechaza el guardado con un teléfono mal formado");
});

test("un perfil con teléfonos mal formados se detecta en los contactos vinculados", () => {
  const bad = { ...emptyProfile(), responsibles: [{ name: "Luz Soto", relationship: "Madre", phone: "hola" }] };
  assert.equal(profilePhonesValid(bad), false);
});
