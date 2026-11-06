import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_JSON_SCHEMA, AI_SYSTEM_PROMPT, buildModelUserPrompt, proposeFromTranscript, WORKERS_AI_MODEL, WORKERS_AI_FALLBACKS } from "../lib/dictation/proposal.ts";
import { createWorkersAiModel, OPENAI_QUOTA_NOTE, OPENAI_FAILOVER_NOTE } from "../lib/dictation/workers-ai.ts";
import { buildOpenAiRequest, openAiCostUsd, OPENAI_CHAT_URL } from "../lib/dictation/openai-structure.ts";

const nota = { motivo: "Control de implante.", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "", plan: "", indicaciones: "", presupuesto: "" };
const good = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: "Control de implante.", periodonto: [], pagos: [], citas: [], diagnosticos: [], dudas: [] };
const quota = () => { throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons"); };
const input = { transcript: "control de implante", chart: [] };
const FAKE_KEY = "sk-prueba-no-real";

function openAiFetcher(calls, reply = { ok: true, body: { choices: [{ message: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 3000, completion_tokens: 400 } } }) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (!reply.ok) return new Response("{\"error\":{\"message\":\"boom\"}}", { status: reply.status ?? 500 });
    return Response.json(reply.body);
  };
}

test("cadena completa: 8B → 70B → mistral → OpenAI cuando Workers AI falla sin cupo agotado", async () => {
  const calls = [];
  const fetches = [];
  const ai = { run: async (model) => { calls.push(model); throw new Error("5xx interno"); } };
  const answer = await createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches) } }).complete(input);
  assert.deepEqual(calls, [WORKERS_AI_MODEL, ...WORKERS_AI_FALLBACKS]);
  assert.equal(fetches.length, 1);
  assert.equal(answer.usedModel, "openai/gpt-4.1");
  assert.equal(answer.note, OPENAI_FAILOVER_NOTE);
});

test("error 4006 salta directo a OpenAI sin probar los demás modelos de Workers AI", async () => {
  const calls = [];
  const fetches = [];
  const ai = { run: async (model) => { calls.push(model); quota(); } };
  const answer = await createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches) } }).complete(input);
  assert.deepEqual(calls, [WORKERS_AI_MODEL]);
  assert.equal(fetches.length, 1);
  assert.equal(answer.note, OPENAI_QUOTA_NOTE);
  assert.equal(answer.output.texto_corregido, "Control de implante.");
});

test("si Workers AI responde, OpenAI no se llama", async () => {
  const fetches = [];
  const ai = { run: async () => ({ response: good }) };
  const answer = await createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches) } }).complete(input);
  assert.equal(fetches.length, 0);
  assert.equal(answer.usedModel, WORKERS_AI_MODEL);
  assert.equal(answer.note, undefined);
});

test("sin clave de OpenAI se comporta como antes (falla y quedan las reglas locales)", async () => {
  const fetches = [];
  const ai = { run: async () => quota() };
  await assert.rejects(createWorkersAiModel(ai, { openAi: { apiKey: "  ", fetcher: openAiFetcher(fetches) } }).complete(input), /4006/);
  assert.equal(fetches.length, 0);
});

test("si OpenAI también falla, el error no expone la clave y proposeFromTranscript usa reglas locales con la advertencia", async () => {
  const fetches = [];
  const ai = { run: async () => quota() };
  const model = createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches, { ok: false, status: 429 }) } });
  await assert.rejects(model.complete(input), (error) => /openai: OpenAI respondió HTTP 429/.test(error.message) && !error.message.includes(FAKE_KEY));
  const outcome = await proposeFromTranscript({ transcript: "Control de implante pieza 3.6, sin novedades.", chart: [] }, model, () => {}, { today: "2026-11-02" });
  assert.equal(outcome.engine, "reglas-locales");
  assert.match(outcome.aiError, /cupo diario gratuito de Workers AI.*; el respaldo OpenAI tampoco respondió \(HTTP 429\)$/);
  assert.equal(outcome.aiNote, undefined);
});

test("JSON inválido de OpenAI también cae a reglas locales", async () => {
  const fetches = [];
  const ai = { run: async () => quota() };
  const model = createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches, { ok: true, body: { choices: [{ message: { content: "{\"nota\": \"no\"}" } }] } }) } });
  const outcome = await proposeFromTranscript({ transcript: "Control de implante pieza 3.6.", chart: [] }, model, () => {}, { today: "2026-11-02" });
  assert.equal(outcome.engine, "reglas-locales");
});

test("cuando OpenAI responde, el resultado es ia+reglas con nota discreta y sin advertencia", async () => {
  const fetches = [];
  const ai = { run: async () => quota() };
  const model = createWorkersAiModel(ai, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches) } });
  const outcome = await proposeFromTranscript({ transcript: "control de implante", chart: [] }, model, () => {}, { today: "2026-11-02" });
  assert.equal(outcome.engine, "ia+reglas");
  assert.equal(outcome.model, "openai/gpt-4.1");
  assert.equal(outcome.aiNote, "Corregido con OpenAI (cupo de Workers AI agotado)");
  assert.equal(outcome.aiError, undefined);
});

test("OpenAI recibe el mismo prompt y el mismo esquema JSON que Workers AI, con la clave solo en Authorization", async () => {
  const fetches = [];
  await createWorkersAiModel(null, { openAi: { apiKey: FAKE_KEY, fetcher: openAiFetcher(fetches) } }).complete(input);
  const [{ url, init, body }] = fetches;
  assert.equal(url, OPENAI_CHAT_URL);
  assert.equal(init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(!init.body.includes(FAKE_KEY));
  assert.equal(body.model, "gpt-4.1");
  assert.deepEqual(body.messages, [{ role: "system", content: AI_SYSTEM_PROMPT }, { role: "user", content: buildModelUserPrompt(input) }]);
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "propuesta_dictado", strict: true, schema: AI_JSON_SCHEMA } });
  assert.deepEqual(buildOpenAiRequest(input), body);
});

test("costo estimado de gpt-4.1 por tokens", () => {
  assert.equal(Math.round(openAiCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }) * 100) / 100, 10);
});

test("la pantalla muestra la advertencia ámbar solo con reglas locales y la nota discreta con OpenAI", () => {
  const ui = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");
  assert.match(ui, /outcome\?\.aiError && <div role="alert" className="[^"]*amber/);
  assert.match(ui, /!outcome\.aiError && outcome\.aiNote && <p className="text-xs/);
  const route = readFileSync(new URL("../app/api/dictation/structure/route.ts", import.meta.url), "utf8");
  assert.match(route, /env\.OPENAI_API_KEY/);
});

test("los modelos de razonamiento usan max_completion_tokens y no envían temperature", () => {
  const input = { transcript: "hola", chart: [] };
  const reasoning = buildOpenAiRequest(input, "gpt-5-mini");
  assert.equal(reasoning.temperature, undefined);
  assert.equal(reasoning.max_tokens, undefined);
  assert.ok(reasoning.max_completion_tokens > 0);
  const classic = buildOpenAiRequest(input, "gpt-4.1");
  assert.equal(classic.temperature, 0);
  assert.equal(classic.max_tokens, 3500);
});
