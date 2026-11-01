import {
  AI_JSON_SCHEMA,
  AI_SYSTEM_PROMPT,
  buildModelUserPrompt,
  modelOutputToJson,
  WORKERS_AI_FALLBACKS,
  WORKERS_AI_MODEL,
  type ClinicalModel,
  type ModelAnswer,
} from "@/lib/dictation/proposal";

type AiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

function timeout<T>(promise: Promise<T>, ms: number, model: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${model} sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (cause) => { clearTimeout(timer); reject(cause); });
  });
}

/**
 * Redacta la nota y extrae hallazgos con cita literal. Prueba los modelos en orden;
 * el resultado se valida después contra la transcripción (proposal.ts).
 */
export function createWorkersAiModel(ai: AiRunner, options: { perModelMs?: number; totalMs?: number } = {}): ClinicalModel {
  const chain = [WORKERS_AI_MODEL, ...WORKERS_AI_FALLBACKS];
  const perModelMs = options.perModelMs ?? 30_000;
  const totalMs = options.totalMs ?? 45_000;
  return {
    id: "workers-ai",
    model: WORKERS_AI_MODEL,
    async complete(input): Promise<ModelAnswer> {
      const started = Date.now();
      const failures: string[] = [];
      for (const model of chain) {
        const left = totalMs - (Date.now() - started);
        if (left < 5_000) break;
        try {
          const result = await timeout(ai.run(model, {
            messages: [
              { role: "system", content: AI_SYSTEM_PROMPT },
              { role: "user", content: buildModelUserPrompt(input) },
            ],
            response_format: { type: "json_schema", json_schema: AI_JSON_SCHEMA },
            max_tokens: 2500,
            temperature: 0,
          }), Math.min(perModelMs, left), model);
          // Si no se puede leer como JSON, se prueba el siguiente modelo.
          const output = modelOutputToJson(result);
          return { usedModel: model, output };
        } catch (cause) {
          failures.push(`${model.split("/").pop()}: ${cause instanceof Error ? cause.message.slice(0, 80) : "error"}`);
        }
      }
      throw new Error(failures.join("; ") || "sin tiempo para la IA");
    },
  };
}
