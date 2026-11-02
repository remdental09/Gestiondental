import { AI_JSON_SCHEMA, AI_SYSTEM_PROMPT, buildModelUserPrompt, type StructureInput } from "./proposal.ts";

/** Respaldo de pago cuando Workers AI no responde o agotó su cupo diario. */
export const OPENAI_STRUCTURE_MODEL = "gpt-4o-mini";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
/** Precio público de gpt-4o-mini (USD por millón de tokens), solo para estimar costos en el eval. */
export const OPENAI_PRICE_PER_MTOK = { input: 0.15, output: 0.6 } as const;

export type OpenAiUsage = { prompt_tokens: number; completion_tokens: number };

/** Mismo prompt y mismo contrato JSON que la cadena de Workers AI (esquema estricto). */
export function buildOpenAiRequest(input: StructureInput, model: string = OPENAI_STRUCTURE_MODEL): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    max_tokens: 3500,
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: buildModelUserPrompt(input) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "propuesta_dictado", strict: true, schema: AI_JSON_SCHEMA } },
  };
}

/** Llama a OpenAI y devuelve el texto JSON del modelo (lo valida quien llama, igual que con Workers AI). */
export async function runOpenAiStructure(
  input: StructureInput,
  apiKey: string,
  options: { model?: string; fetcher?: typeof fetch; timeoutMs?: number; onUsage?: (usage: OpenAiUsage) => void } = {},
): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(OPENAI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    body: JSON.stringify(buildOpenAiRequest(input, options.model || OPENAI_STRUCTURE_MODEL)),
  });
  // Nunca se incluye la clave ni el cuerpo de la respuesta en el error.
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>; usage?: OpenAiUsage };
  if (payload.usage && options.onUsage) options.onUsage(payload.usage);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI no devolvió la propuesta");
  return content;
}

export function openAiCostUsd(usage: OpenAiUsage): number {
  return (usage.prompt_tokens * OPENAI_PRICE_PER_MTOK.input + usage.completion_tokens * OPENAI_PRICE_PER_MTOK.output) / 1_000_000;
}
