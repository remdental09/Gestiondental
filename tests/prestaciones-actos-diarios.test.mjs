import test from "node:test";
import assert from "node:assert/strict";
import { suggestPrestaciones } from "../lib/dictation/prestaciones.ts";

const codes = (line) => suggestPrestaciones([], [line], [], line, []).map((item) => item.code);

test("actos diarios con código inequívoco se sugieren desde la línea del procedimiento", () => {
  assert.deepEqual(codes("FDI 4.7 (Chile 18): recubrimiento pulpar directo con MTA."), ["5001034"]);
  assert.deepEqual(codes("FDI 3.5: recubrimiento pulpar indirecto con hidróxido de calcio."), ["5001038"]);
  assert.deepEqual(codes("Alveolitis en la 3.6, curación con alvogyl."), ["5001015"]);
  assert.deepEqual(codes("Frenectomía labial superior."), ["5009041"]);
  assert.deepEqual(codes("Biopsia de lesión en mucosa yugal."), ["5003010"]);
  assert.deepEqual(codes("Drenaje de absceso en la 2.6."), ["5003022"]);
  assert.deepEqual(codes("FDI 1.2: corona provisoria de acrílico."), ["5007005"]);
  assert.deepEqual(codes("Mantenedor de espacio banda y asa en la 7.5."), ["5010005"]);
  assert.deepEqual(codes("FDI 5.4: corona de acero cromo."), ["5010036"]);
  assert.deepEqual(codes("Blanqueamiento dental en consultorio."), ["5001011"]);
});

test("pulpotomía: solo se sugiere en diente temporal; en permanente queda a elección", () => {
  assert.deepEqual(codes("FDI 5.5: pulpotomía con formocresol."), ["5010042"]);
  assert.deepEqual(codes("FDI 1.4: pulpotomía."), []);
});

test("sin dato claro no se inventa: biopsia sin sitio y cobros que no existen", () => {
  assert.deepEqual(codes("Biopsia de la lesión."), []);
  assert.deepEqual(codes("Se recetó amoxicilina 500 cada ocho horas."), []);
});
