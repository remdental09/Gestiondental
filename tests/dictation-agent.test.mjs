import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTool, searchImplantBrands, AGENT_TOOLS } from "../lib/dictation/agent-tools.ts";
import { runOpenAiAgent, buildAgentRequest, agentEnabledFor, AGENT_MAX_TURNS } from "../lib/dictation/openai-agent.ts";
import { createWorkersAiModel, agentNote } from "../lib/dictation/workers-ai.ts";

const nota = { motivo: "Control de implante.", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "", plan: "", indicaciones: "", presupuesto: "" };
const good = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: "Control de implante.", periodonto: [], pagos: [], citas: [], diagnosticos: [], dudas: [] };
const input = { transcript: "control de implante arxis de fsm", chart: [] };
const FAKE_KEY = "sk-prueba-no-real";

const toolReply = (calls) => ({ choices: [{ message: { content: null, tool_calls: calls.map(([name, consulta], index) => ({ id: `c${index}`, type: "function", function: { name, arguments: JSON.stringify({ consulta }) } })) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
const finalReply = { choices: [{ message: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 200, completion_tokens: 50 } };

function scripted(replies, seen) {
  let index = 0;
  return async (_url, init) => {
    seen.push(JSON.parse(init.body));
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply.status) return new Response("{\"error\":{\"code\":\"boom\"}}", { status: reply.status });
    return Response.json(reply);
  };
}

test("herramientas: marca mal transcrita se resuelve a Arcsys (FGM)", () => {
  const [first] = searchImplantBrands("Arxis ET de FSM");
  assert.equal(first.marca, "Arcsys");
  const fuzzy = searchImplantBrands("neodén");
  assert.equal(fuzzy[0].marca, "Neodent");
  assert.ok(fuzzy[0].parecido < 1);
});

test("herramientas: prestación y diagnóstico solo devuelven códigos del catálogo", () => {
  const prest = JSON.parse(runAgentTool("buscar_prestacion", JSON.stringify({ consulta: "tratamiento conductos premolares" })));
  assert.ok(prest.resultados.length > 0);
  assert.ok(prest.resultados.every((item) => /^\d{7}$/.test(item.codigo)));
  const diag = JSON.parse(runAgentTool("buscar_diagnostico", JSON.stringify({ consulta: "pulpitis" })));
  assert.ok(diag.resultados.some((item) => item.codigo && item.codigo.startsWith("DA09")));
});

test("herramientas: argumentos inválidos o herramienta desconocida no lanzan", () => {
  assert.match(runAgentTool("buscar_prestacion", "no-json"), /inválidos/);
  assert.match(runAgentTool("borrar_ficha", JSON.stringify({ consulta: "x" })), /desconocida/);
  assert.ok(AGENT_TOOLS.every((tool) => tool.function.name.startsWith("buscar_")), "solo herramientas de lectura");
});

test("agente: consulta herramientas, recibe resultados y devuelve el JSON", async () => {
  const seen = [];
  let trace;
  const content = await runOpenAiAgent(input, FAKE_KEY, { fetcher: scripted([toolReply([["buscar_marca_implante", "arxis fsm"]]), finalReply], seen), onTrace: (value) => { trace = value; } });
  assert.deepEqual(JSON.parse(content), good);
  assert.equal(seen.length, 2);
  const toolMessage = seen[1].messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /Arcsys/);
  assert.equal(trace.turns, 2);
  assert.deepEqual(trace.toolCalls, [{ name: "buscar_marca_implante", query: "arxis fsm" }]);
  assert.equal(agentNote(trace), "Agente: 1 consulta (marca implante)");
});

test("agente: la última vuelta obliga a responder sin herramientas", async () => {
  const seen = [];
  const replies = [...Array(AGENT_MAX_TURNS - 1).fill(toolReply([["buscar_prestacion", "corona"]])), finalReply];
  await runOpenAiAgent(input, FAKE_KEY, { fetcher: scripted(replies, seen) });
  assert.equal(seen.length, AGENT_MAX_TURNS);
  assert.equal(seen.at(-1).tool_choice, "none");
  assert.ok(seen.slice(0, -1).every((body) => body.tool_choice === "auto"));
  assert.equal(buildAgentRequest([], "gpt-5.6-luna", false).response_format.json_schema.strict, true);
});

test("agente: si falla, la cadena vuelve a la pasada única de OpenAI", async () => {
  const seen = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    if (body.tools) return new Response("{\"error\":{\"code\":\"boom\"}}", { status: 500 });
    return Response.json(finalReply);
  };
  const answer = await createWorkersAiModel(null, { openAi: { apiKey: FAKE_KEY, fetcher }, preferOpenAi: true, agent: true }).complete(input);
  assert.equal(answer.usedModel, "openai/gpt-5.6-luna");
  assert.equal(seen.filter((body) => body.tools).length, 1);
  assert.equal(seen.filter((body) => !body.tools).length, 1);
});

test("agente: apagado no envía herramientas", async () => {
  const seen = [];
  const answer = await createWorkersAiModel(null, { openAi: { apiKey: FAKE_KEY, fetcher: scripted([finalReply], seen) }, preferOpenAi: true }).complete(input);
  assert.equal(answer.usedModel, "openai/gpt-5.6-luna");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools, undefined);
});

test("activación solo para los correos de la lista", () => {
  assert.equal(agentEnabledFor("Remdental09@gmail.com", "remdental09@gmail.com"), true);
  assert.equal(agentEnabledFor("otro@ejemplo.cl", "remdental09@gmail.com"), false);
  assert.equal(agentEnabledFor("remdental09@gmail.com", undefined), false);
  assert.equal(agentEnabledFor("b@x.cl", " a@x.cl , b@x.cl "), true);
});
