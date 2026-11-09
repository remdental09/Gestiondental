import test from "node:test";
import assert from "node:assert/strict";
import { applyLexicon } from "../lib/dictation/spoken.ts";
import { implantSurgeryLines } from "../lib/dictation/surgery-template.ts";

const DICTADO = "Bueno, tenemos una cirugía, en el área de la pieza 4.4, el paciente estaba desdentado de la 4.4 y colocamos un implante de 3.8 por 7 milímetros de largo y es de FGM marca Arsis. Se hizo una incisión supracrestal con una descarga de human parcial hacia el diente 4.3 y evadiendo la papila del vecino para no dañar la papila y la altura gingival del vecino. Se hizo una descarga hasta mucosa pasando por la encía herida, una descarga de espesor total con cuatro tubos de anestesia de lidocaina. El implante quedó puesto a 45 newton centímetro cuadrado sin problemas, no usamos injerto, se hizo el cierre con cuatro puntos con sutura bicril.";

test("cirugía de implante: plantilla determinista desde el dictado", () => {
  const lines = implantSurgeryLines(applyLexicon(DICTADO).text);
  assert.ok(lines);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /cuatro tubos de lidocaína/);
  assert.doesNotMatch(text, /tubetes/);
  assert.match(text, /3,8 × 7 mm/);
  assert.match(text, /45 N·cm/);
  assert.match(text, /Neumann parcial hacia la pieza 4\.3/);
  assert.match(text, /Vicryl/);
  assert.match(text, /No se utiliza injerto/);
  assert.ok(lines.every((l) => l.evidence));
});

test("no se activa sin implante ni con cirugías combinadas", () => {
  assert.equal(implantSurgeryLines("Se realiza profilaxis y control."), null);
  assert.equal(implantSurgeryLines(applyLexicon(DICTADO + " Se hizo elevación de seno.").text), null);
});

import { surgeryQuestions } from "../lib/dictation/surgery-template.ts";
test("cirugía ambigua: pregunta por colgajo y descargas", () => {
  const q = surgeryQuestions(applyLexicon(DICTADO).text);
  assert.equal(q.length, 2);
  assert.match(q[0], /colgajo de espesor total/);
  assert.deepEqual(surgeryQuestions("Control de rutina."), []);
});
