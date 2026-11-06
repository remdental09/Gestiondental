import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript, mergeProposals, cariesDiagnoses } from "../lib/dictation/proposal.ts";

const text = "Caries de esmalte en la pieza catorce, cara oclusal. Se realiza restauración con resina compuesta oclusal.";
const local = async () => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;

test("caries dictada y restaurada en la misma cara: queda restaurada, sin conflicto, y la caries sigue como diagnóstico", async () => {
  const base = await local();
  const restored = base.odontogram.find((i) => i.finding?.condition === "restored");
  assert.ok(restored, "las reglas proponen la restauración");
  const caries = { ...restored, id: "ai-1", origin: "ia", sourceText: "Caries de esmalte en la pieza catorce, cara oclusal.", finding: { condition: "caries", depth: "esmalte", icdas: null, activity: null } };
  const ai = { noteBody: "", odontogram: [caries], incomplete: [], budget: [], ficha: [], procedures: [], clarifications: [], rejected: [], perio: [], perioPending: [], payments: [], appointments: [], diagnoses: [] };
  const merged = mergeProposals(ai, { ...base, odontogram: [restored] }, text);
  const onSurface = merged.odontogram.filter((i) => i.tooth === restored.tooth && i.surface === restored.surface);
  assert.equal(onSurface.length, 1);
  assert.equal(onSurface[0].finding.condition, "restored");
  assert.ok(!onSurface[0].conflict);
  assert.ok(!merged.clarifications.some((c) => /no coinciden/.test(c)));
  const dx = cariesDiagnoses(merged.odontogram);
  assert.ok(dx.some((d) => d.code.startsWith("DA08.0")), "el diagnóstico de caries se conserva");
});
