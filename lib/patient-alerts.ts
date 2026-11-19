/**
 * Alertas siempre visibles de la ficha (como «Alertas médicas» / «Alertas administrativas» de Dentalsoft).
 * Las médicas se derivan de la anamnesis y de alergias/antecedentes de la ficha, más las que el profesional agrega;
 * las administrativas son manuales, más el saldo de prestaciones ya realizadas sin pagar.
 * Lógica pura: nunca convierte algo negado («niega diabetes») en alerta.
 */
import { anamnesisAlerts, type Anamnesis } from "./anamnesis.ts";
import { budgetProgress, type BudgetItem } from "./budget-plans.ts";

export type AlertKind = "medica" | "administrativa";
export type ManualAlert = { id: number; kind: AlertKind; text: string; updatedAt?: string };
export type DerivedAlert = { key: string; text: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const NONE = /^(sin registrar|sin alergias?( conocidas)?|niega( alergias?)?|ninguna|no|no refiere|no tiene|nada|—|-)\.?$/i;

/** Antecedentes de riesgo que se buscan en texto libre (historia, otras enfermedades, medicamentos). */
const RISKS: Array<[string, string, RegExp]> = [
  ["anticoag", "Usa anticoagulantes / antiagregantes", /\b(anticoagula\w*|antiagrega\w*|acenocumarol|neosintrom|warfarina|rivaroxaban|xarelto|apixaban|eliquis|dabigatran|pradaxa|clopidogrel|aspirina|acido acetilsalicilico)\b/],
  ["diabetes", "Diabetes", /\b(diabet\w*|insulina|metformina)\b/],
  ["embarazo", "Embarazo", /\b(embarazada|embarazo|gestante|semanas de gestacion)\b/],
  ["marcapasos", "Marcapasos", /\b(marcapasos?|desfibrilador)\b/],
  ["bifosfonatos", "Bifosfonatos (riesgo de osteonecrosis)", /\b(bifosfonat\w*|bisfosfonat\w*|alendronato|risedronato|ibandronato|zoledronato|acido zoledronico|denosumab)\b/],
  ["hipertension", "Hipertensión arterial", /\b(hipertens\w*|presion alta)\b/],
  ["endocarditis", "Riesgo de endocarditis / prótesis valvular", /\b(endocarditis|protesis valvular|valvula (cardiaca|mecanica)|valvulopatia|fiebre reumatica)\b/],
  ["coagulacion", "Trastorno de coagulación", /\b(hemofilia|von willebrand|trastorno de (la )?coagulacion)\b/],
  ["epilepsia", "Epilepsia", /\b(epilep\w*|convulsion\w*)\b/],
];
/** Mismas alertas que trae la anamnesis estructurada, para no repetirlas con otra redacción. */
const ANAMNESIS_KEYS: Record<string, string> = {
  "Usa anticoagulantes / antiagregantes": "anticoag", "Diabetes": "diabetes", "Embarazo": "embarazo", "Hipertensión arterial": "hipertension",
  "Prótesis valvular / endocarditis / fiebre reumática": "endocarditis", "Trastorno de coagulación / sangrado": "coagulacion", "Osteoporosis / bifosfonatos": "bifosfonatos",
};

/** ¿La mención está negada en su frase? («niega diabetes», «no es diabético», «sin anticoagulantes»). */
function negated(sentence: string, index: number): boolean {
  const before = sentence.slice(Math.max(0, index - 30), index);
  return /\b(niega|no|sin|nunca|descarta|descartado|tampoco|ni)\b[^,;]*$/.test(before);
}

/** Alertas médicas automáticas, sin duplicados. */
export function deriveMedicalAlerts(input: { anamnesis?: Anamnesis | null; allergies?: string; history?: string }): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const seen = new Set<string>();
  const push = (key: string, text: string) => { if (!seen.has(key)) { seen.add(key); out.push({ key, text }); } };
  const a = input.anamnesis;
  const allergyFromAnamnesis = a?.allergies && !/^(niega|no|sin|ninguna)\b/i.test(a.allergies.trim()) ? a.allergies.trim() : "";
  const legacyAllergy = input.allergies?.trim() && !NONE.test(input.allergies.trim()) && !/^(niega|sin)\b/i.test(input.allergies.trim()) ? input.allergies.trim() : "";
  if (allergyFromAnamnesis || legacyAllergy) push("alergia", `Alergia: ${allergyFromAnamnesis || legacyAllergy}`.slice(0, 160));
  if (a) for (const text of anamnesisAlerts(a)) {
    if (text.startsWith("Alergias:")) continue;
    push(ANAMNESIS_KEYS[text] ?? fold(text), text);
  }
  if (a?.conditions.includes("epilepsia")) push("epilepsia", "Epilepsia");
  const free = [input.history ?? "", a?.otherConditions ?? "", a?.medications ?? "", a?.observations ?? ""].join(". ");
  for (const sentence of fold(free).split(/[.;\n]+/)) {
    for (const [key, text, re] of RISKS) {
      const m = re.exec(sentence);
      if (m && !negated(sentence, m.index)) push(key, text);
    }
  }
  return out;
}

const money = (n: number) => "$" + n.toLocaleString("es-CL");

/** Alertas administrativas automáticas: prestaciones realizadas que aún no se pagan. */
export function deriveAdminAlerts(budgets: Array<{ id: number; isAlternative: boolean; items: BudgetItem[]; title?: string }>, payments: Array<{ budgetId: number | null; amount: number }>): DerivedAlert[] {
  let owed = 0;
  for (const plan of budgets) {
    if (plan.isAlternative) continue;
    const paid = payments.filter(payment => payment.budgetId === plan.id).reduce((sum, payment) => sum + payment.amount, 0);
    owed += budgetProgress(plan.items, paid).owedForDone;
  }
  return owed > 0 ? [{ key: "saldo", text: `Saldo pendiente ${money(owed)} por prestaciones realizadas` }] : [];
}

export const ALERT_TEXT_MAX = 280;
export const normalizeAlertText = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, ALERT_TEXT_MAX) : "");
export const normalizeAlertKind = (value: unknown): AlertKind | null => (value === "medica" || value === "administrativa" ? value : null);
