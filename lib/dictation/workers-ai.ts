import {
  buildModelUserPrompt,
  EVOLUTION_JSON_SCHEMA,
  EVOLUTION_SYSTEM_PROMPT,
  WORKERS_AI_MODEL,
  type ClinicalModel,
} from "@/lib/dictation/proposal";

type AiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

/** El modelo solo redacta la evolución. Las piezas y los hallazgos los resuelve el código. */
export function createWorkersAiModel(ai: AiRunner): ClinicalModel {
  return {
    id: "workers-ai",
    model: WORKERS_AI_MODEL,
    async complete(input) {
      const result = await ai.run(WORKERS_AI_MODEL, {
        messages: [
          { role: "system", content: EVOLUTION_SYSTEM_PROMPT },
          { role: "user", content: buildModelUserPrompt(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: EVOLUTION_JSON_SCHEMA,
        },
        max_tokens: 500,
        temperature: 0,
      });
      return result;
    },
  };
}
