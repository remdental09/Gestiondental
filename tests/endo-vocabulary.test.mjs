import test from "node:test";
import assert from "node:assert/strict";
import { diagnosisMatches } from "../lib/icd11.ts";
import { DENTAL_DICTIONARY_HINTS } from "../lib/dictation/dental-lexicon.ts";
import { CLINICAL_WRITING_PROMPT } from "../lib/dictation/clinical-writing.ts";

test("el orden «crónica apical» y «apical crónica» dan el mismo código CIE-11", () => {
  for (const text of ["periodontitis crónica apical", "periodontitis apical crónica", "periodontitis periapical crónica"]) {
    assert.deepEqual(diagnosisMatches(`diagnóstico de ${text} en la pieza 8`).map((m) => m.code), ["DA09.71"], text);
  }
});

test("un hallazgo radiográfico de granuloma no se codifica como diagnóstico por sí solo", () => {
  assert.deepEqual(diagnosisMatches("lesión apical con un granuloma en la radiografía"), []);
});

test("el vocabulario de endodoncia incluye medicación intraconducto y acceso", () => {
  for (const term of ["paramonoclorofenol alcanforado", "trepanación", "apertura cameral", "sesión endodóntica", "vidrio ionómero"]) {
    assert.ok(DENTAL_DICTIONARY_HINTS.includes(term), term);
  }
});

test("la redacción conserva acciones técnicas dichas en conversación y marca términos dudosos", () => {
  assert.match(CLINICAL_WRITING_PROMPT, /Dictados conversacionales/);
  assert.match(CLINICAL_WRITING_PROMPT, /marca en «dudas»|se marca en «dudas»/);
});

test("diagnósticos de las guías MINSAL sin código CIE-11 quedan como etiqueta sin código, no se pierden", () => {
  const cases = {
    "diagnóstico de periodontitis crónica generalizada": /Periodontitis crónica generalizada/,
    "diagnóstico de flegmón de origen odontogénico en la pieza 36": /Flegmón/,
    "diagnóstico de hipersensibilidad dentinaria": /Hipersensibilidad dentinaria/,
    "diagnóstico de peri-implantitis": /Periimplantitis/,
    "diagnóstico de gingivitis úlcero necrótica": /úlcero necrótica/,
    "diagnóstico de fisura labiopalatina": /Fisura labiopalatina/,
  };
  for (const [text, title] of Object.entries(cases)) {
    const found = diagnosisMatches(text);
    assert.equal(found.length, 1, text);
    assert.equal(found[0].code, "", text);
    assert.match(found[0].title, title, text);
  }
});

test("un diagnóstico con código sigue ganando sobre la etiqueta sin código", () => {
  assert.ok(diagnosisMatches("diagnóstico de pericoronaritis aguda").every((m) => m.code));
  assert.equal(diagnosisMatches("diagnóstico de periodontitis apical crónica en la pieza 8")[0].code, "DA09.71");
});
