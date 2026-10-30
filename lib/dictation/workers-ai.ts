import {
  buildModelUserPrompt,
  CLINICAL_SYSTEM_PROMPT,
  DICTATION_JSON_SCHEMA,
  modelOutputToJson,
  WORKERS_AI_MODEL,
  type ClinicalModel,
} from "@/lib/dictation/proposal";

type AiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

/** Llamada intercambiable al modelo. Otro proveedor solo tiene que cumplir ClinicalModel. */
export function createWorkersAiModel(ai: AiRunner): ClinicalModel {
  return {
    id: "workers-ai",
    model: WORKERS_AI_MODEL,
    async complete(input) {
      const result = await ai.run(WORKERS_AI_MODEL, {
        messages: [
          { role: "system", content: CLINICAL_SYSTEM_PROMPT },
          { role: "user", content: buildModelUserPrompt(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: DICTATION_JSON_SCHEMA.schema,
        },
        max_tokens: 1800,
        temperature: 0,
      });
      return modelOutputToJson(result);
    },
  };
}
