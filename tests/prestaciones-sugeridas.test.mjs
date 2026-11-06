import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript } from "../lib/dictation/proposal.ts";
import { procedureLinesOf, restorationCode, suggestPrestaciones, withPrestacionesSection } from "../lib/dictation/prestaciones.ts";

const suggest = (text) => {
  const p = structureTranscript(text, { today: "2026-11-06" });
  return { p, items: suggestPrestaciones(p.odontogram, procedureLinesOf(p.evolution.body)) };
};

test("la obturación se asocia al arancel según material, tipo de diente y caras", () => {
  assert.equal(restorationCode("composite", 35, 2), "5005018");
  assert.equal(restorationCode("composite", 36, 1), "5005017");
  assert.equal(restorationCode("composite", 36, 3), "5005040");
  assert.equal(restorationCode("composite", 11, 1), "5005005");
  assert.equal(restorationCode("composite", 11, 2), "5005006");
  assert.equal(restorationCode("amalgama", 46, 2), "5005002");
});

test("un procedimiento dictado trae su prestación del arancel, sin dinero", () => {
  const { items } = suggest("Se realiza obturación de resina compuesta en las caras oclusal y mesial de la pieza 3.5. Se realiza destartraje supragingival en ambas arcadas.");
  assert.deepEqual(items.map((item) => [item.code, item.tooth]), [["5005018", 35], ["5001030", null]]);
});

test("la sección de prestaciones se agrega a la nota y se reemplaza sin duplicarse", () => {
  const { p, items } = suggest("Se realiza obturación de resina compuesta en las caras oclusal y mesial de la pieza 3.5.");
  const once = withPrestacionesSection(p.evolution.body, items);
  assert.match(once, /Prestaciones \(arancel\)\n5005018 · Composite fotocurado compuesto posterior \(FDI 3\.5\)/);
  assert.equal(withPrestacionesSection(once, items), once);
  assert.doesNotMatch(withPrestacionesSection(once, []), /Prestaciones \(arancel\)/);
});

test("sin procedimiento realizado no se sugiere prestación", () => {
  assert.deepEqual(suggest("Se observa caries en la pieza 3.5 oclusal.").items, []);
});
