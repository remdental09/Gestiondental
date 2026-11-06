import test from "node:test";
import assert from "node:assert/strict";
import { ICD11_CATALOG } from "../lib/icd11-catalog.ts";
import { diagnosisMatches } from "../lib/icd11.ts";

const fold = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const codes = (text) => diagnosisMatches(text).map((match) => match.code);
const say = (term) => `diagnóstico de ${term} en el paciente`;

test("el catálogo no repite códigos y suma los grupos maxilofaciales de la OMS", () => {
  const all = ICD11_CATALOG.map((entry) => entry.code);
  assert.equal(new Set(all).size, all.length);
  for (const group of ["Neoplasias bucales y maxilofaciales", "Fracturas y luxaciones maxilofaciales", "Fisuras y malformaciones craneofaciales"]) {
    assert.ok(ICD11_CATALOG.some((entry) => entry.group === group), group);
  }
});

test("cada término de una hoja nueva devuelve su propio código", () => {
  const groups = new Set(["Neoplasias bucales y maxilofaciales", "Fracturas y luxaciones maxilofaciales", "Fisuras y malformaciones craneofaciales"]);
  const failures = [];
  for (const entry of ICD11_CATALOG.filter((item) => groups.has(item.group) && item.isLeaf)) {
    for (const term of new Set([entry.title, ...entry.synonyms])) {
      if (!codes(say(term)).includes(entry.code)) failures.push(`${entry.code} «${term}»`);
    }
  }
  assert.deepEqual(failures, []);
});

test("los calificativos dictados en otro orden dan el mismo código", () => {
  const pairs = [
    ["periodontitis apical crónica", "periodontitis crónica apical", "DA09.71"],
    ["periodontitis apical aguda", "periodontitis aguda apical", "DA09.70"],
    ["periodontitis apical asintomática", "periodontitis asintomática apical", "DA09.71"],
    ["periodontitis apical sintomática", "periodontitis sintomática apical", "DA09.70"],
    ["absceso apical crónico", "absceso crónico apical", "DA09.61"],
    ["absceso apical agudo", "absceso agudo apical", "DA09.62"],
  ];
  for (const [a, b, code] of pairs) {
    assert.deepEqual(codes(say(a)), [code], a);
    assert.deepEqual(codes(say(b)), [code], b);
  }
});

test("permutar los calificativos de cualquier término del catálogo no cambia el código", () => {
  const QUAL = new Set(["cronico", "cronica", "agudo", "aguda", "apical", "periapical", "benigno", "benigna", "maligno", "maligna", "unilateral", "bilateral", "sintomatico", "sintomatica", "asintomatico", "asintomatica", "reversible", "irreversible", "superior", "inferior", "izquierdo", "izquierda", "derecho", "derecha"]);
  const failures = [];
  for (const entry of ICD11_CATALOG.filter((item) => item.kind === "stem" && item.isLeaf && item.code !== "DA08.0")) {
    for (const term of new Set([entry.title, ...entry.synonyms])) {
      const words = fold(term).split(/[^a-z0-9]+/).filter(Boolean);
      const [head, ...tail] = words;
      if (!head || tail.length < 2 || tail.length > 3 || !tail.every((word) => QUAL.has(word))) continue;
      const original = codes(say(term));
      if (!original.includes(entry.code)) continue; // términos que ya no se autoetiquetan por diseño
      const swapped = [head, ...tail.slice().reverse()].join(" ");
      if (!codes(say(swapped)).includes(entry.code)) failures.push(`${entry.code} «${swapped}»`);
    }
  }
  assert.deepEqual(failures, []);
});

test("diagnósticos de los grupos nuevos se reconocen con frases de consulta", () => {
  const cases = [
    ["carcinoma escamoso de lengua", "2B62.0"],
    ["carcinoma espinocelular de labio", "2B60.1"],
    ["carcinoma epidermoide del piso de la boca", "2B64.0"],
    ["cáncer de lengua", "2B62.Z"],
    ["fractura de mandíbula", "NA02.7Z"],
    ["fractura de ángulo mandibular", "NA02.74"],
    ["fractura condílea", "NA02.70"],
    ["fractura Le Fort II", "NA02.41"],
    ["fractura maxilar", "NA02.4Z"],
    ["fractura nasal", "NA02.3"],
    ["fractura del piso de la órbita", "NA02.21"],
    ["labio leporino", "LA40.Z"],
    ["paladar hendido", "LA42.Z"],
    ["úvula bífida", "LA42.2"],
    ["fisura labial bilateral", "LA40.1"],
  ];
  for (const [phrase, code] of cases) assert.deepEqual(codes(say(phrase)), [code], phrase);
});

test("no se rompen equivalencias previas ni se codifican tumores de otros órganos", () => {
  assert.deepEqual(codes("fisura labial"), ["DA00.3"]);
  assert.deepEqual(codes("periodontitis aguda"), ["DA0C.0"]);
  assert.deepEqual(codes("Le Fort I y Le Fort II").sort(), ["NA02.40", "NA02.41"]);
  for (const phrase of ["cáncer de estómago", "neoplasia benigna de amígdala", "carcinoma de colon"]) {
    assert.deepEqual(codes(say(phrase)), [], phrase);
  }
});

test("un hallazgo de granuloma sin diagnóstico no se codifica", () => {
  assert.deepEqual(codes("lesión apical con un granuloma en la radiografía"), []);
});
