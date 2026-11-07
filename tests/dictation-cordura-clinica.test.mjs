import test from "node:test";
import assert from "node:assert/strict";
import { applyLexicon, lexiconDoubts } from "../lib/dictation/spoken.ts";
import { DENTAL_DICTIONARY_HINTS } from "../lib/dictation/dental-lexicon.ts";
import { findImplantBrand } from "../lib/dictation/implant-brands.ts";

const fix = (text) => applyLexicon(text).text;
const aclaraciones = (text) => lexiconDoubts(text);

test("«velo fresco» y «Arsis» se corrigen en el dictado real", () => {
  assert.equal(
    fix("procedemos a instalar en el velo fresco la pieza un implante de 3,3 milímetros de ancho por 8 milímetros de largo de marca FGM Arsis"),
    "procedemos a instalar en el alvéolo fresco la pieza un implante de 3,3 milímetros de ancho por 8 milímetros de largo de marca FGM Arsis",
  );
});

test("variantes de alvéolo", () => {
  assert.match(fix("instalamos el implante a velo fresco"), /alvéolo fresco/);
  assert.match(fix("se rellena el velo post extracción con injerto"), /alvéolo post extracción/);
  assert.match(fix("curetaje del alveolo y sutura"), /alvéolo/);
  assert.match(fix("tres alveolos vacíos"), /alvéolos vacíos/);
});

test("«velo palatino» y «velo del paladar» no se tocan", () => {
  assert.equal(fix("sin hallazgos en el velo palatino"), "sin hallazgos en el velo palatino");
  assert.equal(fix("edema del velo del paladar"), "edema del velo del paladar");
});

test("«Arsis» se reconoce como la marca Arcsys y se pregunta, sin cambiarla en silencio", () => {
  assert.equal(findImplantBrand("Arsis")?.brand, "Arcsys");
  assert.equal(fix("implante de marca FGM Arsis"), "implante de marca FGM Arsis");
  const questions = aclaraciones("instalamos un implante de marca FGM Arsis en la pieza 8");
  assert.ok(questions.some((q) => /Arcsys/.test(q) && /Arsis/.test(q)));
  assert.deepEqual(aclaraciones("el señor Arsis llegó tarde").filter((q) => /Arcsys/.test(q)), []);
});

test("el prompt incluye la instrucción de cordura clínica con el caso y su excepción", () => {
  assert.match(DENTAL_DICTIONARY_HINTS, /CORDURA CLÍNICA/);
  assert.match(DENTAL_DICTIONARY_HINTS, /velo fresco/);
  assert.match(DENTAL_DICTIONARY_HINTS, /velo palatino/);
});
