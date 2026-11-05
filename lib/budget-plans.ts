export type BudgetItem = {
  label: string;
  amount: number;
  phase?: string;
  discountPercent?: number;
};

export type BudgetTotals = { subtotal: number; discount: number; total: number };

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
    items.push({ label, amount, ...(phase ? { phase } : {}), ...(discountPercent ? { discountPercent } : {}) });
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
