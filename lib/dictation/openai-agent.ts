import { AI_SYSTEM_PROMPT, buildModelUserPrompt, AI_JSON_SCHEMA, type StructureInput } from "./proposal.ts";
import { OPENAI_CHAT_URL, OPENAI_STRUCTURE_MODEL, isReasoningModel, type OpenAiUsage } from "./openai-structure.ts";
import { AGENT_TOOLS, runAgentTool } from "./agent-tools.ts";

/**
 * Agente de dictado: el mismo modelo y el mismo contrato JSON que runOpenAiStructure, pero con herramientas de
 * solo lectura (arancel, CIE-11, marcas de implantes) que puede consultar antes de responder.
 * No escribe en la ficha: devuelve el texto JSON de la propuesta, que proposal.ts valida y la interfaz muestra para
 * confirmar. Si se agota el tiempo o las vueltas, lanza un error y la cadena sigue con la pasada única.
 */

/** El agente con herramientas se activa solo para los correos de DICTATION_AGENT_EMAILS (separados por coma). */
export function agentEnabledFor(email: string, list: string | undefined): boolean {
  const wanted = email.trim().toLowerCase();
  if (!wanted || !list) return false;
  return list.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).includes(wanted);
}

export const AGENT_MAX_TURNS = 4;
export const AGENT_TOTAL_MS = 45_000;

export const AGENT_PROMPT_ADDENDUM = `

HERRAMIENTAS (solo lectura; no guardan nada):
- buscar_prestacion: si el procedimiento realizado hoy no está claramente en «Prestaciones candidatas del arancel», búscalo. Un código devuelto por esta herramienta también es válido para "codigo".
- buscar_diagnostico: para escribir en «diagnosticos» un término que exista en el catálogo CIE-11 verificado, y para elegir el más cercano en «diagnosticos_sugeridos» cuando el profesional describió lo que hizo pero no dictó diagnóstico.
- buscar_marca_implante: cuando se dicte una marca o empresa de implantes, compruébala; la voz suele deformarlas.
Usa las herramientas solo cuando aporten (normalmente 0 a 3 llamadas, todas juntas en una misma vuelta si puedes). No busques montos ni datos de pago. Si tras buscar persiste la duda, déjala en «dudas» en vez de suponer. Cuando termines, devuelve el JSON.`;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AgentTrace = { turns: number; toolCalls: Array<{ name: string; query: string }> };

export function buildAgentRequest(messages: ChatMessage[], model: string, finalTurn: boolean): Record<string, unknown> {
  const reasoning = isReasoningModel(model);
  return {
    model,
    ...(reasoning ? { max_completion_tokens: 12000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 3500 }),
    messages,
    tools: AGENT_TOOLS,
    // En la última vuelta se obliga a responder con el JSON.
    tool_choice: finalTurn ? "none" : "auto",
    parallel_tool_calls: true,
    response_format: { type: "json_schema", json_schema: { name: "propuesta_dictado", strict: true, schema: AI_JSON_SCHEMA } },
  };
}

const queryOf = (raw: string) => {
  try { const value = (JSON.parse(raw) as { consulta?: unknown }).consulta; return typeof value === "string" ? value.slice(0, 80) : ""; }
  catch { return ""; }
};

export async function runOpenAiAgent(
  input: StructureInput,
  apiKey: string,
  options: { model?: string; fetcher?: typeof fetch; totalMs?: number; maxTurns?: number; onUsage?: (usage: OpenAiUsage) => void; onTrace?: (trace: AgentTrace) => void } = {},
): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model || OPENAI_STRUCTURE_MODEL;
  const deadline = Date.now() + (options.totalMs ?? AGENT_TOTAL_MS);
  const maxTurns = Math.max(1, options.maxTurns ?? AGENT_MAX_TURNS);
  const trace: AgentTrace = { turns: 0, toolCalls: [] };
  const messages: ChatMessage[] = [
    { role: "system", content: AI_SYSTEM_PROMPT + AGENT_PROMPT_ADDENDUM },
    { role: "user", content: buildModelUserPrompt(input) },
  ];
  let dropReasoning = false;
  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const left = deadline - Date.now();
      if (left < 3_000) throw new Error("agente sin tiempo");
      trace.turns = turn;
      const request = buildAgentRequest(messages, model, turn === maxTurns);
      if (dropReasoning) delete request.reasoning_effort;
      let response = await fetcher(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(left),
        body: JSON.stringify(request),
      });
      if (response.status === 400 && "reasoning_effort" in request) {
        dropReasoning = true;
        delete request.reasoning_effort;
        response = await fetcher(OPENAI_CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
          body: JSON.stringify(request),
        });
      }
      if (!response.ok) {
        // Solo el código del error; nunca el texto, que podría repetir parte de la clave.
        const detail = await response.json().then((raw: unknown) => {
          const body = raw as { error?: { code?: unknown; type?: unknown } };
          return String(body?.error?.code ?? body?.error?.type ?? "").replace(/[^\w.-]/g, "").slice(0, 40);
        }).catch(() => "");
        throw new Error(`OpenAI (agente) respondió HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; tool_calls?: ToolCall[] } }>; usage?: OpenAiUsage };
      if (payload.usage && options.onUsage) options.onUsage(payload.usage);
      const message = payload.choices?.[0]?.message;
      const calls = Array.isArray(message?.tool_calls) ? message!.tool_calls.filter((call) => call?.type === "function" && call.function?.name) : [];
      if (calls.length) {
        messages.push({ role: "assistant", content: typeof message?.content === "string" ? message.content : null, tool_calls: calls });
        for (const call of calls.slice(0, 8)) {
          trace.toolCalls.push({ name: call.function.name, query: queryOf(call.function.arguments) });
          messages.push({ role: "tool", tool_call_id: call.id, content: runAgentTool(call.function.name, call.function.arguments) });
        }
        // Las llamadas que excedan el tope igual necesitan respuesta para que el historial sea válido.
        for (const call of calls.slice(8)) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Demasiadas consultas en una vuelta." }) });
        continue;
      }
      const content = message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI (agente) no devolvió la propuesta");
      return content;
    }
    throw new Error("agente sin respuesta final");
  } finally {
    options.onTrace?.(trace);
  }
}
