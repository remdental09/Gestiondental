import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalRegister, CLINICAL_REGISTER_PROMPT } from "../lib/dictation/clinical-register.ts";
import { deduplicateProcedureSentences, CLINICAL_WRITING_PROMPT } from "../lib/dictation/clinical-writing.ts";
import { dentalDictionary, dentalDictionaryHints } from "../lib/dictation/dental-lexicon.ts";

// Dictados y notas ficticios, sin datos de pacientes.
test("«tartrectomía» no se usa en Chile: la nota escribe «destartraje»", () => {
  const nota = "Se efectúa pulido de la obturación y tartrectomía con pulido coronario en la pieza 9. Tartrectomía supragingival.";
  const { text, replaced } = applyClinicalRegister(nota, "hicimos la resina y una limpieza con pulido");
  assert.equal(text, "Se efectúa pulido de la obturación y destartraje con pulido coronario en la pieza 9. Destartraje supragingival.");
  assert.equal(replaced.length, 2);
  assert.equal(applyClinicalRegister("Dos tartrectomías.", "x").text, "Dos destartrajes.");
});

test("si el profesional dictó el término, se respeta; sin el término no cambia nada", () => {
  const nota = "Se realiza tartrectomía.";
  assert.equal(applyClinicalRegister(nota, "hice una tartrectomía").text, nota);
  assert.equal(applyClinicalRegister("Se realiza destartraje.", "hice un destartraje").text, "Se realiza destartraje.");
});

test("la guía de redacción trae el registro chileno y las verbalizaciones coloquiales", () => {
  assert.match(CLINICAL_WRITING_PROMPT, /Registro clínico de esta consulta/);
  assert.match(CLINICAL_REGISTER_PROMPT, /tapadura.*restauración/);
  assert.match(CLINICAL_REGISTER_PROMPT, /no todo se dicta con exactitud|No todo se dicta con exactitud/);
});

test("el diccionario ya no presenta «tartrectomía» como forma válida chilena", () => {
  for (const [group, terms] of Object.entries(dentalDictionary())) {
    assert.equal(terms.some((term) => /tartrectom/i.test(term)), false, group);
  }
  assert.match(dentalDictionaryHints(), /Tartrectomía» no existe en esta consulta/);
  assert.doesNotMatch(dentalDictionaryHints(), /destartraje, detartraje y tartrectomía/);
});

test("una restauración repetida con otras palabras («eliminación» por «remoción») se escribe una sola vez", () => {
  const texto = "Se realiza remoción de caries y restauración de composite fotocurado en las caras palatina y mesial de la pieza 9. Se realiza restauración de composite fotocurado en las caras palatina y mesial de la pieza 9, posterior a la eliminación de la caries.";
  const limpio = deduplicateProcedureSentences(texto);
  assert.equal((limpio.match(/restauración de composite/g) ?? []).length, 1);
  assert.match(limpio, /caries/);
});
