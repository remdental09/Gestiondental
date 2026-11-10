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

test("se retira la amalgama y se coloca vidrio ionómero para inactivar caries: no se cobra amalgama ni obturación aparte", () => {
  const line = "En la pieza 1.6 se retira la amalgama fracturada y se elimina la caries. Se coloca vidrio ionómero en dos porciones para inactivar la caries dentinaria superficial.";
  const odontogram = ["M", "O"].map((surface) => ({ kind: "surface", tooth: 16, surface, finding: { condition: "restored" }, sourceText: line }));
  const items = suggestPrestaciones(odontogram, [line]);
  assert.deepEqual(items.map((item) => item.code), ["5010029"]);
});

test("se retira la amalgama y se obtura con resina: vale la resina", () => {
  const line = "En la pieza 1.6 se retira la amalgama filtrada y se obtura con resina compuesta.";
  const odontogram = ["M", "O"].map((surface) => ({ kind: "surface", tooth: 16, surface, finding: { condition: "restored" }, sourceText: line }));
  assert.deepEqual(suggestPrestaciones(odontogram, [line]).map((item) => [item.code, item.tooth]), [["5005018", 16]]);
});

test("obturación de amalgama sigue siendo amalgama", () => {
  const line = "Se realiza obturación de amalgama en la pieza 4.6, caras oclusal y distal.";
  const odontogram = ["O", "D"].map((surface) => ({ kind: "surface", tooth: 46, surface, finding: { condition: "restored" }, sourceText: line }));
  assert.deepEqual(suggestPrestaciones(odontogram, [line]).map((item) => item.code), ["5005002"]);
});

test("código de amalgama elegido por la IA se descarta si el texto dice que la amalgama se retiró", () => {
  const text = "En la pieza 3 se retira la amalgama fracturada y se elimina la caries. Se coloca vidrio ionómero para inactivar la caries dentinaria superficial.";
  const items = suggestPrestaciones([], [text], [{ text, code: "5005002" }, { text, code: "5010029" }]);
  assert.deepEqual(items.map((item) => item.code), ["5010029"]);
});

test("inactivación de caries con ionómero: el odontograma queda con caries (dentina superficial), no obturado", () => {
  const p = structureTranscript("En la pieza 1.6 caras mesial y oclusal se elimina la caries y se coloca vidrio ionómero para inactivar la caries de dentina superficial.", { today: "2026-11-10" });
  const faces = p.odontogram.filter((item) => item.kind === "surface" && item.tooth === 16);
  assert.ok(faces.length >= 1);
  assert.ok(faces.every((item) => item.finding?.condition === "caries"), JSON.stringify(faces.map((f) => f.finding)));
  assert.ok(faces.every((item) => item.finding?.depth === "dentin_superficial" || item.finding?.depth), "con profundidad");
});
