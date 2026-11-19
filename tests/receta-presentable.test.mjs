import test from "node:test";
import assert from "node:assert/strict";
import { ageFromBirthDate, splitPrescriptionLines } from "../lib/clinical-documents.ts";

test("la prescripción separa medicamento y pauta sin inventar datos", () => {
  assert.deepEqual(splitPrescriptionLines("Ibuprofeno 400 mg"), [{ name: "Ibuprofeno 400 mg", detail: "" }]);
  assert.deepEqual(splitPrescriptionLines("1. Amoxicilina 500 mg — 1 cápsula cada 8 horas por 7 días\n\n- Paracetamol 1 g, si hay dolor"), [
    { name: "Amoxicilina 500 mg", detail: "1 cápsula cada 8 horas por 7 días" },
    { name: "Paracetamol 1 g", detail: "si hay dolor" },
  ]);
  assert.deepEqual(splitPrescriptionLines("  \n "), []);
});

test("la edad se calcula por fecha de nacimiento y devuelve null si no hay dato", () => {
  const today = new Date("2026-11-19T12:00:00Z");
  assert.equal(ageFromBirthDate("1976-11-19", today), 50);
  assert.equal(ageFromBirthDate("1976-11-20", today), 49);
  assert.equal(ageFromBirthDate("", today), null);
  assert.equal(ageFromBirthDate("sin registrar", today), null);
});
