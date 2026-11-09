export type BudgetItem = {
  label: string;
  amount: number;
  phase?: string;
  discountPercent?: number;
  /** Código del catálogo de prestaciones (7 dígitos), si la prestación se eligió o reconoció allí. */
  code?: string;
  /** Piezas FDI a las que corresponde la prestación (11–48 permanentes, 51–85 temporales). */
  teeth?: number[];
  /** Fecha (AAAA-MM-DD) en que se realizó; ausente mientras está pendiente. */
  doneOn?: string;
};

export type BudgetTotals = { subtotal: number; discount: number; total: number };

export type BudgetRelationship = {
  isAlternative: boolean;
  parentBudgetId: number | null;
};

export type BudgetRecordData = BudgetRelationship & { items: BudgetItem[] };

/**
 * Supports both the original JSON array and the versioned envelope used for
 * alternatives. The database column remains unchanged, so existing plans and
 * both deployment targets keep the same D1 schema.
 */
export function decodeBudgetData(value: string): BudgetRecordData {
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed)) {
    const items = normalizeBudgetItems(parsed);
    if (!items) throw new Error("Presupuesto almacenado con prestaciones inválidas.");
    return { items, isAlternative: false, parentBudgetId: null };
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Presupuesto almacenado con formato inválido.");
  const record = parsed as Record<string, unknown>;
  const items = normalizeBudgetItems(record.items);
  if (!items) throw new Error("Presupuesto almacenado con prestaciones inválidas.");
  const parentId = Number(record.parentBudgetId);
  const isAlternative = record.version === 1 && record.isAlternative === true
    && Number.isSafeInteger(parentId) && parentId > 0;
  return { items, isAlternative, parentBudgetId: isAlternative ? parentId : null };
}

export function encodeBudgetData(items: BudgetItem[], relationship: BudgetRelationship): string {
  const isAlternative = relationship.isAlternative
    && Number.isSafeInteger(relationship.parentBudgetId)
    && Number(relationship.parentBudgetId) > 0;
  return JSON.stringify({
    version: 1,
    items,
    isAlternative,
    parentBudgetId: isAlternative ? relationship.parentBudgetId : null,
  });
}

export function normalizeBudgetItems(value: unknown): BudgetItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const items: BudgetItem[] = [];
  let subtotal = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 180) : "";
    const amount = Number(item.amount);
    const phase = typeof item.phase === "string" ? item.phase.trim().slice(0, 80) : "";
    const discountPercent = item.discountPercent === undefined || item.discountPercent === null || item.discountPercent === ""
      ? 0 : Number(item.discountPercent);
    if (!label || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000
      || !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return null;
    subtotal += amount;
    if (!Number.isSafeInteger(subtotal) || subtotal > 1_000_000_000) return null;
    const code = typeof item.code === "string" && /^\d{7}$/.test(item.code.trim()) ? item.code.trim() : "";
    const teeth = normalizeTeeth(item.teeth);
    const doneOn = typeof item.doneOn === "string" && validIsoDate(item.doneOn) ? item.doneOn : "";
    items.push({ label, amount, ...(phase ? { phase } : {}), ...(discountPercent ? { discountPercent } : {}), ...(code ? { code } : {}), ...(teeth.length ? { teeth } : {}), ...(doneOn ? { doneOn } : {}) });
  }
  return items;
}

export function budgetTotals(items: BudgetItem[]): BudgetTotals {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const discount = items.reduce((sum, item) => sum + Math.round(item.amount * (item.discountPercent ?? 0) / 100), 0);
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

export function budgetItemTotal(item: BudgetItem): number {
  return Math.max(0, item.amount - Math.round(item.amount * (item.discountPercent ?? 0) / 100));
}

export function budgetPhases(items: BudgetItem[]): Array<{ name: string; items: BudgetItem[] }> {
  const phases = new Map<string, BudgetItem[]>();
  for (const item of items) {
    const name = item.phase?.trim() || "Etapa 1";
    phases.set(name, [...(phases.get(name) ?? []), item]);
  }
  return [...phases].map(([name, grouped]) => ({ name, items: grouped }));
}

/** Pieza FDI válida: permanentes 11–48 y temporales 51–85. */
export function validFdi(tooth: number): boolean {
  if (!Number.isInteger(tooth)) return false;
  const quadrant = Math.floor(tooth / 10), position = tooth % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeTeeth(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const teeth = value.map(Number).filter(validFdi);
  return [...new Set(teeth)].sort((a, b) => a - b).slice(0, 32);
}

/** Lee piezas escritas como «3.6, 4.6», «36 46» o «pieza 1.1». Ignora números que no son piezas FDI. */
export function parseTeethText(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/(?<![\d.,$])([1-8])[.,]?([1-8])(?![\d.,]?\d)/g)) {
    const tooth = Number(match[1]) * 10 + Number(match[2]);
    if (validFdi(tooth)) found.push(tooth);
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

/** Piezas de la prestación: las asignadas o, si no hay, las escritas con punto en el nombre («Corona 3.6»). */
export function itemTeeth(item: BudgetItem): number[] {
  if (item.teeth?.length) return item.teeth;
  const found: number[] = [];
  for (const match of item.label.matchAll(/(?<![\d.])([1-8])\.([1-8])(?![\d])/g)) {
    const tooth = Number(match[1]) * 10 + Number(match[2]);
    if (validFdi(tooth)) found.push(tooth);
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

export type BudgetProgress = {
  totalCount: number;
  doneCount: number;
  doneValue: number;
  pendingValue: number;
  paid: number;
  /** Lo realizado que aún no se ha pagado. */
  owedForDone: number;
  /** Abonos que exceden lo realizado (anticipo para lo pendiente). */
  advance: number;
  percent: number;
};

export function budgetProgress(items: BudgetItem[], paid: number): BudgetProgress {
  const done = items.filter(item => item.doneOn);
  const doneValue = done.reduce((sum, item) => sum + budgetItemTotal(item), 0);
  const total = budgetTotals(items).total;
  const pendingValue = Math.max(0, total - doneValue);
  return {
    totalCount: items.length,
    doneCount: done.length,
    doneValue,
    pendingValue,
    paid,
    owedForDone: Math.max(0, doneValue - paid),
    advance: Math.max(0, paid - doneValue),
    percent: items.length ? Math.round(done.length / items.length * 100) : 0,
  };
}

export type PlannedToothItem = { budgetId: number; budgetTitle: string; index: number; label: string; doneOn?: string };

/** Prestaciones de los planes principales agrupadas por pieza FDI (las alternativas no se muestran en el odontograma). */
export function plannedByTooth(plans: Array<{ id: number; title: string; isAlternative: boolean; items: BudgetItem[] }>): Record<number, PlannedToothItem[]> {
  const byTooth: Record<number, PlannedToothItem[]> = {};
  for (const plan of plans) {
    if (plan.isAlternative) continue;
    plan.items.forEach((item, index) => {
      for (const tooth of itemTeeth(item)) {
        (byTooth[tooth] ??= []).push({ budgetId: plan.id, budgetTitle: plan.title, index, label: item.label, ...(item.doneOn ? { doneOn: item.doneOn } : {}) });
      }
    });
  }
  return byTooth;
}
