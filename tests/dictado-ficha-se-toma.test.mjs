import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript } from "../lib/dictation/proposal.ts";

// Textos sintéticos (estilo ficha Dentalsoft). Ninguno es una evolución real.
test("«se toma CBCT / impresión / Rx» y lo aplicado en la sesión no van a Medicamentos de la ficha", () => {
  for (const text of [
    "Se toma CBCT. Se explica plan de tratamiento.",
    "Se toma nueva impresión porque el plano tiene burbujas.",
    "Se toma impresión digital para placa superior.",
    "Paciente viaja mañana (toma un vuelo). Control en 2 semanas.",
    "Primera sesión de polinucleótidos 2 mg, zona peribucal.",
    "Control. Se toman fotos y radiografías.",
  ]) {
    const proposal = structureTranscript(text);
    assert.deepEqual((proposal.ficha ?? []).map((item) => item.text), [], text);
  }
});

test("un medicamento dictado sigue yendo a la ficha", () => {
  for (const text of ["Toma losartán 50 mg.", "Paciente toma metformina 850 mg cada 12 horas.", "Se encuentra tomando amoxicilina 1 g cada 12 horas."]) {
    const proposal = structureTranscript(text);
    assert.deepEqual((proposal.ficha ?? []).map((item) => item.field), ["medications"], text);
  }
});
