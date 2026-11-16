import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript, lesionStatusesFrom } from "../lib/dictation/proposal.ts";
import { wrongNumberingClaim, parseReviewExtras } from "../lib/dictation/clinical-review.ts";
import { suggestPrestaciones } from "../lib/dictation/prestaciones.ts";

const rules = async (transcript, chart = []) => (await proposeFromTranscript({ transcript, chart }, null, () => {}, { today: "2026-11-16" })).proposal;

test("tras «punto aparte» la pieza nombrada sigue valiendo para las frases siguientes", async () => {
  const p = await rules("Pieza 1.6: caries de esmalte en oclusal punto aparte. Caries de dentina superficial en mesial, distal y vestibular punto aparte. Obturación de resina en oclusal. Sellante en palatino punto aparte. Fisura coronaria y fractura de esmalte.");
  assert.ok(p.odontogram.every((item) => item.tooth === 16));
  assert.deepEqual(p.clarifications.filter((c) => /Falta una pieza/.test(c)), []);
  const statuses = p.odontogram.filter((item) => item.kind === "status").map((item) => item.status).sort();
  assert.deepEqual(statuses, ["Fisura coronaria", "Fractura coronaria de esmalte"]);
  assert.ok(p.odontogram.some((item) => item.surface === "P" && item.finding?.condition === "sealant"));
});

test("una frase con dos lesiones las registra ambas", () => {
  assert.deepEqual(lesionStatusesFrom("Fisura coronaria y fractura de esmalte."), ["Fisura coronaria", "Fractura coronaria de esmalte"]);
  assert.deepEqual(lesionStatusesFrom("Absceso apical crónico con fístula."), ["Absceso apical crónico (fístula)"]);
  assert.deepEqual(lesionStatusesFrom("Sin fisura coronaria."), []);
});

test("el revisor no puede objetar una equivalencia chilena correcta", () => {
  assert.equal(wrongNumberingClaim("La equivalencia consignada «FDI 2.6 (Chile 14)» es incorrecta: la numeración universal 14 corresponde a FDI 1.4."), true);
  assert.equal(wrongNumberingClaim("La equivalencia «FDI 2.6 (Chile 13)» es incorrecta."), false);
  assert.deepEqual(parseReviewExtras({ nota: [{ motivo: "La equivalencia consignada «FDI 2.6 (Chile 14)» es incorrecta." }, { motivo: "La nota omite la pieza 4.6." }] }, []).nota, ["La nota omite la pieza 4.6."]);
});

test("obturación o sellante sin verbo de hoy se proponen desmarcados; con «se realiza» quedan marcados", () => {
  const odo = [{ id: "a", tooth: 16, kind: "surface", surface: "O", finding: { condition: "restored" }, sourceText: "Obturación de resina en oclusal.", numbering: "fdi", numberingLabel: "" }];
  const dudosa = suggestPrestaciones(odo, ["Obturación de resina en oclusal de la pieza 1.6."], [], "Pieza 1.6: obturación de resina en oclusal.");
  assert.ok(dudosa.length >= 1 && dudosa.every((item) => item.advisory));
  const hecha = suggestPrestaciones(odo, ["Se realiza obturación de resina en oclusal de la pieza 1.6."], [], "Pieza 1.6: se realiza obturación de resina en oclusal.");
  assert.ok(hecha.length >= 1 && hecha.every((item) => !item.advisory));
});
