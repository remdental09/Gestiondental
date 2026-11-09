import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { clinicalCoherence, parseReview, applyAiReview } from "../lib/dictation/clinical-review.ts";

const item = (tooth, patch = {}) => ({ id: `o${tooth}`, tooth, numbering: "fdi", numberingLabel: "", sourceText: "", kind: "status", ...patch });
const sentencesFor = (text) => (tooth) => text.split(/(?<=\.)\s+/).filter((s) => s.includes(String(tooth === 45 ? 20 : tooth === 46 ? 19 : tooth)));

test("capa 1: trepanar una pieza natural no puede dejarla como implante", () => {
  const text = "Se realiza trepanación de la pieza 20 por pulpitis. Tiene corona de circonio.";
  const { odontogram, notes } = clinicalCoherence([item(45, { status: "Implante" })], [{ tooth: 45, status: "Corona" }], sentencesFor(text));
  assert.match(odontogram[0].advisory, /Incoherencia clínica · FDI 4\.5/);
  assert.equal(odontogram[0].coherence, "incoherente");
  assert.match(odontogram[0].advisory, /no tiene pulpa/);
  assert.equal(notes.length, 1);
});

test("capa 1: corona sobre diente natural → implante sin instalación se marca; con instalación no", () => {
  const sin = clinicalCoherence([item(46, { status: "Implante" })], [{ tooth: 46, status: "Corona" }], () => ["Control de la pieza 19."]);
  assert.ok(sin.odontogram[0].advisory);
  const con = clinicalCoherence([item(46, { status: "Implante" })], [{ tooth: 46, status: "Ausente" }], () => ["Se instala un implante en la pieza 19."]);
  assert.equal(con.odontogram[0].advisory, undefined);
  const ok = clinicalCoherence([item(46, { status: "Implante" })], [{ tooth: 46, status: "Corona" }], () => ["Se extrae la pieza 19 y se instala un implante inmediato."]);
  assert.equal(ok.odontogram[0].advisory, undefined);
});

test("capa 1: una pieza ausente no se trata", () => {
  const r = clinicalCoherence([item(16, { status: "Ausente" })], [], () => ["Endodoncia de la pieza 1.6, conducto mesial."]);
  assert.match(r.odontogram[0].advisory, /ausente/);
});

test("capa 2: se interpretan solo observaciones sobre cambios propuestos", () => {
  const odo = [item(45, { status: "Implante" })];
  const obs = parseReview(JSON.stringify({ observaciones: [{ pieza: "4.5", estado: "Implante", motivo: "Se trepana: no puede ser implante." }, { pieza: "2.2", motivo: "otra pieza sin cambio propuesto" }, { pieza: "9.9", motivo: "no existe esa pieza válida" }] }), odo);
  assert.equal(obs.length, 1);
  const applied = applyAiReview(odo, obs);
  assert.match(applied.odontogram[0].advisory, /Revisión clínica \(IA\)/);
  assert.deepEqual(parseReview("no es json", odo), []);
});

test("capa 2 integrada: el revisor marca un cambio y si falla la propuesta sigue", async () => {
  const dictado = "Caries de dentina profunda en oclusal de la pieza 1.6.";
  const base = { id: "t", model: "test", complete: async () => ({ usedModel: "test", output: { nota: { motivo: "Control.", examen: "Caries de dentina profunda en la pieza 1.6." }, texto_corregido: "Caries de dentina profunda en oclusal de la pieza 1.6.", hallazgos: [], periodonto: [], procedimientos: [], diagnosticos: [] } }) };
  const flagged = (await proposeFromTranscript({ transcript: dictado, chart: [] }, { ...base, review: async () => ({ observaciones: [{ pieza: "1.6", motivo: "Esta caries no concuerda con el odontograma." }] }) }, () => {}, { today: "2026-11-09" })).proposal;
  assert.ok(flagged.odontogram.length > 0);
  assert.match(flagged.odontogram[0].advisory ?? "", /Revisión clínica \(IA\)/);
  assert.ok(flagged.clarifications.some((c) => /Revisión clínica \(IA\)/.test(c)));
  const failed = (await proposeFromTranscript({ transcript: dictado, chart: [] }, { ...base, review: async () => { throw new Error("caído"); } }, () => {}, { today: "2026-11-09" })).proposal;
  assert.ok(failed.odontogram.length > 0);
  assert.equal(failed.odontogram[0].advisory, undefined);
});

test("caso Lorna: trepanación + corona + «adyacente al implante de la 19» no cambia la 4.5", async () => {
  const dictado = "Se realiza trepanación de la pieza 20, con pulpitis. La pieza 20 presenta corona de circonio. La pieza 20 se encuentra adyacente al implante de la pieza 19 y la pieza 21 se observa sana.";
  const p = (await proposeFromTranscript({ transcript: dictado, chart: [{ tooth: 45, status: "Corona" }] }, null, () => {}, { today: "2026-11-09" })).proposal;
  const implant45 = p.odontogram.filter((i) => i.tooth === 45 && (i.status === "Implante" || i.foundation === "implant") && !i.advisory);
  assert.equal(implant45.length, 0);
});
