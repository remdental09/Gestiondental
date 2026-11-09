import type { OdontogramChange } from "./proposal.ts";
import { checkSurface, checkTransition, eventsFrom, type ProposedState, type ToothEvents } from "./tooth-model.ts";

/**
 * Revisión de sentido clínico. El extractor lee «qué dijo»; esta capa pregunta «¿tiene sentido para un dentista?».
 * Un cambio incoherente nunca se aplica en silencio: queda sin marcar, con la razón a la vista.
 */
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type ChartRow = { tooth: number; status: string; foundation?: "tooth" | "implant" };

const describe = (state: ProposedState | undefined) => !state ? "sin registro"
  : state.status === "Corona" ? `corona ${state.foundation === "implant" ? "sobre implante" : "sobre diente natural"}` : state.status.toLowerCase();

/** Estado general que deja un cambio (la corona sobre implante deja la pieza como implante con corona). */
function stateOf(item: OdontogramChange, current: ChartRow | undefined): ProposedState | null {
  if (item.kind === "crown") return { status: "Corona", foundation: item.foundation ?? (current?.status === "Implante" || current?.status === "Implante con pilar" ? "implant" : "tooth") };
  if (item.kind === "status" && item.status) return { status: item.status };
  return null;
}

/**
 * Capa 1 (sin costo): cada cambio se valida con el modelo clínico de la pieza (`tooth-model.ts`).
 * - Incoherente (un implante con pulpa, un diente extraído que vuelve…): queda sin aceptar y en rojo, con el motivo.
 * - Reemplaza algo ya registrado sin que un hecho dictado hoy lo explique: queda sin aceptar, con «antes → después».
 *   Si el dictado sí lo explica (se extrajo, se instaló el implante, el pilar o la corona), se propone marcado y se ve igual el antes → después.
 */
export function clinicalCoherence(
  odontogram: OdontogramChange[],
  chart: ChartRow[],
  sentencesFor: (tooth: number) => string[],
): { odontogram: OdontogramChange[]; notes: string[] } {
  const current = new Map(chart.map((row) => [row.tooth, row] as const));
  const notes: string[] = [];
  const events = new Map<number, ToothEvents>();
  const eventsOf = (tooth: number) => events.get(tooth) ?? (events.set(tooth, eventsFrom(sentencesFor(tooth))), events.get(tooth)!);
  // Estado final propuesto por pieza: el implante manda sobre la corona que va encima.
  const finalState = new Map<number, ProposedState>();
  for (const item of odontogram) {
    if (item.advisory || item.conflict) continue;
    const state = stateOf(item, current.get(item.tooth));
    if (!state) continue;
    const prev = finalState.get(item.tooth);
    if (!prev || state.status.startsWith("Implante") || (prev.status === "Corona" && state.status === "Corona")) finalState.set(item.tooth, state);
  }
  const out = odontogram.map((item): OdontogramChange => {
    if (item.advisory || item.conflict) return item;
    const before = current.get(item.tooth);
    if (item.kind === "surface") {
      const verdict = checkSurface(before, finalState.get(item.tooth));
      if (verdict.ok) return item;
      notes.push(`FDI ${fdi(item.tooth)}: ${verdict.reason}`);
      return { ...item, coherence: "incoherente", advisory: `Incoherencia clínica · FDI ${fdi(item.tooth)}: ${verdict.reason} Acéptalo solo si de verdad corresponde.` };
    }
    const next = stateOf(item, before);
    if (!next) return item;
    const verdict = checkTransition(before, next, eventsOf(item.tooth));
    if (!verdict.ok) {
      notes.push(`FDI ${fdi(item.tooth)}: ${verdict.reason}`);
      return { ...item, coherence: "incoherente", advisory: `Incoherencia clínica · FDI ${fdi(item.tooth)}: ${verdict.reason} Acéptalo solo si de verdad corresponde.` };
    }
    if (verdict.replaces && !verdict.supported) {
      const change = `${describe(before)} → ${describe(next)}`;
      return { ...item, coherence: "reemplaza", advisory: `Reemplaza lo registrado en FDI ${fdi(item.tooth)}: ${change}. Confírmalo para aplicarlo.` };
    }
    return item;
  });
  return { odontogram: out, notes };
}

/** Resumen compacto de los cambios propuestos para el revisor de IA. */
export function reviewPayload(transcript: string, chart: ChartRow[], odontogram: OdontogramChange[]): string {
  const changes = odontogram.map((item) => ({
    pieza: fdi(item.tooth),
    tipo: item.kind,
    estado: item.status ?? null,
    superficie: item.surface ?? null,
    base: item.foundation ?? null,
    cita: (item.evidence || item.sourceText || "").slice(0, 240),
  }));
  return JSON.stringify({ dictado: transcript.slice(0, 6000), odontograma_actual: chart.map((row) => ({ pieza: fdi(row.tooth), estado: row.status })), cambios_propuestos: changes });
}

export const REVIEW_PROMPT = `Eres un odontólogo clínico senior que revisa la propuesta de odontograma que armó un sistema automático a partir de un dictado.
Tu único trabajo es detectar cambios CLÍNICAMENTE INCOHERENTES o mal atribuidos, como un dentista que mira por encima del hombro. Ejemplos:
- Marcar implante en una pieza que se está trepanando, con pulpitis, endodoncia, caries u obturación (el implante no tiene pulpa).
- Atribuir a una pieza lo que el dictado dice de la vecina («la 20 está adyacente al implante de la 19»).
- Pasar a implante una pieza con corona sobre diente natural sin que se diga que se extrajo o que se instaló un implante.
- Marcar ausente una pieza a la que se le hace tratamiento.
- Cualquier cambio que contradiga el odontograma actual sin que el dictado diga qué ocurrió.
No inventes cambios nuevos y no objetes lo que es razonable. Responde SOLO un JSON: {"observaciones":[{"pieza":"4.5","estado":"Implante","motivo":"explicación breve en español clínico"}]}. Si todo es coherente, {"observaciones":[]}. "pieza" en FDI con punto; "estado" o "superficie" copiados del cambio observado.`;

export type AiObservation = { tooth: number; match: string; motivo: string };

/** Interpreta la respuesta del revisor y descarta lo que no corresponde a un cambio propuesto. */
export function parseReview(raw: unknown, odontogram: OdontogramChange[]): AiObservation[] {
  let json: unknown = raw;
  if (typeof raw === "string") { try { json = JSON.parse(raw); } catch { return []; } }
  const list = json && typeof json === "object" ? (json as Record<string, unknown>).observaciones : null;
  if (!Array.isArray(list)) return [];
  const out: AiObservation[] = [];
  for (const entry of list.slice(0, 12)) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const m = /^([1-8])\.([1-8])$/.exec(typeof rec.pieza === "string" ? rec.pieza.trim() : "");
    const motivo = typeof rec.motivo === "string" ? rec.motivo.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!m || motivo.length < 8) continue;
    const tooth = Number(m[1]) * 10 + Number(m[2]);
    const wanted = fold(String(rec.estado ?? rec.superficie ?? ""));
    const target = odontogram.find((item) => item.tooth === tooth && (!wanted || fold(item.status ?? item.surface ?? "") === wanted || fold(item.status ?? "").includes(wanted)))
      ?? odontogram.find((item) => item.tooth === tooth);
    if (target) out.push({ tooth, match: target.id, motivo });
  }
  return out;
}

export function applyAiReview(odontogram: OdontogramChange[], observations: AiObservation[]): { odontogram: OdontogramChange[]; notes: string[] } {
  const notes: string[] = [];
  const byId = new Map(observations.map((o) => [o.match, o] as const));
  const out = odontogram.map((item): OdontogramChange => {
    const obs = byId.get(item.id);
    if (!obs || item.coherence === "incoherente") return item;
    notes.push(`FDI ${fdi(item.tooth)}: ${obs.motivo}`);
    return { ...item, coherence: "incoherente", advisory: `Revisión clínica (IA) · FDI ${fdi(item.tooth)}: ${obs.motivo} Márcalo solo si de verdad corresponde.` };
  });
  return { odontogram: out, notes };
}
