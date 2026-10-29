import test from "node:test";
import assert from "node:assert/strict";
import { cementedCrownFromEvolution } from "../app/crown-evidence.ts";

test("cemented definitive crown on Chilean tooth 12 is FDI 2.4 with material and shade", () => {
  const note = "Pieza 12: fractura distal. Se confecciona una prótesis fija provisoria y una prótesis fija definitiva de zirconio, color A3.5. Se cementa con ionómero. Restauración completada.";
  assert.deepEqual(cementedCrownFromEvolution(note), { tooth: 24, material: "Zirconio", shade: "A3.5" });
});
test("an explicitly labeled FDI 1.2 is not Chilean tooth 12", () => {
  assert.deepEqual(cementedCrownFromEvolution("Pieza FDI 1.2: corona de disilicato. Se cementó."), { tooth: 12, material: "Disilicato", shade: null });
});
test("proposed, provisional, negated, or multi-tooth work is not projected", () => {
  for (const note of [
    "Pieza 12: se planifica corona definitiva de zirconio.",
    "Pieza 12: corona provisoria de resina. Se cementa.",
    "Pieza 12: corona definitiva de zirconio. No se cementó.",
    "Pieza 12 y pieza 13: coronas definitivas de zirconio. Se cementa."
  ]) assert.equal(cementedCrownFromEvolution(note), null);
});
