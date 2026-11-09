import test from "node:test";
import assert from "node:assert/strict";
import { applyLexicon } from "../lib/dictation/spoken.ts";
import { DENTAL_DICTIONARY_HINTS } from "../lib/dictation/dental-lexicon.ts";

const fix = (text) => applyLexicon(text).text;

test("incisión semilunar mal oída se corrige solo junto a incisión o colgajo", () => {
  for (const heard of ["una incisión seminueva", "una incisión semi nueva", "una incisión semi humana", "incisión semi lunar", "incisión semilunal", "colgajo semilunas"]) {
    assert.match(fix(heard), /(incisión|colgajo) semilunar/, heard);
  }
  assert.equal(fix("el paciente compró una mochila seminueva"), "el paciente compró una mochila seminueva");
});

test("Neumann, Partsch, intrasurcular, crestal, festoneada y Ochsenbein-Luebke", () => {
  assert.equal(fix("incisión de Newman modificada"), "incisión de Neumann modificada");
  assert.equal(fix("incisión de nueva man"), "incisión de Neumann");
  assert.equal(fix("incisión de Parch"), "incisión de Partsch");
  assert.equal(fix("incisión intra circular"), "incisión intrasurcular");
  assert.equal(fix("incisión supra cristal"), "incisión supra crestal");
  assert.equal(fix("incisión cristal con descargas"), "incisión crestal con descargas");
  assert.equal(fix("incisión festonada"), "incisión festoneada");
  assert.equal(fix("colgajo de Oxenbein Luque"), "colgajo de Ochsenbein-Luebke");
});

test("el modelo recibe la lista de incisiones y sus errores frecuentes", () => {
  assert.match(DENTAL_DICTIONARY_HINTS, /incisión de Partsch/);
  assert.match(DENTAL_DICTIONARY_HINTS, /«seminueva».*«semilunar»/);
});

test("cirugía de implante: errores de voz del dictado real se corrigen con código", () => {
  const heard = "una descarga de human parcial hacia el diente 4.3, y otra descarga pasando por la encía herida, con cuatro tubos de anestesia de lidocaina. Quedó a 45 newton centímetro cuadrado, cierre con sutura bicril.";
  const out = applyLexicon(heard).text;
  assert.match(out, /descarga de Neumann parcial/);
  assert.match(out, /encía adherida/);
  assert.match(out, /cuatro tubos de anestesia/);
  assert.match(out, /45 N·cm/);
  assert.match(out, /sutura Vicryl/);
});

test("«encía herida» sin incisión ni colgajo se conserva (puede ser una herida real)", () => {
  assert.equal(applyLexicon("Paciente con la encía herida por un cepillo duro.").text, "Paciente con la encía herida por un cepillo duro.");
  assert.equal(applyLexicon("Se usaron dos tubos de anestesia.").text, "Se usaron dos tubos de anestesia.");
});
