import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const quick = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
const surfaces = (proposal) => proposal.odontogram.map((item) => [item.tooth, item.surface, item.finding?.condition]);

test("«la 37» sin la palabra pieza se lee como FDI 3.7 cuando no puede ser un día del mes", async () => {
  const proposal = await quick("Caries de dentina profunda en oclusal de la 37.");
  assert.deepEqual(surfaces(proposal), [[37, "O", "caries"]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("una fecha («el 15 de noviembre») no se toma por pieza", async () => {
  const proposal = await quick("Control el 36 de noviembre y el 15 de noviembre.");
  assert.equal(proposal.odontogram.length, 0);
  assert.ok(!proposal.clarifications.some((text) => /pieza/i.test(text)));
});

test("«las piezas 1.6 y 2.6» marca el sellante en ambas piezas, cara oclusal", async () => {
  const proposal = await quick("Se aplica sellante de fosas y fisuras en las piezas 1.6 y 2.6.");
  assert.deepEqual(surfaces(proposal).sort(), [[16, "O", "sealant"], [26, "O", "sealant"]]);
});

test("el sellante de fosas y fisuras en una pieza deja la cara oclusal sin preguntar", async () => {
  const proposal = await quick("Se aplica sellante de fosas y fisuras en la pieza 1.6.");
  assert.deepEqual(surfaces(proposal), [[16, "O", "sealant"]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("la fractura coronaria toma la pieza de su frase aunque el corte la deje en otra cláusula", async () => {
  const proposal = await quick("Fractura coronaria complicada de la pieza 1.1 con exposición pulpar.");
  const fracture = proposal.diagnoses.find((item) => item.code.startsWith("NA0D"));
  assert.ok(fracture);
  assert.equal(fracture.tooth, 11);
});

test("«tercer molar inferior derecho 48 incluido» vincula el diagnóstico a la pieza 4.8", async () => {
  const proposal = await quick("Cirugía de tercer molar inferior derecho 48 incluido, osteotomía y odontosección.");
  const retained = proposal.diagnoses.find((item) => item.code === "DA07.7");
  assert.ok(retained);
  assert.equal(retained.tooth, 48);
});

test("«Exodoncia de la pieza 8.4» sin verbo pregunta si se hizo y no cambia el estado", async () => {
  const proposal = await quick("Exodoncia de la pieza 8.4 por movilidad fisiológica, sin complicaciones.");
  assert.equal(proposal.odontogram.length, 0);
  assert.ok(proposal.clarifications.some((text) => /ya se realiz/.test(text)));
});

test("«Se realiza exodoncia de la pieza 8.4» sí la deja ausente y no pregunta", async () => {
  const proposal = await quick("Se realiza exodoncia de la pieza 8.4.");
  assert.deepEqual(proposal.odontogram.map((item) => [item.tooth, item.status]), [[84, "Ausente"]]);
  assert.ok(!proposal.clarifications.some((text) => /ya se realiz/.test(text)));
});

test("un diagnóstico dictado para dos piezas en la misma frase se registra en cada una", async () => {
  const proposal = await quick("Abfracción en las piezas 1.3 y 2.3.");
  const teeth = proposal.diagnoses.filter((item) => item.code).map((item) => item.tooth).sort();
  assert.deepEqual(teeth, [13, 23]);
});
