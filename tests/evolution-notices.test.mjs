import test from "node:test";
import assert from "node:assert/strict";
import { evolutionNotices } from "../lib/dictation/evolution-notices.ts";

const base = { procedures: 0, acceptedTeeth: 0, perio: 0, diagnoses: 0, budget: 0, planInBody: false, chartHasPlan: false, hasBody: true };
const keys = (input, dismissed) => evolutionNotices(input, dismissed).map((n) => n.key);

test("con prestación sin diagnóstico ni plan avisa de ambos", () => {
  assert.deepEqual(keys({ ...base, procedures: 1 }), ["diagnostico", "plan"]);
});

test("si ya hay diagnóstico solo falta el plan", () => {
  assert.deepEqual(keys({ ...base, procedures: 1, diagnoses: 1 }), ["plan"]);
});

test("un plan registrado en la ficha o en el texto evita el aviso de plan", () => {
  assert.deepEqual(keys({ ...base, acceptedTeeth: 2, diagnoses: 1, chartHasPlan: true }), []);
  assert.deepEqual(keys({ ...base, acceptedTeeth: 2, diagnoses: 1, planInBody: true }), []);
});

test("sin prestación avisa de la prestación y no pide diagnóstico ni plan", () => {
  assert.deepEqual(keys(base), ["prestacion"]);
});

test("cada aviso se puede descartar solo para esta evolución", () => {
  assert.deepEqual(keys({ ...base, procedures: 1 }, new Set(["diagnostico"])), ["plan"]);
  assert.deepEqual(keys({ ...base, procedures: 1 }, new Set(["diagnostico", "plan"])), []);
});

test("sin texto de evolución no avisa nada", () => {
  assert.deepEqual(keys({ ...base, hasBody: false }), []);
});
