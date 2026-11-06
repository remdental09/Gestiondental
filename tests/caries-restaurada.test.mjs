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

const quick = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;

test("dientes temporales dictados en palabras (cincuenta y cinco, sesenta y cinco)", async () => {
  const p = await quick("Pieza sesenta y cinco, se coloca sellante de fosas y fisuras en oclusal.");
  assert.equal(p.odontogram.length, 1);
  assert.equal(p.odontogram[0].tooth, 65);
  assert.equal(p.odontogram[0].finding.condition, "sealant");
});

test("«fosas y fisuras» no se confunde con una fisura dentaria", async () => {
  const p = await quick("Pieza 16, se coloca sellante de fosas y fisuras en oclusal.");
  assert.equal(p.odontogram[0]?.surface, "O");
  assert.ok(!p.clarifications.some((c) => /Falta la superficie/.test(c)));
});

test("exodoncia realizada deja la pieza ausente; planificada o indicada no", async () => {
  assert.equal((await quick("Se realiza exodoncia de la pieza 3.8.")).odontogram[0]?.status, "Ausente");
  assert.equal((await quick("Se extrae la pieza 3.6 por caries.")).odontogram[0]?.status, "Ausente");
  assert.equal((await quick("Se planifica exodoncia de la pieza 3.8.")).odontogram.length, 0);
  assert.equal((await quick("Se indica exodoncia de la pieza 3.8.")).odontogram[0]?.status, "Indicación de exodoncia");
});

test("varias mediciones de sondaje en una frase dan una lectura por sitio", async () => {
  const p = await quick("Sondaje en la pieza tres seis, mesiovestibular cinco milímetros con sangrado, distovestibular seis milímetros con sangrado.");
  assert.deepEqual(p.perio.map((item) => [item.site, item.depth, item.bleeding]), [["MV", 5, true], ["DV", 6, true]]);
  assert.equal((p.perioPending ?? []).length, 0);
});
