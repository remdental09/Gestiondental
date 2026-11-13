import test from "node:test";
import assert from "node:assert/strict";
import { isPriorEndoSentence, priorEndoYear } from "../lib/dictation/prior-endo.ts";

test("reconoce endodoncia previa dictada de varias maneras", () => {
  for (const text of [
    "La 3.6 viene con endodoncia previa.",
    "Endodoncia antigua en la 1.1, del 2018.",
    "La pieza 4.6 ya está endodonciada.",
    "El diente 1.4 viene con tratamiento de conductos anterior.",
    "Antecedentes de endodoncia en la 2.5.",
    "La 3.7 está endodonciada.",
  ]) assert.equal(isPriorEndoSentence(text), true, text);
});
test("no confunde con endodoncia indicada, de hoy o retratamiento", () => {
  for (const text of [
    "La 3.6 necesita endodoncia.",
    "Se realiza endodoncia de la 4.6 hoy.",
    "Se indica endodoncia en la 1.1.",
    "La 2.5 no tiene endodoncia.",
    "Retratamiento de conductos en la 3.6.",
    "Endodoncia previa a la corona de la 1.6.",
    "Control. La 2.1 sin endodoncia.",
  ]) assert.equal(isPriorEndoSentence(text), false, text);
});
test("saca el año aproximado", () => {
  assert.equal(priorEndoYear("endodoncia antigua del 2018", "2026-11-13"), "2018");
  assert.equal(priorEndoYear("endodoncia hecha hace 5 años", "2026-11-13"), "2021");
  assert.equal(priorEndoYear("endodoncia hecha hace diez años", "2026-11-13"), "2016");
  assert.equal(priorEndoYear("endodoncia previa", "2026-11-13"), "");
  assert.equal(priorEndoYear("año 2099", "2026-11-13"), "");
});

import { structureTranscript } from "../lib/dictation/proposal.ts";

test("el dictado propone la endodoncia previa y no la cobra ni pregunta si se hizo hoy", () => {
  const p = structureTranscript("Paciente viene a control. La 3.6 viene con endodoncia previa del 2018. La 1.1 sin hallazgos.", { today: "2026-11-13" });
  assert.deepEqual((p.priorEndo ?? []).map((item) => [item.tooth, item.year]), [[36, "2018"]]);
  assert.equal((p.prestaciones ?? []).some((item) => /endodoncia/i.test(item.name ?? item.label ?? "")), false);
  assert.equal(p.clarifications.some((note) => /endodoncia/i.test(note)), false);
});
test("endodoncia indicada o hecha hoy no es previa", () => {
  const p = structureTranscript("La 4.6 necesita endodoncia. Se realiza endodoncia de la 2.5 hoy.", { today: "2026-11-13" });
  assert.equal((p.priorEndo ?? []).length, 0);
});
