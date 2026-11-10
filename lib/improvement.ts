/**
 * Mejora continua: resume el uso de la app por profesional y lo que más se corrige de las propuestas del dictado.
 * Solo agregados y tipos de ítem (p. ej. «caries», «5005002 · Obturación de amalgama»): nunca texto dictado, nombres,
 * RUT ni piezas de un paciente. Lo ve solo el titular de la app.
 */
export type FeedbackRow = { owner_id: string; entries: string; created_at: string };
export type UsageRow = { owner_id: string; fichas: number; evoluciones: number; evoluciones_30d: number; ultima: string | null };
export type ClinicianLabel = { owner_id: string; label: string };

type Entry = { category?: string; outcome?: string; proposed?: Record<string, unknown>; final?: Record<string, unknown> };

const CATEGORY_LABEL: Record<string, string> = {
  odontograma: "Odontograma", diagnostico: "Diagnósticos", prestacion: "Prestaciones (arancel)", cita: "Citas", ficha: "Ficha (alergias, antecedentes)",
  periodontal: "Periodontograma", movilidad: "Movilidad", pago: "Pagos", presupuesto: "Presupuesto",
};
const CONDITION_LABEL: Record<string, string> = { caries: "caries", restored: "obturación", sealant: "sellante", other_restoration: "otra restauración", sound: "cara sana" };

const text = (value: unknown, max = 90) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Tipo del ítem, sin datos del paciente. */
export function itemKind(entry: Entry): string {
  const item = entry.proposed ?? entry.final ?? {};
  switch (entry.category) {
    case "odontograma": {
      if (item.kind === "surface") {
        const finding = item.finding as { condition?: string } | undefined;
        return `Cara con ${CONDITION_LABEL[finding?.condition ?? ""] ?? "hallazgo"}`;
      }
      if (item.kind === "crown") return "Corona";
      return text(item.status) || "Estado de la pieza";
    }
    case "diagnostico": return text(item.title) || text(item.code) || "Diagnóstico";
    case "prestacion": return `${text(item.code, 10)} · ${text(item.name, 70)}${item.objetada ? " (objetada por el revisor)" : ""}`.trim();
    case "ficha": return text(item.field) || "Dato de ficha";
    case "cita": return "Cita propuesta";
    case "pago": return "Pago propuesto";
    case "periodontal": return "Sondaje / sangrado";
    default: return CATEGORY_LABEL[entry.category ?? ""] ?? "Otro";
  }
}

export type CorrectionGroup = { category: string; label: string; total: number; corrected: number; ignored: number; rate: number; top: Array<{ kind: string; rejected: number; edited: number; added: number; ignored: number }> };
export type ClinicianUsage = { owner_id: string; label: string; fichas: number; evoluciones: number; evoluciones30d: number; dictados: number; ultima: string | null; aceptacion: number | null; groups: CorrectionGroup[]; aprendido: string[] };

function groupsOf(entries: Entry[]): CorrectionGroup[] {
  const byCategory = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry.category) continue;
    byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
  }
  return [...byCategory.entries()].map(([category, list]) => {
    const kinds = new Map<string, { rejected: number; edited: number; added: number; ignored: number }>();
    for (const entry of list) {
      if (entry.outcome === "aceptado") continue;
      const key = itemKind(entry);
      const current = kinds.get(key) ?? { rejected: 0, edited: 0, added: 0, ignored: 0 };
      if (entry.outcome === "rechazado") current.rejected++;
      else if (entry.outcome === "ignorado") current.ignored++;
      else if (entry.outcome === "editado") current.edited++;
      else if (entry.outcome === "agregado") current.added++;
      kinds.set(key, current);
    }
    // «Ignorado» (una sugerencia que venía desmarcada y no se tomó) no es una corrección del profesional: se cuenta aparte.
    const ignored = list.filter((entry) => entry.outcome === "ignorado").length;
    const corrected = list.filter((entry) => entry.outcome !== "aceptado" && entry.outcome !== "ignorado").length;
    return {
      category, label: CATEGORY_LABEL[category] ?? category, total: list.length, corrected, ignored,
      rate: list.length ? corrected / list.length : 0,
      top: [...kinds.entries()].map(([kind, counts]) => ({ kind, ...counts })).sort((a, b) => (b.rejected + b.edited + b.added + b.ignored) - (a.rejected + a.edited + a.added + a.ignored)).slice(0, 6),
    };
  }).sort((a, b) => (b.corrected + b.ignored) - (a.corrected + a.ignored));
}

const parseEntries = (raw: string): Entry[] => { try { const value = JSON.parse(raw); return Array.isArray(value) ? value as Entry[] : []; } catch { return []; } };

/** Resumen por profesional y general. */
export function summarizeImprovement(feedback: FeedbackRow[], usage: UsageRow[], labels: ClinicianLabel[], learnedOf: (rows: FeedbackRow[]) => string[] = () => []): { clinicians: ClinicianUsage[]; overall: CorrectionGroup[]; dictados: number } {
  const owners = new Set([...usage.map((row) => row.owner_id), ...feedback.map((row) => row.owner_id)]);
  const all: Entry[] = [];
  const clinicians: ClinicianUsage[] = [...owners].map((owner) => {
    const rows = feedback.filter((row) => row.owner_id === owner);
    const entries = rows.flatMap((row) => parseEntries(row.entries));
    all.push(...entries);
    const used = usage.find((row) => row.owner_id === owner);
    const accepted = entries.filter((entry) => entry.outcome === "aceptado").length;
    const proposed = entries.filter((entry) => entry.outcome !== "agregado" && entry.outcome !== "ignorado").length;
    const lastFeedback = rows.map((row) => row.created_at).sort().pop() ?? null;
    const ultima = [used?.ultima ?? null, lastFeedback].filter(Boolean).sort().pop() ?? null;
    return {
      owner_id: owner, label: labels.find((item) => item.owner_id === owner)?.label ?? "Colega sin perfil",
      fichas: used?.fichas ?? 0, evoluciones: used?.evoluciones ?? 0, evoluciones30d: used?.evoluciones_30d ?? 0,
      dictados: rows.length, ultima, aceptacion: proposed ? accepted / proposed : null, groups: groupsOf(entries), aprendido: learnedOf(rows.slice(0, 400)),
    };
  }).sort((a, b) => (b.ultima ?? "").localeCompare(a.ultima ?? ""));
  return { clinicians, overall: groupsOf(all), dictados: feedback.length };
}
