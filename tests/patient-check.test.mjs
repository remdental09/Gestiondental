import test from "node:test";
import assert from "node:assert/strict";
import { checkPatientMentions, patientWarning, normalizeRut, validRut } from "../lib/dictation/patient-check.ts";

// Datos ficticios: no corresponden a pacientes reales.
const ficha = { name: "Camila Fuentes Araya", rut: "11.111.111-1" };
const warns = (text, patient = ficha) => patientWarning(checkPatientMentions(text, patient), patient.name, patient.rut);

test("otro nombre de paciente en el dictado genera aviso", () => {
  assert.equal(warns("paciente Juan Pérez acude por control pieza 3.6 caries oclusal").length, 1);
  assert.match(warns("paciente Juan Pérez acude por control")[0], /Juan Pérez/);
  assert.equal(warns("la señora González refiere dolor").length, 1);
  assert.equal(warns("don Pedro Soto viene a control").length, 1);
});

test("el paciente de la ficha no alarma: tildes, mayúsculas y apellido parcial", () => {
  assert.deepEqual(warns("paciente Camila Fuentes acude a control"), []);
  assert.deepEqual(warns("la señora fuentes refiere sensibilidad"), []);
  assert.deepEqual(warns("paciente CAMILA ARAYA"), []);
  assert.deepEqual(warns("paciente Camila Fuentes Araya", { name: "Cámila Fuéntes Araya" }), []);
});

test("nombres de doctores, piezas y palabras clínicas no alarman", () => {
  assert.deepEqual(warns("doctora Rojas indica exodoncia de la 4.8"), []);
  assert.deepEqual(warns("derivado por el doctor Muñoz pieza 2.6 pulpitis"), []);
  assert.deepEqual(warns("paciente refiere dolor en la pieza 3.6"), []);
  assert.deepEqual(warns("paciente diabética toma metformina"), []);
  assert.deepEqual(warns("paciente niega alergias pieza dos cuatro caries mesial"), []);
  assert.deepEqual(warns("pieza 1.1 resina vestibular paciente tranquila"), []);
});

test("un RUT distinto al de la ficha alarma; el mismo RUT no", () => {
  assert.equal(warns("RUT 12.345.678-5 paciente acude a control").length, 1);
  assert.deepEqual(warns("RUT 11.111.111-1 acude a control"), []);
  assert.deepEqual(warns("paciente acude a control", { name: "Camila Fuentes Araya", rut: null }), []);
});

test("normaliza y valida el dígito verificador del RUT", () => {
  assert.equal(normalizeRut("12.345.678-5"), "123456785");
  assert.equal(validRut("12.345.678-5"), true);
  assert.equal(validRut("11.111.111-1"), true);
  assert.equal(validRut("12.345.678-9"), false);
});
