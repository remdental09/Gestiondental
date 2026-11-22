/**
 * Dictado por pieza: «planificar» o «ya realizado hoy». Lo realizado no queda como plan: cambia el odontograma, la evolución
 * dice «procedimiento realizado» y la prestación se cierra en el presupuesto (la que ya estaba pendiente, o una nueva ya hecha).
 * Lógica pura, sin red.
 */
import type { BudgetItem } from "./budget-plans.ts";
import type { OdontogramSurface, SurfaceFinding } from "../app/clinical-data.ts";

export type DictationMode = "plan" | "done";

/** Frases con las que el clínico dicta algo que ya hizo, aunque haya elegido «planificar». */
export function looksPerformed(text: string): boolean {
  return /(?<!\p{L})(?:se (?:realiz[oó]|hizo|coloc[oó]|obtur[oó]|restaur[oó]|extrajo|instal[oó])|(?:realic[eé]|hice|hicimos|coloqu[eé]|obtur[eé]|restaur[eé]|extraje|instal[eé])|(?:ya )?(?:se )?(?:realizó|hice) hoy|se realizar[aá] hoy|hoy (?:se )?(?:realiz|hice|hicimos|coloc|obtur))(?!\p{L})/iu.test(text);
}

const strip = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["se", "una", "un", "de", "del", "la", "el", "en", "con", "y", "para", "por", "pieza", "diente", "hoy", "realizar", "realizo", "realizara", "proponera", "propondra", "planificara", "sera", "al", "los", "las", "a", "e", "fase", "numero", "realizo", "realizado", "realizada", "dentaria", "dentario", "tratamiento", "seguida", "seguido"]);
const tokens = (label: string) => [...new Set(strip(label).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(word => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word)))];
/** ¿Son la misma prestación? Mismo código de catálogo, o palabras clave suficientemente compartidas. */
export function sameTreatment(a: Pick<BudgetItem, "label" | "code">, b: Pick<BudgetItem, "label" | "code">): boolean {
  if (a.code && b.code) return a.code === b.code;
  const ta = tokens(a.label), tb = tokens(b.label);
  if (!ta.length || !tb.length) return false;
  const shared = ta.filter(word => tb.includes(word)).length;
  // Lo realizado puede ser una parte de un plan dictado en una sola línea («eliminación de caries, seguida de una pulpectomía y trepanación»):
  // si todas sus palabras clave están en la otra y hay una prestación específica (palabra larga), es la misma.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length && short.every(word => long.includes(word)) && short.some(word => word.length >= 8)) return true;
  return shared / Math.min(ta.length, tb.length) >= 0.7 && shared >= 2;
}

export type BudgetView = { id: number; items: BudgetItem[]; isAlternative?: boolean };
export type Settled = { updates: { budgetId: number; items: BudgetItem[] }[]; remaining: BudgetItem[]; closed: { budgetId: number; label: string }[] };

/**
 * Cierra en los presupuestos existentes las prestaciones pendientes de esta pieza que coinciden con lo realizado
 * (una por cada realizada) y devuelve lo que no tenía plan previo, ya marcado como realizado.
 */
export function settlePerformed(budgets: BudgetView[], tooth: number, performed: BudgetItem[], today: string): Settled {
  const working = budgets.map(budget => ({ id: budget.id, alt: Boolean(budget.isAlternative), items: budget.items.map(item => ({ ...item })), touched: false }));
  const remaining: BudgetItem[] = [], closed: Settled["closed"] = [];
  for (const item of performed) {
    const done: BudgetItem = { ...item, ...(item.startedOn ? {} : { startedOn: today }), doneOn: item.doneOn ?? today };
    let matched = false;
    // Los más recientes primero: el plan vigente es el último que se dictó.
    for (const budget of [...working].sort((x, y) => y.id - x.id)) {
      if (budget.alt || matched) continue;
      const at = budget.items.findIndex(existing => !existing.doneOn && (existing.teeth ?? []).includes(tooth) && sameTreatment(existing, item));
      if (at < 0) continue;
      const { status: _s, ...rest } = budget.items[at];
      budget.items[at] = { ...rest, ...(rest.startedOn ? {} : { startedOn: today }), doneOn: today };
      budget.touched = true; matched = true;
      closed.push({ budgetId: budget.id, label: budget.items[at].label });
    }
    if (!matched) remaining.push(done);
  }
  return { updates: working.filter(budget => budget.touched).map(budget => ({ budgetId: budget.id, items: budget.items })), remaining, closed };
}

type Op = { kind: "status"; status: string } | { kind: "surface"; surface: OdontogramSurface; finding: SurfaceFinding } | { kind: "crown"; material: string } | { kind: "diagnosis"; title: string; detail: string };
const keyOf = (op: Op) => op.kind === "surface" ? `surface:${op.surface}` : op.kind;
/** Une los cambios del diagnóstico con los de lo realizado; si tocan lo mismo, gana lo realizado (la caries pasa a obturación). */
export function mergeOperations<T extends Op>(diagnosis: T[], performed: T[]): T[] {
  const performedKeys = new Set(performed.map(keyOf));
  return [...diagnosis.filter(op => op.kind === "diagnosis" || !performedKeys.has(keyOf(op))), ...performed];
}

const FACE_WORDS: [RegExp, OdontogramSurface][] = [[/oclusal|incisal/, "O"], [/mesial/, "M"], [/distal/, "D"], [/vestibular/, "V"], [/palatin|lingual/, "P"]];
const MATERIALS: [RegExp, SurfaceFinding["restorationMaterial"]][] = [[/ionomero/, "Vidrio ionómero"], [/amalgama/, "Amalgama"], [/cavit/, "Cavit"], [/\birm\b/, "IRM"], [/eugenato/, "Eugenato"], [/composite|resina/, "Resina compuesta"]];
/**
 * Respaldo determinista: «obturación oclusal de composite» → cara O obturada con resina compuesta.
 * Solo actúa cuando el texto habla de obturar/restaurar y nombra la cara; si no, no inventa nada.
 */
export function restoredSurfacesFrom(text: string): { surface: OdontogramSurface; finding: SurfaceFinding }[] {
  const t = strip(text);
  if (!/obtur|restaur|composite|resina|ionomero|amalgama/.test(t)) return [];
  if (/(?:sin|no) (?:se )?(?:obtur|restaur)/.test(t)) return [];
  const material = MATERIALS.find(([pattern]) => pattern.test(t))?.[1];
  const stage = material === "Cavit" || material === "IRM" || material === "Eugenato" ? "provisional" : "definitive";
  return FACE_WORDS.filter(([pattern]) => pattern.test(t)).map(([, surface]) => ({
    surface,
    finding: { condition: "restored", depth: null, icdas: null, activity: null, ...(material ? { restorationMaterial: material, restorationStage: stage } : {}) } as SurfaceFinding,
  }));
}
