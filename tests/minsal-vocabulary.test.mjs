import test from "node:test";
import assert from "node:assert/strict";
import { dentalDictionary, dentalDictionaryHints, DENTAL_SPEECH_HINTS, dentalProtectedWords } from "../lib/dictation/dental-lexicon.ts";
import { MINSAL_VOCABULARY } from "../lib/dictation/minsal-vocabulary.ts";

const fold = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

test("el vocabulario de las guías del MINSAL llega a las pistas del dictado", () => {
  for (const term of ["pericoronaritis aguda", "raspado y alisado radicular", "prótesis parcial removible", "alveolitis seca", "remoción selectiva de caries", "clasificación de Kennedy"]) {
    assert.ok(fold(dentalDictionaryHints()).includes(fold(term)), term);
  }
});

test("el diccionario no repite términos entre grupos del MINSAL y el base", () => {
  const seen = new Map();
  for (const [group, terms] of Object.entries(dentalDictionary())) {
    if (!group.startsWith("minsal_")) continue;
    for (const term of terms) {
      const key = fold(term);
      assert.ok(!seen.has(key), `${term} repetido en ${group} y ${seen.get(key)}`);
      seen.set(key, group);
    }
  }
  const base = new Set(Object.entries(dentalDictionary()).filter(([g]) => !g.startsWith("minsal_")).flatMap(([, t]) => t).map(fold));
  for (const key of seen.keys()) assert.ok(!base.has(key), key);
});

test("las frases de voz son únicas y las palabras clínicas quedan protegidas", () => {
  const phrases = DENTAL_SPEECH_HINTS.map((h) => fold(h.phrase));
  assert.equal(new Set(phrases).size, phrases.length);
  for (const word of ["pericoronaritis", "alveolitis", "xerostomia", "biocerámico"].map(fold)) assert.ok(dentalProtectedWords().has(word), word);
  assert.ok(Object.values(MINSAL_VOCABULARY).every((terms) => terms.length > 5));
});
