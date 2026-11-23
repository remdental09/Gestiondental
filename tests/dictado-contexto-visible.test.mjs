import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dictado por pieza: en el paso de tratamiento se ve lo respondido en el diagnóstico", () => {
  const ui = read("components/tooth-dictation.tsx");
  assert.match(ui, /data-testid="tooth-diagnosis-recap"/);
  assert.match(ui, /step === "plan" && diagnosisText\.trim\(\) &&/);
  assert.match(ui, /Lo que respondiste en el diagnóstico/);
});

test("dictado por pieza: el rechazo de una cara muestra qué se cuestiona (dictado y propuesta de la IA)", () => {
  const ui = read("components/tooth-dictation.tsx");
  assert.match(ui, /data.code === "face_added"/);
  assert.match(ui, /Lo que se cuestiona/);
  assert.match(ui, /Lo que dictaste/);
  assert.match(ui, /Lo que propuso la IA/);
  assert.match(read("app/api/dictation/tooth-answer/route.ts"), /ToothAnswerFaceError/);
});
