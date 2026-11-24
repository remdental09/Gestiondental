import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript, toothMentions, toothClause, maskInstrumentSizes } from "../lib/dictation/proposal.ts";
import { applySelfCorrections } from "../lib/dictation/spoken.ts";
import { actPairs } from "../lib/dictation/clinical-items.ts";

const teeth = (text) => toothMentions(text).filter((m) => m.ok).map((m) => m.tooth);
const tools = { sentences: (t) => [t], teethIn: teeth, isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };

test("autocorrección con artículo: «la 16 por oclusal, no perdón, en la FDI 1.6» deja solo la 1.6", () => {
  const { text, corrections } = applySelfCorrections("le hice una obturación en la 16 por oclusal, no perdón, en la FDI 1.6 con resina compuesta.");
  assert.deepEqual(teeth(text), [16]);
  assert.ok(!/\bla 16\b/.test(text));
  assert.equal(corrections.length, 1);
  const p = structureTranscript(text, { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => o.tooth), [16]);
});

test("«la 20 de marzo … perdón 30» no se toma por pieza corregida", () => {
  const { text } = applySelfCorrections("Control la 20 de marzo, no perdón, la 30 de marzo.");
  assert.equal(text, "Control la 20 de marzo, no perdón, la 30 de marzo.");
});

test("el número de una lima («hasta la 25») no es una pieza", () => {
  assert.deepEqual(teeth("Instrumentación con limas rotatorias hasta la 25, hipoclorito."), []);
  assert.deepEqual(teeth("Conformación con lima número 30 en la 3.6."), [36]);
  assert.equal(maskInstrumentSizes("Se opera la 25"), "Se opera la 25", "sin lima ni instrumentación no se toca");
  assert.equal(teeth("Extracción de la 25.").length, 1, "«la 25» sin lima sigue siendo una pieza");
});

test("cada pieza usa solo su tramo: «Obturé la 1.6 oclusal y la 2.5 mesial» no cruza las caras", () => {
  assert.equal(toothClause("Obturé la 1.6 oclusal y la 2.5 mesial con resina compuesta", 16), "Obturé la 1.6 oclusal");
  const p = structureTranscript("Obturé la 1.6 oclusal y la 2.5 mesial con resina compuesta.", { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["16O", "25M"]);
});

test("una lista con una sola descripción comparte la cara: «las piezas 1.6 y 2.6» oclusal sigue funcionando", () => {
  const p = structureTranscript("Se aplica sellante de fosas y fisuras en las piezas 1.6 y 2.6.", { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["16O", "26O"]);
});

test("el plan reparte cada tratamiento a sus piezas, sin cruzarlos con todas", () => {
  const part = "Plan: obturar 1.6 y 2.5, endodoncia en la 3.6 y después corona";
  const pairs = actPairs(part, teeth(part), ["obturacion", "endodoncia", "corona"], tools);
  assert.ok(pairs, "se pudo repartir");
  const key = (p) => `${p.category}:${p.tooth}`;
  assert.deepEqual(pairs.map(key).sort(), ["corona:36", "endodoncia:36", "obturacion:16", "obturacion:25"]);
});

test("sin tramos separables, actPairs devuelve null y queda el cruce de siempre", () => {
  assert.equal(actPairs("Se obtura y se hace endodoncia en las piezas 1.6 y 2.6", [16, 26], ["obturacion", "endodoncia"], tools), null);
});
