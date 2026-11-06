import { AI_JSON_SCHEMA, AI_SYSTEM_PROMPT, buildModelUserPrompt, type StructureInput } from "./proposal.ts";

/** Respaldo de pago cuando Workers AI no responde o agotó su cupo diario. */
/** Un solo modelo (Luna) para interpretar y corregir. Requiere que el proyecto de OpenAI lo tenga permitido (si no, 403 model_not_found). */
export const OPENAI_STRUCTURE_MODEL = "gpt-5.6-luna";
/** Rectificación lingüística del dictado. Se usa un solo modelo (Luna) para todo, sin combinar modelos. */
export const OPENAI_CORRECTION_MODEL = "gpt-5.6-luna";
/** gpt-5.x y o-series razonan: no aceptan temperature ni max_tokens. */
export const isReasoningModel = (model: string) => /^(?:gpt-[5-9]|o\d)/i.test(model);
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
/** Precio público (USD por millón de tokens), solo para estimar costos en el eval. Referencia: gpt-5.6-luna. */
export const OPENAI_PRICE_PER_MTOK = { input: 0.2, output: 1.2 } as const;

export type OpenAiUsage = { prompt_tokens: number; completion_tokens: number };

/** Mismo prompt y mismo contrato JSON que la cadena de Workers AI (esquema estricto). */
export function buildOpenAiRequest(input: StructureInput, model: string = OPENAI_STRUCTURE_MODEL): Record<string, unknown> {
  const reasoning = isReasoningModel(model);
  return {
    model,
    ...(reasoning ? { max_completion_tokens: 12000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 3500 }),
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
  const model = options.model || OPENAI_STRUCTURE_MODEL;
  const timeout = options.timeoutMs ?? (isReasoningModel(model) ? 55_000 : 28_000);
  const send = (body: Record<string, unknown>) => fetcher(OPENAI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeout),
    body: JSON.stringify(body),
  });
  const request = buildOpenAiRequest(input, model);
  let response = await send(request);
  // Si la API rechaza el esfuerzo de razonamiento, se reintenta una vez sin ese parámetro.
  if (response.status === 400 && "reasoning_effort" in request) {
    const { reasoning_effort: _omit, ...rest } = request;
    response = await send(rest);
  }
  // Nunca se incluye la clave ni el cuerpo de la respuesta en el error.
  if (!response.ok) {
    // Solo el código del error (p. ej. model_not_found); nunca el texto, que podría repetir parte de la clave.
    const detail = await response.json().then((raw: unknown) => {
      const body = raw as { error?: { code?: unknown; type?: unknown } };
      return String(body?.error?.code ?? body?.error?.type ?? "").replace(/[^\w.-]/g, "").slice(0, 40);
    }).catch(() => "");
    throw new Error(`OpenAI respondió HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>; usage?: OpenAiUsage };
  if (payload.usage && options.onUsage) options.onUsage(payload.usage);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI no devolvió la propuesta");
  return content;
}

export function openAiCostUsd(usage: OpenAiUsage): number {
  return (usage.prompt_tokens * OPENAI_PRICE_PER_MTOK.input + usage.completion_tokens * OPENAI_PRICE_PER_MTOK.output) / 1_000_000;
}
