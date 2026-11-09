export type YesNo = "" | "si" | "no";

export const CONDITIONS = [
  ["hipertension", "Hipertensión arterial"], ["diabetes", "Diabetes"], ["cardiopatia", "Enfermedad cardíaca"],
  ["valvular", "Prótesis valvular / endocarditis / fiebre reumática"], ["asma", "Asma / enfermedad respiratoria"],
  ["epilepsia", "Epilepsia / convulsiones"], ["hepatitis", "Hepatitis / enfermedad hepática"], ["renal", "Enfermedad renal"],
  ["tiroides", "Enfermedad de tiroides"], ["coagulacion", "Trastorno de coagulación / sangrado"], ["osteoporosis", "Osteoporosis / bifosfonatos"],
  ["cancer", "Cáncer / quimio o radioterapia"], ["inmuno", "Inmunosupresión / VIH"], ["psiquiatrica", "Condición psiquiátrica"],
  ["gastrica", "Gastritis / reflujo / úlcera"], ["autoinmune", "Enfermedad autoinmune"],
] as const;
export type ConditionId = typeof CONDITIONS[number][0];
const CONDITION_IDS = new Set<string>(CONDITIONS.map(([id]) => id));

export type Anamnesis = {
  allergies: string;            // medicamentos, látex, anestésicos, alimentos…
  medications: string;          // fármacos de uso habitual
  anticoagulants: YesNo;        // anticoagulantes/antiagregantes
  conditions: ConditionId[];
  otherConditions: string;
  surgeries: string;
  hospitalizations: string;
  anesthesiaReactions: string;
  pregnancy: "" | "no" | "embarazada" | "lactancia" | "no-aplica";
  smoking: string;
  alcohol: string;
  bruxism: YesNo;
  gumBleeding: YesNo;
  lastDentalVisit: string;
  dentalHistory: string;        // trauma, ortodoncia, cirugías orales, sensibilidad, molestias
  observations: string;
  updatedAt?: string;
};

export const ANAMNESIS_LIMITS = { short: 300, long: 2000 } as const;
const text = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
const yn = (v: unknown): YesNo => v === "si" || v === "no" ? v : "";

export const emptyAnamnesis = (): Anamnesis => ({
  allergies: "", medications: "", anticoagulants: "", conditions: [], otherConditions: "", surgeries: "", hospitalizations: "",
  anesthesiaReactions: "", pregnancy: "", smoking: "", alcohol: "", bruxism: "", gumBleeding: "", lastDentalVisit: "", dentalHistory: "", observations: "",
});

export function normalizeAnamnesis(input: unknown): Anamnesis {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const { short, long } = ANAMNESIS_LIMITS;
  const conditions = Array.isArray(r.conditions)
    ? [...new Set(r.conditions.filter((c): c is ConditionId => typeof c === "string" && CONDITION_IDS.has(c)))] : [];
  const pregnancy = ["no", "embarazada", "lactancia", "no-aplica"].includes(r.pregnancy as string) ? r.pregnancy as Anamnesis["pregnancy"] : "";
  return {
    allergies: text(r.allergies, long), medications: text(r.medications, long), anticoagulants: yn(r.anticoagulants), conditions,
    otherConditions: text(r.otherConditions, long), surgeries: text(r.surgeries, long), hospitalizations: text(r.hospitalizations, long),
    anesthesiaReactions: text(r.anesthesiaReactions, short), pregnancy, smoking: text(r.smoking, short), alcohol: text(r.alcohol, short),
    bruxism: yn(r.bruxism), gumBleeding: yn(r.gumBleeding), lastDentalVisit: text(r.lastDentalVisit, short),
    dentalHistory: text(r.dentalHistory, long), observations: text(r.observations, long),
  };
}

/** Une una propuesta dictada con lo ya registrado: lo dictado completa y no borra lo anterior. */
export function mergeAnamnesis(current: Anamnesis, patch: Anamnesis): Anamnesis {
  const join = (a: string, b: string) => !b ? a : !a ? b : a.toLowerCase().includes(b.toLowerCase()) ? a : `${a}. ${b}`;
  return {
    ...current,
    allergies: join(current.allergies, patch.allergies), medications: join(current.medications, patch.medications),
    anticoagulants: patch.anticoagulants || current.anticoagulants,
    conditions: [...new Set([...current.conditions, ...patch.conditions])],
    otherConditions: join(current.otherConditions, patch.otherConditions), surgeries: join(current.surgeries, patch.surgeries),
    hospitalizations: join(current.hospitalizations, patch.hospitalizations), anesthesiaReactions: join(current.anesthesiaReactions, patch.anesthesiaReactions),
    pregnancy: patch.pregnancy || current.pregnancy, smoking: patch.smoking || current.smoking, alcohol: patch.alcohol || current.alcohol,
    bruxism: patch.bruxism || current.bruxism, gumBleeding: patch.gumBleeding || current.gumBleeding,
    lastDentalVisit: patch.lastDentalVisit || current.lastDentalVisit, dentalHistory: join(current.dentalHistory, patch.dentalHistory),
    observations: join(current.observations, patch.observations),
  };
}

export const hasAnamnesis = (a: Anamnesis | null | undefined) => !!a && JSON.stringify({ ...a, updatedAt: "" }) !== JSON.stringify({ ...emptyAnamnesis(), updatedAt: "" });

/** Datos que cambian la conducta clínica: se destacan en rojo arriba de la ficha. */
export function anamnesisAlerts(a: Anamnesis): string[] {
  const out: string[] = [];
  if (a.allergies && !/^(niega|no|sin|ninguna)\b/i.test(a.allergies)) out.push(`Alergias: ${a.allergies}`);
  if (a.anticoagulants === "si") out.push("Usa anticoagulantes / antiagregantes");
  for (const id of ["coagulacion", "valvular", "inmuno", "osteoporosis", "cancer", "diabetes", "cardiopatia", "hipertension"] as const)
    if (a.conditions.includes(id)) out.push(CONDITIONS.find(([c]) => c === id)![1]);
  if (a.pregnancy === "embarazada") out.push("Embarazo");
  if (a.anesthesiaReactions) out.push(`Reacción a anestesia: ${a.anesthesiaReactions}`);
  return out;
}

const PREGNANCY: Record<string, string> = { no: "No", embarazada: "Embarazada", lactancia: "En lactancia", "no-aplica": "No aplica" };

/** Líneas legibles «etiqueta → valor» solo de lo registrado, para la vista rápida al pasar el mouse. */
export function anamnesisSummary(a: Anamnesis): Array<[string, string]> {
  const yes = (v: YesNo) => v === "si" ? "Sí" : v === "no" ? "No" : "";
  const rows: Array<[string, string]> = [
    ["Alergias", a.allergies], ["Medicamentos", a.medications], ["Anticoagulantes", yes(a.anticoagulants)],
    ["Enfermedades", [...a.conditions.map(id => CONDITIONS.find(([c]) => c === id)?.[1] ?? ""), a.otherConditions].filter(Boolean).join(", ")],
    ["Cirugías", a.surgeries], ["Hospitalizaciones", a.hospitalizations], ["Reacciones a anestesia", a.anesthesiaReactions],
    ["Embarazo / lactancia", PREGNANCY[a.pregnancy] ?? ""], ["Tabaco", a.smoking], ["Alcohol", a.alcohol],
    ["Bruxismo", yes(a.bruxism)], ["Sangrado de encías", yes(a.gumBleeding)], ["Última visita dental", a.lastDentalVisit],
    ["Antecedentes odontológicos", a.dentalHistory], ["Observaciones", a.observations],
  ];
  return rows.filter(([, v]) => v);
}
