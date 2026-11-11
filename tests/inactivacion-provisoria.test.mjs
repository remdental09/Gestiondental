import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript, planChartWrites } from "../lib/dictation/proposal.ts";
import { cariesDetail } from "../lib/caries.ts";

const empty = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {} };
const surfaceOf = (text) => structureTranscript(text).odontogram.filter((item) => item.kind === "surface");

test("caries inactivada con vidrio ionómero provisorio guarda el material y sigue siendo caries", () => {
  const items = surfaceOf("Pieza 1.6 mesial y oclusal caries inactivada con vidrio ionómero provisorio.");
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.finding.condition, "caries");
    assert.equal(item.finding.activity, "inactive");
    assert.equal(item.finding.restorationMaterial, "Vidrio ionómero");
    assert.equal(item.finding.restorationStage, "provisional");
  }
});

test("el eugenato se reconoce como material provisorio (también «para inactivar»)", () => {
  for (const text of ["Se inactiva caries en 3.6 oclusal con eugenato.", "Pieza 3.6 oclusal, se coloca eugenato para inactivar la caries.", "3.6 oclusal caries inactiva con óxido de zinc eugenol."]) {
    const [item] = surfaceOf(text);
    assert.equal(item.finding.condition, "caries", text);
    assert.equal(item.finding.activity, "inactive", text);
    assert.equal(item.finding.restorationMaterial, "Eugenato", text);
    assert.equal(item.finding.restorationStage, "provisional", text);
  }
});

test("el historial de la pieza dice qué se hizo con la caries y guarda la cita", () => {
  const [item] = surfaceOf("Se inactiva caries en 3.6 oclusal con eugenato.");
  const after = { ...empty, surfaces: { 36: { O: item.finding } } };
  const actions = planChartWrites(1, empty, after, [item]);
  const write = actions.find((action) => action.action === "setToothSurface");
  assert.match(write.historyTitle, /^Caries inactivada con eugenato provisorio · /);
  assert.match(write.historyDetail ?? "", /eugenato/i);
  assert.equal(write.finding.restorationMaterial, "Eugenato");
});

test("una caries inactivada sin material no inventa uno, y una obturación común no cambia", () => {
  const [plain] = surfaceOf("Pieza 3.6 oclusal caries inactiva.");
  assert.equal(plain.finding.activity, "inactive");
  assert.equal(plain.finding.restorationMaterial ?? null, null);
  const [filled] = surfaceOf("Pieza 3.6 oclusal obturación con resina.");
  assert.equal(filled.finding.condition, "restored");
});

test("el texto de la cara muestra el material provisorio de la caries inactiva", () => {
  const detail = cariesDetail({ condition: "caries", depth: "dentina_superficial", icdas: null, activity: "inactive", restorationStage: "provisional", restorationMaterial: "Vidrio ionómero" });
  assert.match(detail, /inactiva con vidrio ionómero provisorio/);
});

test("«Pieza 1.6 oclusal obturación con resina compuesta por caries» queda como obturación (la caries es el motivo)", () => {
  const [item] = surfaceOf("Pieza 1.6 oclusal obturación con resina compuesta por caries de dentina.");
  assert.equal(item?.tooth, 16);
  assert.equal(item?.surface, "O");
  assert.equal(item?.finding.condition, "restored");
});
