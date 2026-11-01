import {
  buildWorkersAiRequest,
  isQuotaError,
  validateModelOutput,
  modelOutputToJson,
  WORKERS_AI_FALLBACKS,
  WORKERS_AI_MODEL,
  type ClinicalModel,
  type ModelAnswer,
} from "./proposal.ts";

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
          const result = await timeout(ai.run(model, buildWorkersAiRequest(model, input)), Math.min(perModelMs, left), model);
          // Si no se puede leer como JSON o la forma no sirve, se prueba el siguiente modelo.
          const output = validateModelOutput(modelOutputToJson(result));
          return { usedModel: model, output };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          failures.push(`${model.split("/").pop()}: ${message.slice(0, 80)}`);
          if (isQuotaError(message)) break;
        }
      }
      throw new Error(failures.join("; ") || "sin tiempo para la IA");
    },
  };
}
