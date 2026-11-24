import test from "node:test";
import assert from "node:assert/strict";
import { ruleItems } from "../lib/dictation/clinical-items.ts";

// Textos sintéticos estilo ficha. Ninguno es una evolución real.
const tools = { sentences: (t) => t.split(/(?<=[.!?])\s+/), teethIn: (t) => [...t.matchAll(/\b([1-8])\.([1-8])\b/g)].map((m) => Number(m[1]) * 10 + Number(m[2])), isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };
const kinds = (text, tooth) => ruleItems(text, tools).filter((i) => i.tooth === tooth).map((i) => `${i.kind}:${i.category}`);

test("«debo hacer / próxima sesión / se indica / derivo» es plan: nunca realizado", () => {
  for (const [text, tooth] of [
    ["Control, profilaxis y flúor. Debo hacer exodoncia de 5.3-6.3 (prox sesion exodoncias con oxido nitroso).", 53],
    ["Debo realizar exodoncia de piezas 7.3-8.3.", 73],
    ["Prox sesion exodoncia 3.6.", 36],
    ["Se indica exodoncia de 4.8.", 48],
    ["Derivo a cirujano para exodoncia 3.8.", 38],
    ["Hay que extraer la 1.8.", 18],
    ["Tengo que hacer endodoncia en 2.6 la próxima semana.", 26],
  ]) {
    const k = kinds(text, tooth);
    assert.ok(k.length, text);
    assert.ok(k.every((x) => !x.startsWith("realizado")), `${text} → ${k}`);
  }
});

test("lo hecho hoy sigue siendo realizado", () => {
  assert.ok(kinds("Exodoncia de 5.3 y 6.3 bajo anestesia infiltrativa, doy indicaciones.", 53).some((x) => x === "realizado:exodoncia"));
  assert.ok(kinds("Realizo exodoncia de 3.6.", 36).some((x) => x === "realizado:exodoncia"));
});
