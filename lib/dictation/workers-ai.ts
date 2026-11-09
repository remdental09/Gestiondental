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
import { isReasoningModel, OPENAI_STRUCTURE_MODEL, runOpenAiReview, runOpenAiStructure, type OpenAiUsage } from "./openai-structure.ts";
import { AGENT_TOTAL_MS, runOpenAiAgent, type AgentTrace } from "./openai-agent.ts";

type AiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type OpenAiFallback = { apiKey?: string; model?: string; fetcher?: typeof fetch; onUsage?: (usage: OpenAiUsage) => void };

/** Tiempo que se deja a la pasada única de OpenAI si el agente falla. */
const AGENT_FALLBACK_MS = 25_000;

export function agentNote(trace: AgentTrace): string {
  if (!trace.toolCalls.length) return "Agente: respondió sin consultar catálogos";
  const names = [...new Set(trace.toolCalls.map((call) => call.name.replace(/^buscar_/, "").replace(/_/g, " ")))];
  return `Agente: ${trace.toolCalls.length} consulta${trace.toolCalls.length === 1 ? "" : "s"} (${names.join(", ")})`;
}

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
 * Redacta la nota y extrae hallazgos con cita literal. Por defecto usa Workers AI y OpenAI como respaldo;
 * preferOpenAi invierte ese orden cuando la clave está disponible. Un error 4006 salta directo al respaldo.
 * Si todo falla, proposal.ts deja las reglas locales. El resultado se valida contra la transcripción.
 */
export function createWorkersAiModel(ai: AiRunner | null | undefined, options: { perModelMs?: number; totalMs?: number; openAi?: OpenAiFallback; preferOpenAi?: boolean; agent?: boolean } = {}): ClinicalModel {
  const chain = ai ? [WORKERS_AI_MODEL, ...WORKERS_AI_FALLBACKS] : [];
  const perModelMs = options.perModelMs ?? 30_000;
  const totalMs = options.totalMs ?? 45_000;
  const openAiKey = options.openAi?.apiKey?.trim();
  const openAiModel = options.openAi?.model?.trim() || OPENAI_STRUCTURE_MODEL;
  const reserve = openAiKey && !options.preferOpenAi ? OPENAI_RESERVE_MS : 0;
  return {
    id: "workers-ai",
    model: options.preferOpenAi && openAiKey ? `openai/${openAiModel}` : chain[0] ?? `openai/${openAiModel}`,
    async review(system, payload) {
      if (!openAiKey) throw new Error("sin clave de OpenAI para la revisión");
      return runOpenAiReview(system, payload, openAiKey, { model: openAiModel, fetcher: options.openAi?.fetcher, onUsage: options.openAi?.onUsage });
    },
    async complete(input): Promise<ModelAnswer> {
      const started = Date.now();
      const failures: string[] = [];
      let quota = false;
      if (openAiKey && options.preferOpenAi && options.agent) {
        // Agente con herramientas de solo lectura; si falla, sigue la pasada única de siempre.
        let trace: AgentTrace = { turns: 0, toolCalls: [] };
        try {
          const content = await runOpenAiAgent(input, openAiKey, { model: openAiModel, fetcher: options.openAi?.fetcher, totalMs: Math.min(AGENT_TOTAL_MS, Math.max(5_000, totalMs - AGENT_FALLBACK_MS)), onUsage: options.openAi?.onUsage, onTrace: (value) => { trace = value; } });
          const output = validateModelOutput(modelOutputToJson(content));
          return { usedModel: `openai-agente/${openAiModel}`, output, note: agentNote(trace) };
        } catch (cause) {
          failures.push(`agente ${openAiModel}: ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 80)}`);
        }
      }
      if (openAiKey && options.preferOpenAi) {
        const left = totalMs - (Date.now() - started);
        // Un solo modelo de OpenAI: si falla, el error (HTTP/código) queda visible y se sigue con Workers AI y reglas.
        try {
          const content = await runOpenAiStructure(input, openAiKey, { model: openAiModel, fetcher: options.openAi?.fetcher, timeoutMs: Math.max(5_000, Math.min(isReasoningModel(openAiModel) ? 30_000 : 20_000, left)), onUsage: options.openAi?.onUsage });
          const output = validateModelOutput(modelOutputToJson(content));
          return { usedModel: `openai/${openAiModel}`, output };
        } catch (cause) {
          failures.push(`openai ${openAiModel}: ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 80)}`);
        }
      }
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
      if (openAiKey && !options.preferOpenAi) {
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
