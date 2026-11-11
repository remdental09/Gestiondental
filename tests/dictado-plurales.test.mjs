import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript } from "../lib/dictation/proposal.ts";

const chart = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {} };
const marks = (text) => structureTranscript(text, chart).odontogram.map((item) => `${item.tooth}:${item.status ?? item.kind}`).sort();

test("«coronas» en plural con lista de piezas se registra una por pieza (numeración chilena y FDI)", () => {
  const four = ["11:Corona", "12:Corona", "21:Corona", "22:Corona"];
  assert.deepEqual(marks("Se constatan cuatro coronas clínicas correspondientes a las piezas 7, 8, 9 y 10, confeccionadas en circonio y cementadas sobre dientes."), four);
  assert.deepEqual(marks("Tiene coronas de circonio en las piezas 7, 8, 9 y 10."), four);
  assert.deepEqual(marks("Coronas en la 1.2, 1.1, 2.1 y 2.2."), four);
  assert.deepEqual(marks("Coronas en las piezas 1.1 y 2.1."), ["11:Corona", "21:Corona"]);
});

test("la corona plural conserva material y soporte, y la endodoncia contada por la paciente no se registra", () => {
  const result = structureTranscript("La paciente comunica que las piezas 8 y 9 tienen tratamiento de endodoncia. Se constatan cuatro coronas clínicas correspondientes a las piezas 7, 8, 9 y 10, confeccionadas en circonio y cementadas sobre dientes.", chart);
  assert.equal(result.odontogram.length, 4);
  for (const item of result.odontogram) { assert.equal(item.material, "Zirconio"); assert.equal(item.foundation, "tooth"); }
  assert.equal((result.prestaciones ?? []).length, 0);
});

test("«ausentes» en plural marca cada pieza", () => {
  assert.deepEqual(marks("Ausentes las piezas 1.8, 2.8 y 3.8."), ["18:Ausente", "28:Ausente", "38:Ausente"]);
  assert.deepEqual(marks("Ausentes las piezas 1 y 16."), ["18:Ausente", "28:Ausente"]);
});

test("lo que no es una corona colocada sigue sin registrarse", () => {
  assert.deepEqual(marks("Alargamiento de corona clínica en la pieza 1.1."), []);
  assert.deepEqual(marks("Coronas provisorias en las piezas 1.1 y 2.1."), []);
});
