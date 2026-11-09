import { isReasoningModel, OPENAI_CORRECTION_MODEL } from "./openai-structure.ts";
import { CONDITIONS, normalizeAnamnesis, type Anamnesis } from "../anamnesis.ts";

const PROMPT = `Eres asistente de un dentista chileno. Del dictado de una anamnesis médico-odontológica, extrae SOLO lo que el clínico o el paciente dijo; no inventes, no infieras ni completes. Si algo no se dijo, déjalo vacío ("").
Corrige únicamente errores evidentes de reconocimiento de voz en términos médicos y de fármacos.
Responde un JSON con estas claves:
allergies (texto: alergias a fármacos, látex, anestésicos, alimentos; si dice que niega alergias, "Niega alergias"),
medications (fármacos de uso habitual con dosis si se dijeron), anticoagulants ("si" | "no" | ""),
conditions (arreglo con ids de: ${CONDITIONS.map(([id, l]) => `${id}=${l}`).join("; ")}),
otherConditions (otras enfermedades no listadas), surgeries (cirugías previas), hospitalizations, anesthesiaReactions,
pregnancy ("no" | "embarazada" | "lactancia" | "no-aplica" | ""), smoking, alcohol, bruxism ("si"|"no"|""), gumBleeding ("si"|"no"|""),
lastDentalVisit, dentalHistory (trauma, ortodoncia, cirugías orales, sensibilidad, molestias), observations (lo demás relevante).
Un "niega X" para una enfermedad listada NO la agrega a conditions.`;

export async function structureAnamnesis(source: string, apiKey: string, options: { model?: string; fetcher?: typeof fetch } = {}): Promise<Anamnesis> {
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
      messages: [{ role: "system", content: PROMPT }, { role: "user", content: source }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI no devolvió contenido.");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("La respuesta de OpenAI no tenía el formato esperado."); }
  return normalizeAnamnesis(parsed);
}
