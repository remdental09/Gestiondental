import test from "node:test";
import assert from "node:assert/strict";
import { decidePatient } from "../lib/dictation/patient-identify.ts";

const patients = [{ id: 1, name: "Luis Paul Rodríguez Murga", rut: "13.051.751-K" }, { id: 2, name: "Ana Pérez Soto", rut: "" }];

for (const phrase of ["crear paciente", "Crea un paciente nuevo", "paciente nuevo, Marta Gómez Lillo", "quiero crear la ficha de un paciente nuevo"]) {
  test(`«${phrase}» → paciente nuevo (se abre el formulario manual)`, () => {
    const decision = decidePatient(phrase, patients);
    assert.equal(decision.identity.newPatientHint, true);
    assert.equal(decision.decision, "new");
  });
}

test("dictar a un paciente existente no abre el formulario de nuevo", () => {
  const decision = decidePatient("control de Ana Pérez Soto, todo bien", patients);
  assert.notEqual(decision.decision, "new");
});
