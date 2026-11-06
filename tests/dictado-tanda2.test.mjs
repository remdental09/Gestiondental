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

test("sondaje con sitios compuestos y profundidades sin unidad: una lectura por sitio", async () => {
  const proposal = await quick("Sondaje pieza 3.7 mesiovestibular 4 milímetros con sangrado, vestibular 3, distovestibular 5 con supuración.");
  assert.deepEqual(proposal.perio.map((item) => [item.tooth, item.site, item.depth, item.bleeding, item.suppuration]), [[37, "MV", 4, true, false], [37, "V", 3, false, false], [37, "DV", 5, false, true]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("«Se restaura con resina compuesta» sin cara usa la cara recién dictada de esa pieza", async () => {
  const proposal = await quick("Caries de dentina profunda en oclusal de la pieza 3.7. Se restaura con resina compuesta.");
  const restored = proposal.odontogram.filter((item) => item.tooth === 37 && item.surface === "O" && item.finding?.condition === "restored");
  assert.equal(restored.length, 1);
  assert.ok(!proposal.clarifications.some((text) => /Falta la superficie/.test(text)));
});

const planOnly = async (text) => (await quick(text));

test("«Plan de tratamiento» no marca el odontograma como hecho (obturación, corona, implante)", async () => {
  const a = await planOnly("Se observa caries de dentina profunda en la cara oclusal de la pieza 4.6. Plan de tratamiento: obturación con resina compuesta oclusal de la 4.6. Presupuesto: obturación con resina compuesta, cincuenta y cinco mil pesos.");
  assert.ok(!a.odontogram.some((item) => item.finding?.condition === "restored"), "la obturación planificada no queda restaurada");
  assert.ok(a.odontogram.some((item) => item.finding?.condition === "caries"), "la caries sí se registra");
  const b = await planOnly("Plan de tratamiento en dos fases. Fase uno: endodoncia en la 3.6. Fase dos: reconstrucción con muñón y corona metal cerámica en la 3.6, trescientos veinte mil pesos.");
  assert.ok(!b.odontogram.some((item) => item.kind === "crown" || item.status === "Corona"));
  const c = await planOnly("Pieza 2.4 ausente. Plan opción A: implante unitario en la 2.4, seiscientos cincuenta mil pesos, y corona sobre implante, trescientos cincuenta mil pesos.");
  assert.deepEqual(c.odontogram.map((item) => [item.tooth, item.status ?? item.kind]), [[24, "Ausente"]]);
});

test("«se evalúa implante o puente, a decidir» no marca implante", async () => {
  const proposal = await planOnly("Pieza 3.5 con resto radicular. Luego se evalúa implante o puente, a decidir con el paciente.");
  assert.ok(!proposal.odontogram.some((item) => item.status === "Implante"));
});

test("lo realizado después del plan sí se registra", async () => {
  const proposal = await planOnly("Plan de tratamiento: exodoncia de la 4.8. Se realiza exodoncia de la pieza 4.8 sin complicaciones.");
  assert.ok(proposal.odontogram.some((item) => item.tooth === 48 && item.status === "Ausente"));
});

test("la prestación del presupuesto no arrastra el monto dicho en palabras ni el número de pieza partido", async () => {
  const proposal = await planOnly("Presupuesto de exodoncia simple de la pieza 3.8 por cuarenta mil pesos.");
  const item = proposal.budget[0];
  assert.ok(item);
  assert.equal(item.amount, 40000);
  assert.ok(!/cuarenta|mil|\b3 8\b/i.test(item.label), item.label);
  assert.equal(item.catalogCode, "5003001");
});

test("montos dictados en palabras se usan en el presupuesto de la IA", async () => {
  const { spokenAmounts } = await import("../lib/dictation/spoken.ts");
  assert.deepEqual(spokenAmounts("ciento ochenta mil pesos").map((a) => a.value), [180000]);
});

test("«Ausencia del 2.4» marca la pieza ausente y «ausencia de sangrado» no", async () => {
  const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
  const a = await run("Ausencia del 2.4. Plan de tratamiento opción A: implante con corona en el 2.4, novecientos mil pesos.");
  assert.deepEqual(a.odontogram.map((o) => [o.tooth, o.status]), [[24, "Ausente"]]);
  const b = await run("Ausencia de sangrado al sondaje.");
  assert.equal(b.odontogram.length, 0);
});

test("gingivitis generalizada asociada a placa se propone como diagnóstico sin código", async () => {
  const p = (await proposeFromTranscript({ transcript: "Gingivitis generalizada asociada a placa. Plan de tratamiento: profilaxis dental.", chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
  assert.ok(p.diagnoses.some((d) => /Gingivitis inducida por placa/.test(d.title) && !d.code));
});
