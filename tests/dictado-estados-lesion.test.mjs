import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript, TOOTH_STATUSES, lesionStatusFrom } from "../lib/dictation/proposal.ts";
import { APICAL_STATUSES, FRACTURE_STATUSES } from "../lib/tooth-status.ts";

const run = (text) => structureTranscript(text, { today: "2026-11-13" });
const statuses = (text) => run(text).odontogram.filter(item => item.kind === "status").map(item => [item.tooth, item.status]);

test("los 13 estados de lesiones y fracturas son estados válidos del dictado", () => {
  for (const status of [...APICAL_STATUSES, ...FRACTURE_STATUSES]) assert.ok(TOOTH_STATUSES.includes(status), status);
  assert.equal(TOOTH_STATUSES.length, 7 + 13);
});

test("cada lesión dictada con su nombre propone su estado (Chile 14 = FDI 2.6)", () => {
  const cases = [
    ["Pieza 14 con periodontitis apical sintomática.", "Periodontitis apical"],
    ["Pieza 14 con absceso apical agudo.", "Absceso apical agudo"],
    ["Pieza 14 con absceso apical crónico.", "Absceso apical crónico (fístula)"],
    ["Pieza 14 con fístula.", "Absceso apical crónico (fístula)"],
    ["Pieza 14 con granuloma apical.", "Granuloma apical"],
    ["Pieza 14 con quiste radicular.", "Quiste radicular"],
    ["Pieza 14 con osteítis condensante.", "Osteítis condensante"],
    ["Pieza 14 con fisura coronaria.", "Fisura coronaria"],
    ["Pieza 14 con fractura coronaria no complicada de esmalte.", "Fractura coronaria de esmalte"],
    ["Pieza 14 con fractura coronaria con dentina expuesta.", "Fractura coronaria con dentina"],
    ["Pieza 14 con fractura coronaria con exposición pulpar.", "Fractura coronaria con pulpa expuesta"],
    ["Pieza 14 con fractura corono-radicular.", "Fractura corono-radicular"],
    ["Pieza 14 con fractura radicular horizontal.", "Fractura radicular horizontal"],
    ["Pieza 14 con fractura radicular vertical.", "Fractura radicular vertical"],
  ];
  for (const [text, status] of cases) assert.deepEqual(statuses(text), [[26, status]], text);
});

test("lo negado, descartado, sospechado o relatado por el paciente no es un hallazgo", () => {
  for (const text of [
    "Pieza 14 sin fractura radicular vertical.",
    "Se descarta absceso apical agudo en pieza 14.",
    "Pieza 14 con riesgo de fractura coronaria con dentina.",
    "Sospecha de quiste radicular en pieza 14.",
    "Paciente refiere que tuvo un absceso apical agudo en la pieza 14.",
    "No se observa granuloma apical en la pieza 14.",
  ]) assert.deepEqual(statuses(text), [], text);
});

test("nombres ambiguos o palabras comunes no se interpretan como lesión", () => {
  assert.deepEqual(statuses("Pieza 14 con absceso apical."), []);
  assert.deepEqual(statuses("Pieza 14 con fractura."), []);
  assert.deepEqual(statuses("Se aplica sellante en fosas y fisuras de la pieza 3."), []);
  assert.equal(lesionStatusFrom("Control de la pieza 14 sin novedades."), null);
});

test("la lesión convive con lo observado en las caras", () => {
  const proposal = run("Pieza 14 con caries distal y quiste radicular.");
  assert.deepEqual(proposal.odontogram.filter(item => item.kind === "status").map(item => item.status), ["Quiste radicular"]);
  assert.ok(proposal.odontogram.some(item => item.kind === "surface" && item.tooth === 26));
});

test("no cambia lo que ya hacía: exodoncia indicada, ausente e implante", () => {
  assert.deepEqual(statuses("Pieza 14 indicación de exodoncia."), [[26, "Indicación de exodoncia"]]);
  assert.deepEqual(statuses("Se extrae la pieza 14."), [[26, "Ausente"]]);
});
