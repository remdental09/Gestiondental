import { DENTAL_SPEECH_HINTS } from "./dental-lexicon.ts";

export const AUDIO_TRANSCRIPTION_MODEL = "gpt-transcribe";
/** Compatibilidad para cuentas que aún no exponen el modelo nuevo. Configuración explícita prevalece. */
export const AUDIO_COMPATIBILITY_MODEL = "gpt-4o-transcribe";
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

export function audioExtension(type: string): string | null {
  return EXTENSIONS[type.split(";")[0].trim().toLowerCase()] ?? null;
}

/** Solo audio y vocabulario general: nunca se añade identidad ni ficha previa al contexto. */
export async function transcribeDentalAudio(audio: Blob, apiKey: string, options: { model?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ text: string; model: string }> {
  const extension = audioExtension(audio.type);
  if (!extension || !audio.size || audio.size > MAX_AUDIO_BYTES) throw new Error("Audio vacío, demasiado grande o en un formato no compatible.");
  const model = options.model?.trim() || AUDIO_TRANSCRIPTION_MODEL;
  const form = new FormData();
  form.append("file", audio, `dictado.${extension}`);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("prompt", "Consulta odontológica en español de Chile. Dictado del profesional con procedimientos, hallazgos, piezas dentales, superficies, medidas, presupuestos y pagos. Terminología: destartraje, detartraje, tartrectomía, supragingival, subgingival, pulpa, encía, pulpectomía, pulpotomía, ligamento periodontal, sondaje, seis grupos periodontales, pulido coronario, cirugía bucal, flapless, colgajo mucoperióstico, odontosección, alveoloplastia, sutura Vicryl o poliglactina 910, Vicryl Rapide, Monocryl, PDS, Prolene, nylon, poliamida, seda quirúrgica, calibres 3-0 y 4-0, injerto óseo, membrana, hemostasia, tubete anestésico, lidocaína, articaína, paciente abonó, dejó la mitad, 50 por ciento del presupuesto, monto pagado. Conserva nombres de materiales y cifras tal como se dictaron; no completes dosis ni calibres.");
  if (model === "gpt-transcribe") {
    form.append("languages[]", "es");
    for (const { phrase } of DENTAL_SPEECH_HINTS) form.append("keywords[]", phrase);
  } else {
    form.append("language", "es");
  }
  const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  });
  // No devolver cuerpos del proveedor, que podrían contener datos del dictado.
  if (!response.ok) {
    if (response.status === 404 && !options.model?.trim()) {
      return transcribeDentalAudio(audio, apiKey, { ...options, model: AUDIO_COMPATIBILITY_MODEL });
    }
    if (response.status === 401 || response.status === 403) throw new Error("La clave de OpenAI no tiene acceso a la transcripción de audio.");
    if (response.status === 429) throw new Error("OpenAI alcanzó su límite o no tiene saldo disponible. Puedes reintentar la grabación.");
    if (response.status === 400 || response.status === 404) throw new Error("OpenAI no aceptó el audio o el modelo de transcripción configurado.");
    throw new Error("OpenAI no pudo transcribir el audio. Puedes reintentar la grabación.");
  }
  const data = await response.json() as { text?: unknown };
  if (typeof data.text !== "string" || !data.text.trim()) throw new Error("No se reconoció voz en la grabación. Intenta dictar de nuevo.");
  if (data.text.length > 8_000) throw new Error("El dictado supera 8.000 caracteres. Divide la atención en grabaciones más cortas.");
  return { text: data.text.trim(), model };
}
