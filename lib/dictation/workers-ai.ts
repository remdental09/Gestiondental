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
import { OPENAI_STRUCTURE_MODEL, runOpenAiStructure, type OpenAiUsage } from "./openai-structure.ts";

type AiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type OpenAiFallback = { apiKey?: string; model?: string; fetcher?: typeof fetch; onUsage?: (usage: OpenAiUsage) => void };

/** Tiempo reservado para OpenAI cuando hay clave: Workers AI no puede consumir todo el presupuesto. */
const OPENAI_RESERVE_MS = 18_000;

export const OPENAI_QUOTA_NOTE = "Corregido con OpenAI (cupo de Workers AI agotado)";
export const OPENAI_FAILOVER_NOTE = "Corregido con OpenAI (Workers AI no respondió)";

function timeout<T>(promise: Promise<T>, ms: number, model: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${model} sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (cause) => { clearTimeout(timer); reject(cause); });
  });
}

/**
 * Redacta la nota y extrae hallazgos con cita literal. Cadena: Llama 8B → 70B → Mistral Small (Workers AI)
 * → OpenAI gpt-4o-mini (si hay OPENAI_API_KEY). Un error 4006 (cupo diario) salta directo a OpenAI.
 * Si todo falla, proposal.ts deja las reglas locales. El resultado se valida contra la transcripción.
 */
export function createWorkersAiModel(ai: AiRunner | null | undefined, options: { perModelMs?: number; totalMs?: number; openAi?: OpenAiFallback } = {}): ClinicalModel {
  const chain = ai ? [WORKERS_AI_MODEL, ...WORKERS_AI_FALLBACKS] : [];
  const perModelMs = options.perModelMs ?? 30_000;
  const totalMs = options.totalMs ?? 45_000;
  const openAiKey = options.openAi?.apiKey?.trim();
  const openAiModel = options.openAi?.model?.trim() || OPENAI_STRUCTURE_MODEL;
  const reserve = openAiKey ? OPENAI_RESERVE_MS : 0;
  return {
    id: "workers-ai",
    model: chain[0] ?? `openai/${openAiModel}`,
    async complete(input): Promise<ModelAnswer> {
      const started = Date.now();
      const failures: string[] = [];
      let quota = false;
      for (const model of chain) {
        const left = totalMs - reserve - (Date.now() - started);
        if (left < 5_000) break;
        try {
          const result = await timeout(ai!.run(model, buildWorkersAiRequest(model, input)), Math.min(perModelMs, left), model);
          // Si no se puede leer como JSON o la forma no sirve, se prueba el siguiente modelo.
          const output = validateModelOutput(modelOutputToJson(result));
          return { usedModel: model, output };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          failures.push(`${model.split("/").pop()}: ${message.slice(0, 80)}`);
          // El cupo es de la cuenta: los demás modelos de Workers AI también fallarían.
          if (isQuotaError(message)) { quota = true; break; }
        }
      }
      if (openAiKey) {
        const left = totalMs - (Date.now() - started);
        if (left >= 5_000) {
          try {
            const content = await runOpenAiStructure(input, openAiKey, { model: openAiModel, fetcher: options.openAi?.fetcher, timeoutMs: Math.min(20_000, left), onUsage: options.openAi?.onUsage });
            const output = validateModelOutput(modelOutputToJson(content));
            return { usedModel: `openai/${openAiModel}`, output, ...(chain.length ? { note: quota ? OPENAI_QUOTA_NOTE : OPENAI_FAILOVER_NOTE } : {}) };
          } catch (cause) {
            failures.push(`openai: ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 80)}`);
          }
        }
      }
      throw new Error(failures.join("; ") || "sin tiempo para la IA");
    },
  };
}
