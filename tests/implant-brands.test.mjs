import test from "node:test";
import assert from "node:assert/strict";
import { IMPLANT_BRANDS, IMPLANT_BRAND_TERMS, findImplantBrand } from "../lib/dictation/implant-brands.ts";
import { DENTAL_DICTIONARY, DENTAL_DICTIONARY_HINTS, DENTAL_SPEECH_HINTS, DENTAL_PROTECTED_WORDS } from "../lib/dictation/dental-lexicon.ts";

test("el catálogo de marcas cubre Europa, Estados Unidos, Brasil y Asia sin repetir marcas", () => {
  assert.ok(IMPLANT_BRANDS.length >= 75);
  const names = IMPLANT_BRANDS.map((item) => item.brand.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const brand of ["Straumann", "Nobel Biocare", "Neodent", "Osstem", "MegaGen", "Zimmer Biomet", "Conexão", "Hiossen", "MIS", "Camlog"]) assert.ok(names.includes(brand.toLowerCase()), brand);
  for (const region of ["Suiza", "Alemania", "España", "Estados Unidos", "Brasil", "Corea del Sur", "Israel", "Japón"]) assert.ok(IMPLANT_BRANDS.some((item) => item.region === region), region);
});

test("las marcas llegan al diccionario, a las pistas de voz y a las palabras protegidas", () => {
  assert.ok(DENTAL_DICTIONARY.marcas_y_empresas_de_implantes.includes("Straumann"));
  assert.match(DENTAL_DICTIONARY_HINTS, /Marcas y empresas de implantes/);
  assert.ok(DENTAL_SPEECH_HINTS.some((hint) => hint.phrase === "Neodent"));
  assert.ok(DENTAL_PROTECTED_WORDS.has("straumann"));
  assert.ok(IMPLANT_BRAND_TERMS.includes("Osstem Implant"));
});

test("findImplantBrand reconoce la marca dictada, con alias y sin tildes", () => {
  assert.equal(findImplantBrand("Se instala un implante Neodent Helix de 4 por 10")?.brand, "Neodent");
  assert.equal(findImplantBrand("implante conexao cone morse")?.company, "Conexão Sistemas de Prótese");
  assert.equal(findImplantBrand("implante Arxis ET de la empresa FSM")?.brand, "Arcsys");
  assert.equal(findImplantBrand("implante Arcsys")?.company, "FGM Produtos Odontológicos");
  assert.equal(findImplantBrand("implante de una marca desconocida"), null);
});
