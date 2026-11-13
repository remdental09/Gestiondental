import { anamnesisAlerts, anamnesisSummary, hasAnamnesis, type Anamnesis } from "./anamnesis.ts";
import { budgetTotals, itemTeeth, type BudgetItem } from "./budget-plans.ts";

/**
 * Resumen previo a la cita. Solo reúne y ordena lo ya registrado en la ficha: no diagnostica, no deduce y
 * no completa lo que falta. Lo no informado se muestra como «sin registrar», nunca como «niega».
 */
export type BriefNote = { id: number; clinicalDate?: string; date?: string; title: string; body: string; status?: string; diagnoses?: Array<{ title: string; tooth: number | null }> };
export type BriefBudget = { id: number; title: string; isAlternative: boolean; items: BudgetItem[] };
export type BriefPayment = { amount: number };

export type PatientBrief = {
  /** Lo que cambia la conducta clínica (alergias, anticoagulantes, enfermedades de riesgo…). */
  alerts: string[];
  /** Datos importantes que nadie ha registrado todavía. */
  gaps: string[];
  anamnesisRecorded: boolean;
  background: Array<[string, string]>;
  lastVisit: { date: string; title: string; excerpt: string; daysAgo: number | null } | null;
  recentDiagnoses: string[];
  pendingTreatments: { items: string[]; more: number };
  /** Presupuestos principales menos abonos registrados; 0 si no debe nada. */
  owed: number;
};

const EXCERPT_MAX = 220;
const PENDING_MAX = 6;
const DIAGNOSES_MAX = 4;
const NEGATIVE = /^(niega|no|sin|ninguna?|nada)\b/i;

/** Pieza FDI con punto (3.6), como pide la interfaz. */
export const fdiLabel = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const excerpt = (text: string) => { const t = collapse(text); return t.length <= EXCERPT_MAX ? t : `${t.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, "")}…`; };

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

export function buildPatientBrief(input: {
  anamnesis: Anamnesis | null;
  /** Campo antiguo de la ficha («Sin registrar» por defecto): solo se usa si no hay anamnesis. */
  legacyAllergies?: string;
  notes: BriefNote[];
  budgets: BriefBudget[];
  payments: BriefPayment[];
  /** Hoy en Chile (AAAA-MM-DD). */
  today: string;
}): PatientBrief {
  const { anamnesis, notes, budgets, payments, today } = input;
  const recorded = hasAnamnesis(anamnesis);
  const alerts = recorded ? anamnesisAlerts(anamnesis!) : [];
  const legacy = (input.legacyAllergies ?? "").trim();
  if (!recorded && legacy && !/^sin registrar$/i.test(legacy) && !NEGATIVE.test(legacy)) alerts.push(`Alergias (ficha): ${legacy}`);

  const gaps: string[] = [];
  if (!recorded) gaps.push("Anamnesis sin registrar");
  else {
    if (!anamnesis!.allergies) gaps.push("Alergias");
    if (!anamnesis!.medications) gaps.push("Medicamentos");
    if (!anamnesis!.anticoagulants) gaps.push("Anticoagulantes");
  }

  const live = notes.filter(note => note.status !== "anulada");
  const ordered = [...live].sort((a, b) => (b.clinicalDate ?? "").localeCompare(a.clinicalDate ?? "") || b.id - a.id);
  const last = ordered[0];
  const lastVisit = last ? { date: last.date ?? last.clinicalDate ?? "", title: last.title, excerpt: excerpt(last.body), daysAgo: last.clinicalDate ? daysBetween(last.clinicalDate, today) : null } : null;

  const seen = new Set<string>();
  const recentDiagnoses: string[] = [];
  for (const note of ordered) for (const diagnosis of note.diagnoses ?? []) {
    const label = `${diagnosis.title}${diagnosis.tooth ? ` (pieza ${fdiLabel(diagnosis.tooth)})` : ""}`;
    if (!diagnosis.title || seen.has(label)) continue;
    seen.add(label); recentDiagnoses.push(label);
    if (recentDiagnoses.length >= DIAGNOSES_MAX) break;
  }

  const main = budgets.filter(budget => !budget.isAlternative);
  const pending = main.flatMap(budget => budget.items.filter(item => !item.doneOn).map(item => {
    const teeth = itemTeeth(item);
    return `${item.label}${teeth.length ? ` (${teeth.map(fdiLabel).join(", ")})` : ""}`;
  }));

  const planned = main.reduce((sum, budget) => sum + budgetTotals(budget.items).total, 0);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);

  return {
    alerts, gaps, anamnesisRecorded: recorded,
    background: recorded ? anamnesisSummary(anamnesis!) : [],
    lastVisit, recentDiagnoses,
    pendingTreatments: { items: pending.slice(0, PENDING_MAX), more: Math.max(0, pending.length - PENDING_MAX) },
    owed: planned > 0 ? Math.max(0, planned - paid) : 0,
  };
}
