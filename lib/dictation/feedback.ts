// Registro de correcciones del profesional: qué propuso el sistema y qué quedó al guardar.
// Sirve como material real para mejorar reglas, ejemplos del modelo y un conjunto de pruebas.

export type FeedbackCategory = "odontograma" | "presupuesto" | "ficha" | "periodontal" | "movilidad" | "pago" | "cita" | "diagnostico";
export type FeedbackOutcome = "aceptado" | "editado" | "rechazado" | "agregado";

export type FeedbackEntry = {
  category: FeedbackCategory;
  id: string;
  outcome: FeedbackOutcome;
  /** Lo que propuso el sistema (sin campos de pantalla). Ausente si el profesional lo agregó a mano. */
  proposed?: Record<string, unknown>;
  /** Lo que quedó al guardar (solo si fue aceptado, editado o agregado). */
  final?: Record<string, unknown>;
  origin?: string;
};

// Campos que solo existen para la pantalla de revisión y no cuentan como edición.
const SCREEN_ONLY = new Set(["decision", "toothText", "amountText", "methodValue", "budgetId", "dayValue", "timeValue", "codeSearch", "findingsText", "incompleteCaries", "depthText"]);

function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SCREEN_ONLY.has(key) || typeof entry === "function") continue;
    out[key] = entry;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type ReviewGroup = {
  category: FeedbackCategory;
  proposed: Array<{ id?: string } & Record<string, unknown>>;
  /** Estado final de la pantalla: cada ítem con su decisión. */
  final: Array<{ id?: string; decision?: string } & Record<string, unknown>>;
};

/** Compara lo propuesto con lo que quedó. Un ítem editado es uno aceptado cuyos datos cambiaron. */
export function buildFeedback(groups: ReviewGroup[]): FeedbackEntry[] {
  const entries: FeedbackEntry[] = [];
  for (const group of groups) {
    const used = new Set<number>();
    group.proposed.forEach((item, index) => {
      const id = String(item.id ?? `${group.category}-${index}`);
      const matchIndex = group.final.findIndex((entry, at) => !used.has(at) && (entry.id !== undefined ? String(entry.id) === id : at === index));
      const origin = typeof item.origin === "string" ? item.origin : undefined;
      const proposed = plain(item);
      if (matchIndex < 0) { entries.push({ category: group.category, id, outcome: "rechazado", proposed, origin }); return; }
      used.add(matchIndex);
      const now = group.final[matchIndex];
      if (now.decision !== "accepted") { entries.push({ category: group.category, id, outcome: "rechazado", proposed, origin }); return; }
      const final = plain(now);
      entries.push({ category: group.category, id, outcome: same(proposed, final) ? "aceptado" : "editado", proposed, final, origin });
    });
    group.final.forEach((now, at) => {
      if (used.has(at) || now.decision !== "accepted") return;
      entries.push({ category: group.category, id: String(now.id ?? `${group.category}-extra-${at}`), outcome: "agregado", final: plain(now), origin: "manual" });
    });
  }
  return entries;
}

export function feedbackSummary(entries: FeedbackEntry[]) {
  const count = (outcome: FeedbackOutcome) => entries.filter((entry) => entry.outcome === outcome).length;
  return { accepted: count("aceptado"), edited: count("editado"), rejected: count("rechazado"), added: count("agregado") };
}
