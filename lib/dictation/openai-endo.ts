import { isReasoningModel, OPENAI_CORRECTION_MODEL } from "./openai-structure.ts";
import { ENDO_PROMPT } from "./endo-dictation.ts";

/** Pide a la IA las endodoncias dictadas. Devuelve el JSON crudo: se valida aparte contra el dictado. */
export async function requestEndoProposal(transcript: string, apiKey: string, options: { model?: string; fetcher?: typeof fetch } = {}): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model || OPENAI_CORRECTION_MODEL;
  const response = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(isReasoningModel(model) ? 40_000 : 20_000),
    body: JSON.stringify({
      model,
      ...(isReasoningModel(model) ? { max_completion_tokens: 8000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 3000 }),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: ENDO_PROMPT }, { role: "user", content: transcript }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI no devolvió contenido.");
  try { return JSON.parse(content); } catch { throw new Error("La respuesta de OpenAI no tenía el formato esperado."); }
}
