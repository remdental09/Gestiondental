import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, validateModelOutput, WORKERS_AI_MODEL, WORKERS_AI_FALLBACKS } from "../lib/dictation/proposal.ts";
import { createWorkersAiModel } from "../lib/dictation/workers-ai.ts";

const nota = { motivo: "Control de implante.", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "", plan: "", indicaciones: "", presupuesto: "" };
const good = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: "Control de implante.", periodonto: [], pagos: [], citas: [], diagnosticos: [], dudas: [] };

test("cadena: 8B primero, luego 70B y mistral", () => {
  assert.equal(WORKERS_AI_MODEL, "@cf/meta/llama-3.1-8b-instruct-fp8");
  assert.deepEqual([...WORKERS_AI_FALLBACKS], ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"]);
});

test("repara JSON típico de modelo chico: comas finales, comillas tipográficas, salto de línea y salida cortada", () => {
  assert.deepEqual(parseModelJson('```json\n{"a": [1, 2,], "b": “x”,}\n```'), { a: [1, 2], b: "x" });
  assert.deepEqual(parseModelJson('{"t": "línea uno\nlínea dos"}'), { t: "línea uno\nlínea dos" });
  assert.deepEqual(parseModelJson('{"nota": {"motivo": "Control", "examen": "sin sangr'), { nota: { motivo: "Control", examen: "sin sangr" } });
  assert.throws(() => parseModelJson("Lo siento, no puedo."), /JSON/);
});

test("valida la forma y completa vacíos; rechaza formas inútiles", () => {
  const partial = validateModelOutput({ nota: { motivo: "Control." }, hallazgos: [] });
  assert.equal(partial.nota.examen, "");
  assert.deepEqual(partial.citas, []);
  assert.throws(() => validateModelOutput({ nota: "texto" }), /nota/);
  assert.throws(() => validateModelOutput({ nota: { motivo: "" }, texto_corregido: "" }), /vacío/);
  assert.throws(() => validateModelOutput({ nota, hallazgos: "pieza 26" }), /lista/);
});

test("si el 8B devuelve JSON inválido se usa el 70B", async () => {
  const calls = [];
  const ai = { run: async (model) => { calls.push(model); return model.includes("8b") ? { response: "{\"nota\": \"no\"}" } : { response: good }; } };
  const answer = await createWorkersAiModel(ai).complete({ transcript: "control implante", chart: [] });
  assert.equal(answer.usedModel, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.deepEqual(calls, ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
});

test("cupo agotado (4006) no gasta tiempo probando los demás modelos", async () => {
  const calls = [];
  const ai = { run: async (model) => { calls.push(model); throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } };
  await assert.rejects(createWorkersAiModel(ai).complete({ transcript: "x", chart: [] }), /4006/);
  assert.equal(calls.length, 1);
});

test("el 8B va sin response_format (5025) y con el esquema en el texto; el 70B sigue con json_schema", async () => {
  const { buildWorkersAiRequest } = await import("../lib/dictation/proposal.ts");
  const small = buildWorkersAiRequest("@cf/meta/llama-3.1-8b-instruct-fp8", { transcript: "control", chart: [] });
  assert.equal(small.response_format, undefined);
  assert.match(small.messages[1].content, /"texto_corregido"/);
  const big = buildWorkersAiRequest("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { transcript: "control", chart: [] });
  assert.equal(big.response_format.type, "json_schema");
});
