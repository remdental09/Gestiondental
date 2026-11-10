import type { OdontogramChange } from "./proposal.ts";
import type { ClinicalAct } from "./clinical-acts.ts";
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

/** Resumen compacto de la propuesta completa para el revisor de IA: dictado, nota, odontograma, prestaciones y actos. */
export function reviewPayload(transcript: string, chart: ChartRow[], odontogram: OdontogramChange[], extra: { note?: string; prestaciones?: Array<{ code: string; name: string; tooth: number | null; evidence: string }>; acts?: ClinicalAct[] } = {}): string {
  const changes = odontogram.map((item) => ({
    pieza: fdi(item.tooth),
    tipo: item.kind,
    estado: item.status ?? null,
    superficie: item.surface ?? null,
    hallazgo: item.finding?.condition ?? null,
    material: item.finding?.restorationMaterial ?? null,
    base: item.foundation ?? null,
    cita: (item.evidence || item.sourceText || "").slice(0, 240),
  }));
  const note = (extra.note ?? "").split(/\nTranscripción completa/)[0].slice(0, 4000);
  return JSON.stringify({
    dictado: transcript.slice(0, 6000),
    odontograma_actual: chart.map((row) => ({ pieza: fdi(row.tooth), estado: row.status })),
    nota_propuesta: note,
    cambios_propuestos: changes,
    prestaciones_propuestas: (extra.prestaciones ?? []).map((item) => ({ codigo: item.code, nombre: item.name, pieza: item.tooth ? fdi(item.tooth) : null, cita: item.evidence.slice(0, 200) })),
    actos_comprendidos: (extra.acts ?? []).map((act) => ({ pieza: act.tooth ? fdi(act.tooth) : null, caras: act.faces, accion: act.action, material_colocado: act.placed, material_retirado: act.removed, intencion: act.intent, estado_final_cara: act.finalState, cita: act.evidence.slice(0, 200) })),
  });
}

export const REVIEW_PROMPT = `Eres un odontólogo clínico senior que revisa la propuesta que armó un sistema automático a partir de un dictado: la nota, los cambios de odontograma y las prestaciones del arancel.
LEE Y COMPRENDE el dictado como lo haría un colega (verbos, intención, qué material se colocó y cuál se retiró) y detecta solo lo que NO calza con lo dictado o es clínicamente incoherente. Ejemplos:
- Cobrar o marcar un material que el dictado dice que se RETIRÓ («se retira la amalgama» no es obturación de amalgama).
- Marcar «obturada» una cara cuando lo colocado fue para inactivar caries o fue provisorio y el dictado no habla de obturación definitiva.
- Una prestación que no corresponde a nada realizado hoy, o cuya cantidad/extensión no calza (p. ej. un sextante cuando se dictaron varios).
- Pieza, caras o material en la nota distintos a los del odontograma o del dictado.
- Marcar implante en una pieza que se trepana o tiene pulpa; atribuir a una pieza lo dicho de la vecina; marcar ausente una pieza tratada; contradecir el odontograma actual sin que el dictado diga qué ocurrió.
No inventes cambios nuevos y no objetes lo razonable. Responde SOLO un JSON:
{"observaciones":[{"pieza":"4.5","estado":"Implante","motivo":"…"}],"prestaciones":[{"codigo":"5005002","pieza":"1.6","motivo":"…"}],"nota":[{"motivo":"…"}]}
"observaciones" son objeciones a cambios del odontograma ("pieza" en FDI con punto; "estado" o la cara), "prestaciones" a códigos propuestos (con "pieza" en FDI con punto si el código es de una pieza, o ""), "nota" a incoherencias del texto. Motivos breves en español clínico de Chile. Si todo es coherente, listas vacías.`;

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


export type PrestacionObservation = { code: string; tooth: number | null; motivo: string };

/** Objeciones del revisor a prestaciones propuestas (solo códigos que estén en la propuesta) y a la nota. */
export function parseReviewExtras(raw: unknown, codes: string[]): { prestaciones: PrestacionObservation[]; nota: string[] } {
  let json: unknown = raw;
  if (typeof raw === "string") { try { json = JSON.parse(raw); } catch { return { prestaciones: [], nota: [] }; } }
  const rec = json && typeof json === "object" ? json as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const prestaciones = (Array.isArray(rec.prestaciones) ? rec.prestaciones : []).slice(0, 12).flatMap((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const code = text(item.codigo).replace(/\D/g, "");
    const motivo = text(item.motivo);
    const piece = /^([1-8])\.([1-8])$/.exec(text(item.pieza));
    return codes.includes(code) && motivo.length >= 8 ? [{ code, tooth: piece ? Number(piece[1]) * 10 + Number(piece[2]) : null, motivo }] : [];
  });
  const nota = (Array.isArray(rec.nota) ? rec.nota : []).slice(0, 6).flatMap((entry) => {
    const motivo = text(entry && typeof entry === "object" ? (entry as Record<string, unknown>).motivo : entry);
    return motivo.length >= 8 ? [motivo] : [];
  });
  return { prestaciones, nota };
}
