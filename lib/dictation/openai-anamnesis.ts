import { isReasoningModel, OPENAI_CORRECTION_MODEL } from "./openai-structure.ts";
import { CONDITIONS, normalizeAnamnesis, type Anamnesis } from "../anamnesis.ts";
import { normalizeInterview, type InterviewResult } from "../anamnesis-interview.ts";

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

/** Para armar la anamnesis desde el historial de evoluciones: solo lo escrito de forma explícita; los tratamientos no son antecedentes. */
const NOTES_PROMPT = PROMPT.replace(
  /^Eres asistente[^\n]*\nCorrige[^\n]*\n/,
  `Eres asistente de un dentista chileno. Recibirás el historial de evoluciones clínicas de un paciente (cada línea empieza con su fecha). Arma la anamnesis médico-odontológica con SOLO los antecedentes que alguna evolución dice de forma explícita (alergias, medicamentos, enfermedades, cirugías, hábitos, bruxismo, embarazo, reacciones a anestesia, antecedentes dentales como trauma u ortodoncia previa).
Las evoluciones describen principalmente tratamientos y controles: un tratamiento realizado NO es un antecedente ni un diagnóstico; no infieras enfermedades, no conviertas lo que dijo el paciente en un diagnóstico y no completes datos faltantes. Si algo no aparece, déjalo vacío ("").
Si un dato figura solo en una evolución, agrégale la fecha entre paréntesis, por ejemplo "Alergia a penicilina (12/09/2026)". Si hay datos contradictorios, anota ambos con sus fechas. Usa un lenguaje claro y breve para el clínico.
`,
);

/** Entrevista grabada (dos voces, sin separación de hablantes): la IA reconoce quién es quién y solo extrae lo que el paciente afirma o confirma. */
const INTERVIEW_PROMPT = `Eres asistente de un dentista chileno. Recibirás la transcripción automática (sin marcas de hablante) de una entrevista de anamnesis entre el DENTISTA (pregunta) y el PACIENTE (responde); puede haber un acompañante. Usa vocabulario médico y odontológico de Chile.
1) Separa la conversación en turnos e infiere quién habla: las preguntas y explicaciones suelen ser del dentista; las respuestas sobre su salud, del paciente.
2) Extrae SOLO lo que el paciente afirma o confirma (un "sí" a una pregunta del dentista cuenta como confirmación de lo preguntado). Lo que el dentista solo pregunta, supone o explica NO es un antecedente.
3) Nunca inventes ni completes. Si un tema no se conversó, deja el campo vacío (""). Escribe "Niega …" solo si el paciente lo negó expresamente (p. ej. "Niega alergias", "No fuma"); "no se habló" ≠ "niega".
4) Corrige solo errores evidentes de reconocimiento de voz en fármacos y términos médicos (p. ej. "salbutamol", "losartán", "metformina", "levotiroxina"). Conserva dosis y frecuencia tal como se dijeron (p. ej. "Losartán 50 mg cada 12 h"); no completes dosis.
5) Marca en doubtful las claves cuyo valor es dudoso: respuesta ambigua o contradictoria, dosis o fármaco poco claro, no está claro si lo dijo el paciente, o el paciente dudó ("creo que", "no me acuerdo").
Responde un JSON: {"turns":[{"speaker":"dentista"|"paciente","text":"..."}], "anamnesis":{...}, "doubtful":["clave", ...]}.
anamnesis tiene estas claves:
allergies (alergias a fármacos, látex, anestésicos, alimentos; "Niega alergias" si las negó),
medications (fármacos de uso habitual con dosis si se dijeron; "Niega medicamentos" si lo negó), anticoagulants ("si" | "no" | ""),
conditions (arreglo con ids de: ${CONDITIONS.map(([id, l]) => `${id}=${l}`).join("; ")}),
otherConditions (otras enfermedades no listadas), surgeries (cirugías previas), hospitalizations, anesthesiaReactions,
pregnancy ("no" | "embarazada" | "lactancia" | "no-aplica" | ""), smoking (tabaco: cantidad si se dijo), alcohol, bruxism ("si"|"no"|""), gumBleeding ("si"|"no"|""),
lastDentalVisit, dentalHistory (trauma, ortodoncia, cirugías orales, extracciones, sensibilidad, molestias, motivo dental relevante), observations (lo demás relevante para la atención que dijo el paciente).
Una enfermedad negada NO va en conditions. Una alergia a un fármaco (p. ej. salbutamol) va en allergies, no en medications.`;

export async function structureInterview(transcript: string, apiKey: string, options: { model?: string; fetcher?: typeof fetch } = {}): Promise<InterviewResult> {
  const content = await askOpenAI(INTERVIEW_PROMPT, transcript, apiKey, options, 60_000, 6000);
  return normalizeInterview(content);
}

async function askOpenAI(system: string, source: string, apiKey: string, options: { model?: string; fetcher?: typeof fetch }, reasoningTimeout = 40_000, plainMaxTokens = 3000): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model || OPENAI_CORRECTION_MODEL;
  const response = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(isReasoningModel(model) ? reasoningTimeout : 20_000),
    body: JSON.stringify({
      model,
      ...(isReasoningModel(model) ? { max_completion_tokens: 8000, reasoning_effort: "low" } : { temperature: 0, max_tokens: plainMaxTokens }),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: source }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI no devolvió contenido.");
  try { return JSON.parse(content); } catch { throw new Error("La respuesta de OpenAI no tenía el formato esperado."); }
}

export async function structureAnamnesis(source: string, apiKey: string, options: { model?: string; fetcher?: typeof fetch; fromNotes?: boolean } = {}): Promise<Anamnesis> {
  return normalizeAnamnesis(await askOpenAI(options.fromNotes ? NOTES_PROMPT : PROMPT, source, apiKey, options));
}

export type NoteForAnamnesis = { date: string; body: string };
const stripImportFooter = (body: string) => body.replace(/\n*— Importada desde la plataforma anterior[^\n]*$/, "").trim();
const ddmmyyyy = (day: string) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day);

/** Texto para la IA: evoluciones en orden cronológico, «[dd/mm/aaaa] texto». Si no caben, se omiten las del medio (se conservan las primeras y las más recientes). */
export function notesSource(notes: NoteForAnamnesis[], maxChars = 24_000): { text: string; used: number } {
  const lines = notes.filter(note => note.body.trim()).sort((a, b) => a.date.localeCompare(b.date))
    .map(note => `[${ddmmyyyy(note.date)}] ${stripImportFooter(note.body).replace(/\s*\n\s*/g, " · ")}`.slice(0, 2_000));
  let head = 0, tail = lines.length;
  const size = () => lines.slice(0, head).concat(lines.slice(tail)).reduce((total, line) => total + line.length + 1, 0);
  while (size() < maxChars && head < tail) {
    // Se agregan alternando: primero una de las más antiguas, luego una de las más recientes.
    const before = head, beforeTail = tail;
    if (head <= lines.length - tail) head++; else tail--;
    if (size() > maxChars) { head = before; tail = beforeTail; break; }
  }
  const kept = lines.slice(0, head).concat(lines.slice(tail));
  return { text: kept.join("\n"), used: kept.length };
}

/** Anamnesis propuesta desde las evoluciones de un paciente. No se guarda: el clínico la revisa. */
export async function anamnesisFromNotes(notes: NoteForAnamnesis[], apiKey: string, options: { model?: string; fetcher?: typeof fetch } = {}): Promise<{ anamnesis: Anamnesis; used: number; total: number }> {
  const { text, used } = notesSource(notes);
  if (!used) throw new Error("Este paciente no tiene evoluciones con texto.");
  return { anamnesis: await structureAnamnesis(text, apiKey, { ...options, fromNotes: true }), used, total: notes.filter(note => note.body.trim()).length };
}
