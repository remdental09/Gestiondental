/**
 * Contexto de una evolución para el riel de herramientas (Dictar, Presup., Realizado, Cobrar, Control, Cita, Receta):
 * qué piezas trata, qué diagnóstico registra y qué prestaciones de los presupuestos abiertos le corresponden.
 * Sin efectos: la página usa esto para abrir cada sección real ya con el paciente y la pieza elegidos.
 */
import { itemStatus, itemTeeth, type BudgetItem, type ItemStatus } from "./budget-plans.ts";
import { formatFdiTooth } from "./tooth-numbering.ts";
import { teethOfNote } from "./tooth-evolution-milestones.ts";

export type RailNote = { title: string; body: string; diagnoses?: Array<{ title: string; tooth: number | null; code?: string }> };
export type RailBudget = { id: number; title: string; items: BudgetItem[] };
export type RailItem = { budgetId: number; budgetTitle: string; index: number; label: string; status: ItemStatus; teeth: number[] };

const VALID = (tooth: number) => { const q = Math.floor(tooth / 10), p = tooth % 10; return q >= 1 && q <= 8 && p >= 1 && p <= (q >= 5 ? 5 : 8); };

/** Piezas FDI de la evolución: las de sus diagnósticos, las que nombra su título («… 2.8») y «pieza 28» / «pieza 2.8» escrito. */
export function evolutionTeeth(note: RailNote): number[] {
  const found = new Set<number>();
  for (const diagnosis of note.diagnoses ?? []) if (diagnosis.tooth !== null && VALID(diagnosis.tooth)) found.add(diagnosis.tooth);
  for (const tooth of teethOfNote(note)) found.add(tooth);
  for (const match of `${note.title}\n${note.body}`.matchAll(/\bpiezas?\s+(?:n[°º.]?\s*)?([1-8])\.?([1-8])(?!\d)/gi)) {
    const tooth = Number(match[1]) * 10 + Number(match[2]);
    if (VALID(tooth)) found.add(tooth);
  }
  return [...found].sort((a, b) => a - b);
}

/** Diagnóstico de la evolución para la receta («Pericoronaritis (pieza 2.8); …»); vacío si no registró ninguno. */
export function evolutionDiagnosis(note: RailNote): string {
  const structured = evolutionStructuredDiagnosis(note);
  if (structured) return structured;
  // Sin diagnósticos codificados: la línea «Diagnóstico: …» escrita en la evolución.
  const line = /^\s*diagn[oó]stico\s*:\s*(.+)$/im.exec(note.body)?.[1]?.trim() ?? "";
  return line.slice(0, 800);
}
function evolutionStructuredDiagnosis(note: RailNote): string {
  return (note.diagnoses ?? []).filter(d => d.title.trim()).map(d => `${d.title.trim()}${d.tooth !== null && VALID(d.tooth) ? ` (pieza ${formatFdiTooth(d.tooth)})` : ""}`).join("; ").slice(0, 800);
}

export const teethLabel = (teeth: number[]) => teeth.length ? `${teeth.length === 1 ? "pieza" : "piezas"} ${teeth.map(formatFdiTooth).join(", ")}` : "";

/** Prestaciones de los presupuestos abiertos que tocan las piezas de la evolución (en el orden de los presupuestos). */
export function evolutionItems(budgets: RailBudget[], teeth: number[]): RailItem[] {
  if (!teeth.length) return [];
  const wanted = new Set(teeth);
  return budgets.flatMap(budget => budget.items.map((item, index) => ({ item, index })).filter(({ item }) => itemTeeth(item).some(t => wanted.has(t)))
    .map(({ item, index }) => ({ budgetId: budget.id, budgetTitle: budget.title, index, label: item.label, status: itemStatus(item), teeth: itemTeeth(item) })));
}

/** Las que aún no están terminadas (lo que «Realizado» puede marcar). */
export const pendingItems = (items: RailItem[]) => items.filter(item => item.status === "pendiente" || item.status === "iniciada");

/** Prestación lista para agregar al presupuesto desde la evolución: el diagnóstico (o el título) con sus piezas. */
export function draftItemFor(note: RailNote, teeth: number[]): BudgetItem {
  const dx = (note.diagnoses ?? []).find(d => d.title.trim() && (d.tooth === null || teeth.includes(d.tooth)));
  const base = (dx?.title ?? note.title ?? "").replace(/\s*[·-]\s*FDI\s+[\d.,\s]+$/i, "").trim().slice(0, 120);
  return { label: base, amount: 0, phase: "Fase 1", discountPercent: 0, ...(teeth.length ? { teeth } : {}) };
}
