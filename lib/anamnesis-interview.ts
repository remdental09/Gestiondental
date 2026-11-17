import { emptyAnamnesis, normalizeAnamnesis, type Anamnesis, type ConditionId } from "./anamnesis.ts";

/** Campos del formulario que la IA puede marcar como dudosos (se destacan en ámbar para que el clínico los revise). */
export const ANAMNESIS_FIELDS = Object.keys(emptyAnamnesis()) as Array<keyof Anamnesis>;
export type InterviewTurn = { speaker: "dentista" | "paciente"; text: string };
export type InterviewResult = { anamnesis: Anamnesis; doubtful: Array<keyof Anamnesis>; turns: InterviewTurn[]; fallback?: boolean };

const FIELD_SET = new Set<string>(ANAMNESIS_FIELDS.filter(f => f !== "updatedAt"));

/** Filtra la respuesta de la IA para la entrevista: solo campos del esquema, dudosos que existan y turnos con hablante válido. */
export function normalizeInterview(input: unknown): InterviewResult {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const anamnesis = normalizeAnamnesis(r.anamnesis ?? r);
  const filled = (f: keyof Anamnesis) => { const v = anamnesis[f]; return Array.isArray(v) ? v.length > 0 : !!v; };
  const doubtful = Array.isArray(r.doubtful)
    ? [...new Set(r.doubtful.filter((f): f is keyof Anamnesis => typeof f === "string" && FIELD_SET.has(f)))].filter(filled) : [];
  const turns = Array.isArray(r.turns) ? r.turns.flatMap((t): InterviewTurn[] => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const speaker = o.speaker === "dentista" || o.speaker === "paciente" ? o.speaker : null;
    const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim().slice(0, 1_000) : "";
    return speaker && text ? [{ speaker, text }] : [];
  }).slice(0, 200) : [];
  return { anamnesis, doubtful, turns };
}

// ---------------------------------------------------------------------------------------------
// Ordenamiento local (sin IA): respaldo cuando OpenAI falla. Conservador: solo frases explícitas,
// y todo lo que encuentra queda marcado como dudoso para que el clínico lo confirme.
// ---------------------------------------------------------------------------------------------

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const QUESTION = /\?\s*$|^\s*¿/;
/** Separa en frases y une cada respuesta con la pregunta que la antecede (el tema suele estar en la pregunta del dentista: «¿Alergias? No, ninguna»). Las preguntas por sí solas no son afirmaciones del paciente. */
const answers = (text: string) => {
  const out: Array<{ raw: string; topic: string }> = [];
  let topic = "";
  for (const part of text.replace(/([.!?;])\s+/g, "$1\n").split("\n").map(p => p.trim()).filter(Boolean)) {
    if (QUESTION.test(part)) { topic = part; continue; }
    out.push({ raw: part, topic }); topic = "";
  }
  return out;
};
const DENIAL = /^(no|nada|ninguna?|niego|tampoco|nunca)\b/;
const YES = /^(si|sip|claro|correcto|efectivamente)\b/;

const CONDITION_WORDS: Array<[ConditionId, RegExp]> = [
  ["hipertension", /hipertens|presion alta/], ["diabetes", /diabet|insulina/], ["cardiopatia", /cardiopat|infarto|arritmia|marcapaso|enfermedad (del )?corazon|problema(s)? (al|del) corazon/],
  ["valvular", /valvul|endocarditis|fiebre reumatica/], ["asma", /\basma|epoc|bronquitis cronica/], ["epilepsia", /epileps|convulsi/],
  ["hepatitis", /hepatitis|cirrosis|higado graso/], ["renal", /renal|dialisis|rinon/], ["tiroides", /tiroid|hipotiroid|hipertiroid/],
  ["coagulacion", /hemofilia|coagulacion|sangra mucho/], ["osteoporosis", /osteoporosis|bifosfonat|alendronato/], ["cancer", /cancer|quimio|radioterapia|tumor/],
  ["inmuno", /\bvih\b|inmunosupres|trasplante/], ["psiquiatrica", /depresion|ansiedad|bipolar|esquizofren/], ["gastrica", /gastritis|reflujo|ulcera/],
  ["autoinmune", /lupus|artritis reumatoide|autoinmune/],
];

/** Orden local de un dictado o entrevista transcrita en los campos del formulario. Nunca inventa: si no encuentra una frase explícita, deja el campo vacío. */
export function localAnamnesisFromText(text: string): InterviewResult {
  const a = emptyAnamnesis();
  const add = (key: "allergies" | "medications" | "surgeries" | "dentalHistory" | "otherConditions" | "hospitalizations", value: string) => {
    const v = value.trim().replace(/[.,;]+$/, "");
    if (v && !strip(a[key]).includes(strip(v))) a[key] = a[key] ? `${a[key]}. ${v}` : v;
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const { raw, topic } of answers(text)) {
    const ans = strip(raw);
    // Respuesta corta («sí», «no, ninguna»): el tema lo da la pregunta. Respuesta con contenido propio: solo cuenta lo que dijo el paciente.
    const short = YES.test(ans) || DENIAL.test(ans) || ans.split(/\s+/).length <= 3;
    const s = short ? `${ans} ${strip(topic)}` : ans;
    const neg = DENIAL.test(ans) || /\bniega\b/.test(ans);
    // Alergias
    const allergy = raw.match(/al[ée]rgic[oa]s?\s+(?:a|al|a la|a los)\s+([^.,;]+)/i) ?? raw.match(/alergia\s+(?:a|al|a la)\s+([^.,;]+)/i);
    if (allergy && !neg) add("allergies", cap(allergy[1]));
    else if (/alergi|alergic/.test(s) && neg) add("allergies", "Niega alergias");
    // Medicamentos con dosis (mg, mcg, ui, puff, inhalador)
    const meds = [...raw.matchAll(/([A-Za-zÁÉÍÓÚáéíóúñÑ]{4,})\s+(\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ui|ml)\b(?:[^.;,]*?(?:cada|c\/)\s*\d+\s*(?:horas|h)\b)?)/gi)];
    if (!neg) for (const m of meds) add("medications", `${cap(m[1])} ${m[2].replace(/\s+/g, " ")}`);
    if (/(no toma|no tomo|ningun) (ningun )?(medicamento|remedio)/.test(s) || (/medicament|remedio/.test(s) && DENIAL.test(s))) add("medications", "Niega medicamentos");
    // Anticoagulantes
    if (/anticoagul|acenocumarol|warfarina|rivaroxaban|apixaban|dabigatran|aspirina|clopidogrel/.test(s)) a.anticoagulants = neg ? "no" : "si";
    // Enfermedades
    for (const [id, re] of CONDITION_WORDS) if (re.test(s) && !neg && !a.conditions.includes(id)) a.conditions.push(id);
    // Cirugías y hospitalizaciones
    const surg = raw.match(/(?:me operaron|operad[oa]|cirug[ií]a)\s+(?:de(?:l| la)?\s+)?([^.,;]+)/i);
    if (surg && !neg) add("surgeries", cap(surg[1]));
    else if (/cirugia|operad|operaron/.test(s) && neg) add("surgeries", "Niega cirugías");
    // Hábitos
    if (/fum|cigarr|tabaco/.test(s)) a.smoking = neg ? "No fuma" : (raw.match(/\d+\s*cigarr\w*(?:\s+(?:al|por)\s+d[ií]a)?/i)?.[0] ?? "Fuma");
    if (/alcohol|tomo cerveza|toma cerveza|bebe|vino/.test(s)) a.alcohol = neg ? "No" : /social|fin(es)? de semana|ocasional/.test(s) ? "Social" : "Sí";
    if (/brux|aprieto los dientes|aprieta los dientes|rechin/.test(s)) a.bruxism = neg ? "no" : "si";
    if (/sangr\w* (las|la) encia|encias sangran|encia sangra/.test(s)) a.gumBleeding = neg ? "no" : "si";
    if (/embarazad/.test(s)) a.pregnancy = neg ? "no" : "embarazada";
    else if (/lactancia|amamant/.test(s)) a.pregnancy = neg ? "no" : "lactancia";
    // Antecedentes dentales
    if (/ortodonc|brackets|frenillos/.test(s) && !neg) add("dentalHistory", cap(raw.replace(/^(s[ií],?\s*)/i, "")));
    if (/ultima vez (que fui )?al dentista|fui al dentista hace/.test(s)) a.lastDentalVisit = raw.match(/hace\s+[^.,;]+/i)?.[0] ?? a.lastDentalVisit;
  }
  const anamnesis = normalizeAnamnesis(a);
  const doubtful = ANAMNESIS_FIELDS.filter(f => { const v = anamnesis[f]; return f !== "updatedAt" && (Array.isArray(v) ? v.length > 0 : !!v); });
  return { anamnesis, doubtful, turns: [], fallback: true };
}
