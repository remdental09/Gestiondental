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
