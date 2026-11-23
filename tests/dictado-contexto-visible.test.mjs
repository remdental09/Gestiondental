import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dictado por pieza: en el paso de tratamiento se ve lo respondido en el diagnóstico", () => {
  const ui = read("components/tooth-dictation.tsx");
  assert.match(ui, /data-testid="tooth-diagnosis-recap"/);
  assert.match(ui, /step === "plan" && diagnosisText\.trim\(\) &&/);
  // Vive en el encabezado fijo (no en la zona que se desplaza), para verlo mientras se dicta.
  assert.ok(ui.indexOf('data-testid="tooth-diagnosis-recap"') < ui.indexOf('aria-label="Seguimiento en vivo de la revisión"') + 4000);
  assert.ok(ui.indexOf('data-testid="tooth-diagnosis-recap"') < ui.lastIndexOf("Repetir pregunta"));
  assert.match(ui, /Diagnóstico que estableciste/);
});

test("dictado por pieza: el rechazo de una cara muestra qué se cuestiona (dictado y propuesta de la IA)", () => {
  const ui = read("components/tooth-dictation.tsx");
  assert.match(ui, /data.code === "face_added"/);
  assert.match(ui, /Se cuestiona:/);
  assert.ok(ui.indexOf("Lo que propuso la IA") < ui.lastIndexOf("Repetir pregunta"), "la comparación se ve en el encabezado fijo, antes de la pregunta");
  assert.match(ui, /Lo que dictaste/);
  assert.match(ui, /Lo que propuso la IA/);
  assert.match(read("app/api/dictation/tooth-answer/route.ts"), /ToothAnswerFaceError/);
});
