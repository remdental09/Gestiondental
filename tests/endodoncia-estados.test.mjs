import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript, endoStatusFrom } from "../lib/dictation/proposal.ts";
import { applyToothStatus, applyStatusToChart, pruneChartExtras, lesionEffect } from "../lib/tooth-status.ts";

const statuses = (text) => structureTranscript(text, { today: "2026-11-24" }).odontogram.filter((i) => i.kind === "status").map((i) => [i.tooth, i.status]);

test("pieza abierta o trepanada queda «Endodoncia en proceso»", () => {
  for (const text of ["Pieza 14: trepanación y conductometría, se deja con curación intraconducto.", "Pieza 14, apertura cameral y pulpectomía, queda abierta.", "Pieza 14 con endodoncia en curso."]) {
    assert.deepEqual(statuses(text), [[26, "Endodoncia en proceso"]], text);
  }
});

test("conductos obturados o endodoncia terminada queda «Endodoncia terminada»", () => {
  for (const text of ["Pieza 14: obturación de conductos con gutapercha.", "Pieza 14, se termina la endodoncia.", "Pieza 14 con endodoncia previa."]) {
    assert.deepEqual(statuses(text), [[26, "Endodoncia terminada"]], text);
  }
});

test("si se dicta todo el recorrido en una frase gana «terminada»", () => {
  assert.equal(endoStatusFrom("Trepanación, instrumentación de los conductos y obturación de conductos."), "Endodoncia terminada");
});

test("plan, negación y relato no cambian el estado", () => {
  for (const text of ["Plan: endodoncia en la pieza 14.", "Pieza 14 sin endodoncia.", "Pieza 14, el paciente refiere que le hicieron una trepanación."]) {
    assert.deepEqual(statuses(text), [], text);
  }
});

test("instrumentación periodontal no es endodoncia", () => {
  assert.equal(endoStatusFrom("Instrumentación periodontal en el sector 3."), null);
});

test("en proceso → terminada se reemplaza y convive con corona y lesión apical", () => {
  let state = applyToothStatus({ extras: [] }, "Corona");
  state = applyToothStatus(state, "Endodoncia en proceso");
  state = applyToothStatus(state, "Periodontitis apical");
  assert.deepEqual(state, { primary: "Corona", extras: ["Endodoncia en proceso", "Periodontitis apical"] });
  assert.deepEqual(lesionEffect(state, "Endodoncia terminada"), { kind: "reemplaza", replaced: "Endodoncia en proceso" });
  state = applyToothStatus(state, "Endodoncia terminada");
  assert.deepEqual(state.extras, ["Periodontitis apical", "Endodoncia terminada"]);
});

test("la extracción limpia la endodoncia y prune deja solo la vigente", () => {
  const chart = { teeth: { 26: "Corona" }, extras: { 26: ["Endodoncia en proceso", "Endodoncia terminada"] } };
  pruneChartExtras(chart);
  assert.deepEqual(chart.extras[26], ["Endodoncia terminada"]);
  applyStatusToChart(chart, 26, "Ausente");
  assert.equal(chart.extras?.[26], undefined);
});
