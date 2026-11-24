import test from "node:test";
import assert from "node:assert/strict";
import { resolveDictatedSurfaces, structureTranscript } from "../lib/dictation/proposal.ts";

// Casos sintéticos basados en frases dictadas reales de la revisión de pacientes de simulación (sin datos de pacientes):
// «restauraciones clase V», «restauración clase I» y «caries cervicopalatina» no llegaban al odontograma.
const cambios = (texto) => structureTranscript(texto, { today: "2026-11-24" }).odontogram;

test("clase V sin caras nombradas se registra como vestibular, con aviso para corregir si fue lingual o palatina", () => {
  const { surfaces, notes } = resolveDictatedSurfaces("Se realizan restauraciones clase V con resina fluida color A2.", 17);
  assert.deepEqual(surfaces, ["V"]);
  assert.match(notes.join(" "), /clase V.*vestibular.*corr[ií]gelo/);
  for (const variante of ["clase 5", "Clase v", "quinta clase"]) assert.deepEqual(resolveDictatedSurfaces(`Restauración ${variante} con resina.`, 36).surfaces, ["V"], variante);
});

test("clase V en varias piezas genera una restauración vestibular por pieza", () => {
  const lista = cambios("Se realizan restauraciones clase V con resina fluida color A2 en las piezas 1.7 y 1.6.");
  assert.deepEqual(lista.map((c) => [c.tooth, c.kind, c.surface, c.finding?.condition]), [[17, "surface", "V", "restored"], [16, "surface", "V", "restored"]]);
});

test("clase I en un posterior es oclusal; en un anterior no se adivina", () => {
  assert.deepEqual(resolveDictatedSurfaces("Restauración clase I con resina.", 46).surfaces, ["O"]);
  assert.deepEqual(resolveDictatedSurfaces("Restauración clase 1 con resina.", 46).surfaces, ["O"]);
  assert.deepEqual(resolveDictatedSurfaces("Restauración clase I con resina.", 11).surfaces, []);
  const lista = cambios("Se realiza restauración clase I con resina en la pieza 4.6.");
  assert.deepEqual(lista.map((c) => [c.tooth, c.surface, c.finding?.condition]), [[46, "O", "restored"]]);
});

test("clase II, III, IV y VI no se adivinan (dependen de la cara proximal): no cambian el odontograma y se pregunta la cara", () => {
  for (const clase of ["II", "III", "IV", "VI", "2", "3"]) {
    assert.deepEqual(resolveDictatedSurfaces(`Restauración clase ${clase} con resina.`, 26).surfaces, [], clase);
  }
  const propuesta = structureTranscript("Se realiza restauración clase II con resina en la pieza 2.6.", { today: "2026-11-24" });
  assert.equal(propuesta.odontogram.length, 0);
  assert.match(JSON.stringify(propuesta.clarifications), /superficie/);
});

test("una cara nombrada manda sobre la clase: «clase V lingual» queda lingual, no vestibular", () => {
  assert.deepEqual(resolveDictatedSurfaces("Restauración clase V lingual con resina.", 36).surfaces, ["P"]);
  assert.deepEqual(resolveDictatedSurfaces("Restauración clase I cara oclusal con resina.", 36).surfaces, ["O"]);
});

test("«cervicopalatina», «cervicovestibular» y «cervicolingual» se leen como la cara que nombran", () => {
  assert.deepEqual(resolveDictatedSurfaces("Caries cervicopalatina.", 12).surfaces, ["P"]);
  assert.deepEqual(resolveDictatedSurfaces("Caries cervicovestibular.", 12).surfaces, ["V"]);
  assert.deepEqual(resolveDictatedSurfaces("Caries cervico-lingual.", 32).surfaces, ["P"]);
  const lista = cambios("Se observa caries cervicopalatina en la pieza 1.2.");
  assert.deepEqual(lista.map((c) => [c.tooth, c.surface, c.finding?.condition, c.finding?.depth]), [[12, "P", "caries", null]]);
});

test("lo que ya funcionaba no cambia: caras con letras, nombres completos y exodoncia", () => {
  assert.deepEqual(resolveDictatedSurfaces("Obturación MOD con resina.", 16).surfaces, ["M", "O", "D"]);
  assert.deepEqual(resolveDictatedSurfaces("Obturación mesio-oclusal.", 16).surfaces, ["M", "O"]);
  assert.deepEqual(cambios("Se realiza exodoncia de las piezas 3.4 y 3.5.").map((c) => [c.tooth, c.status]), [[34, "Ausente"], [35, "Ausente"]]);
});
