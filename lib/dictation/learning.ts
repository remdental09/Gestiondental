/**
 * Aprendizaje por profesional (mejora autorrecursiva): lo que la app sugiere una y otra vez y el profesional nunca toma,
 * deja de sugerirse para él. Se calcula desde su propio registro de correcciones (`dictation_feedback`), sin datos de pacientes.
 * Solo apaga sugerencias opcionales (diagnósticos deducidos, citas sin hora); nunca oculta lo que el profesional dictó.
 */
import { ICD11 } from "../icd11.ts";

export const LEARN_MIN_SHOWN = 5;
/** Solo se aprende de diagnósticos que la app DEDUJO (no de los dictados con otro nombre: AAE, término aproximado). */
export const DEDUCED_FROM = new Set(["nota", "caries-pulpar"]);
export const isDeducedSuggestion = (suggested: unknown) => Boolean(suggested && typeof suggested === "object" && DEDUCED_FROM.has(String((suggested as { from?: unknown }).from)));

export type Learned = {
  /** Códigos CIE-11 que ya no se sugieren por deducción (el profesional nunca los aceptó como sugerencia). */
  dxCodes: string[];
  /** Citas sin hora: el profesional nunca las agenda desde el dictado → se muestran solo como recordatorio. */
  hideUntimedAppointments: boolean;
  /** Explicación legible de cada aprendizaje (para el panel de mejora continua). */
  reasons: string[];
};

type Entry = { category?: string; outcome?: string; proposed?: Record<string, unknown> };
const taken = (entry: Entry) => entry.outcome === "aceptado" || entry.outcome === "editado";

export function learnFromFeedback(rows: Array<{ entries: string }>): Learned {
  const entries: Entry[] = rows.flatMap((row) => { try { const value = JSON.parse(row.entries); return Array.isArray(value) ? value as Entry[] : []; } catch { return []; } });
  const dx = new Map<string, { shown: number; taken: number }>();
  let untimed = { shown: 0, taken: 0 };
  for (const entry of entries) {
    if (entry.outcome === "agregado" || !entry.proposed) continue;
    if (entry.category === "diagnostico" && isDeducedSuggestion(entry.proposed.suggested) && typeof entry.proposed.code === "string") {
      const stat = dx.get(entry.proposed.code) ?? { shown: 0, taken: 0 };
      stat.shown++; if (taken(entry)) stat.taken++;
      dx.set(entry.proposed.code, stat);
    }
    if (entry.category === "cita" && !entry.proposed.time) {
      untimed = { shown: untimed.shown + 1, taken: untimed.taken + (taken(entry) ? 1 : 0) };
    }
  }
  const dxCodes = [...dx.entries()].filter(([, stat]) => stat.shown >= LEARN_MIN_SHOWN && stat.taken === 0).map(([code]) => code);
  const hideUntimedAppointments = untimed.shown >= LEARN_MIN_SHOWN && untimed.taken === 0;
  const reasons = [
    ...dxCodes.map((code) => `Ya no se sugiere «${ICD11[code]?.title ?? code}»: se sugirió ${dx.get(code)!.shown} veces y nunca se aceptó. Si lo dictas, sí se registra.`),
    ...(hideUntimedAppointments ? [`Las citas sin hora («control en una semana») ya no se proponen para agendar: se propusieron ${untimed.shown} veces y nunca se agendaron desde el dictado. Quedan como recordatorio en los avisos.`] : []),
  ];
  return { dxCodes, hideUntimedAppointments, reasons };
}

export const NOTHING_LEARNED: Learned = { dxCodes: [], hideUntimedAppointments: false, reasons: [] };
