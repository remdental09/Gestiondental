// Avisos hablados: lo que falta o genera duda, en frases cortas para leer en voz alta.

const MAX_SPOKEN = 4;
const MAX_LENGTH = 150;

function spoken(text: string): string {
  return text
    .replace(/^(?:IA|Reglas?):\s*/i, "")
    .replace(/\s*Opcional:.*$/i, "")
    .replace(/\s*«[^»]*»\.?/g, "")
    .replace(/^(?:Valores|Plan|Hallazgos|Próxima cita|Falta):\s*/i, "")
    .replace(/\bFDI\s+(\d)\.(\d)/g, "pieza $1 punto $2")
    .replace(/\b(\d)\.(\d)\b/g, "$1 punto $2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH);
}

/** Frases breves (máx. 4) con las dudas y lo que falta; vacío si no hay nada que avisar. */
export function spokenAlerts(clarifications: string[], missing: string[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const raw of [...clarifications, ...missing]) {
    const phrase = spoken(raw);
    const key = phrase.toLowerCase();
    if (phrase.length < 6 || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  if (!phrases.length) return [];
  const shown = phrases.slice(0, MAX_SPOKEN);
  const rest = phrases.length - shown.length;
  return rest > 0 ? [...shown, `Y ${rest} aviso${rest === 1 ? "" : "s"} más en pantalla.`] : shown;
}
