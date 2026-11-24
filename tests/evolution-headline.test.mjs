import test from "node:test";
import assert from "node:assert/strict";
import { evolutionHeadline, zoneOfPiece } from "../lib/evolution-headline.ts";

const note = body => ({ title: "Atención", body });

test("titular: lo realizado, sin el verbo de apertura ni la anestesia", () => {
  const headline = evolutionHeadline(note("Procedimientos realizados\nSe administra anestesia local. Se realiza restauración de composite en la cara palatina de la pieza 10."));
  assert.equal(headline, "Restauración de composite en la cara palatina de la pieza 10");
});

test("titular: si no hay procedimientos usa las prestaciones, sin código ni FDI", () => {
  const headline = evolutionHeadline(note("Prestaciones (arancel)\n5005017 · Composite fotocurado simple posterior (FDI 1.6)\n5012021 · Higiene bucal - destartraje\n5012012 · Enseñanza de técnica de cepillado"));
  assert.equal(headline, "Composite fotocurado simple posterior + Higiene bucal - destartraje +1 más");
});

test("titular: una evaluación solo con plan no parece un procedimiento hecho", () => {
  const headline = evolutionHeadline(note("Examen\nFractura de cúspide.\nProcedimientos realizados\nNo se realizan procedimientos en la atención de hoy.\nPlan de tratamiento\nSe planifica realizar un onlay cerámico en la pieza 4.6."));
  assert.equal(headline, "Evaluación y plan: onlay cerámico en la pieza 4.6");
});

test("titular: solo examen o diagnóstico queda como evaluación y no inventa nada", () => {
  assert.equal(evolutionHeadline(note("Examen\nSe constata ausencia de piezas.\nDiagnóstico\nPeriodontitis apical crónica.")), "Evaluación / examen");
});

test("titular: texto libre usa la primera frase y respeta el largo", () => {
  assert.equal(evolutionHeadline(note("destartraje boca completa")), "destartraje boca completa");
  const long = evolutionHeadline(note(`Procedimientos realizados\nSe realiza ${"obturación extensa con técnica incremental ".repeat(6)}.`));
  assert.ok(long.length <= 90, long);
  assert.ok(long.endsWith("…"));
});

test("zona de una línea por pieza", () => {
  assert.equal(zoneOfPiece("1.2 Resina"), "1.2");
  assert.equal(zoneOfPiece("Boca completa Pulido"), "Boca completa");
  assert.equal(zoneOfPiece("6 sextantes Hoy vino"), "6 sextantes");
  assert.equal(zoneOfPiece("texto suelto"), "");
});
