import type { Anamnesis } from "./anamnesis.ts";

/**
 * Detección determinista de fármacos nombrados en una entrevista o dictado de anamnesis.
 * Red de seguridad: si la IA (o el orden local) deja fuera un fármaco que el paciente sí nombró,
 * aquí se agrega a «Medicamentos» con la dosis e indicación que se dijeron. Nunca inventa dosis.
 * Solo cuenta lo que se afirma: una pregunta («¿toma losartán?») o una negación no agregan nada.
 */

// Nombres genéricos frecuentes en Chile (con tilde, como se muestran). La clave de búsqueda se obtiene sin tildes.
const DRUG_NAMES = [
  "Metotrexato", "Sertralina", "Fentermina", "Losartán", "Enalapril", "Amlodipino", "Atenolol", "Propranolol", "Metoprolol", "Carvedilol", "Bisoprolol",
  "Hidroclorotiazida", "Furosemida", "Espironolactona", "Atorvastatina", "Rosuvastatina", "Simvastatina", "Ezetimiba", "Fenofibrato", "Metformina",
  "Glibenclamida", "Glimepirida", "Sitagliptina", "Vildagliptina", "Empagliflozina", "Dapagliflozina", "Liraglutida", "Semaglutida", "Insulina",
  "Levotiroxina", "Omeprazol", "Esomeprazol", "Pantoprazol", "Lansoprazol", "Salbutamol", "Budesonida", "Fluticasona", "Montelukast", "Prednisona",
  "Prednisolona", "Deflazacort", "Dexametasona", "Betametasona", "Ibuprofeno", "Paracetamol", "Naproxeno", "Diclofenaco", "Ketoprofeno", "Aspirina",
  "Ácido acetilsalicílico", "Clopidogrel", "Warfarina", "Acenocumarol", "Rivaroxabán", "Apixabán", "Dabigatrán", "Heparina", "Enoxaparina",
  "Amoxicilina", "Azitromicina", "Ciprofloxacino", "Metronidazol", "Clindamicina", "Cefalexina", "Fluoxetina", "Escitalopram", "Citalopram",
  "Paroxetina", "Venlafaxina", "Duloxetina", "Amitriptilina", "Mirtazapina", "Bupropión", "Trazodona", "Clonazepam", "Alprazolam", "Lorazepam",
  "Diazepam", "Zolpidem", "Quetiapina", "Olanzapina", "Risperidona", "Aripiprazol", "Litio", "Carbamazepina", "Ácido valproico", "Lamotrigina",
  "Fenitoína", "Levetiracetam", "Topiramato", "Gabapentina", "Pregabalina", "Tramadol", "Morfina", "Codeína", "Alendronato", "Ácido zoledrónico",
  "Denosumab", "Tamoxifeno", "Anastrozol", "Letrozol", "Adalimumab", "Etanercept", "Infliximab", "Hidroxicloroquina", "Leflunomida", "Azatioprina",
  "Ciclosporina", "Tacrolimus", "Micofenolato", "Sulfasalazina", "Tofacitinib", "Alopurinol", "Colchicina", "Sildenafilo", "Tadalafilo", "Finasterida",
  "Tamsulosina", "Loratadina", "Cetirizina", "Desloratadina", "Fexofenadina", "Clorfenamina", "Domperidona", "Metoclopramida", "Loperamida",
  "Isotretinoína", "Ácido fólico", "Sulfato ferroso", "Levodopa", "Pramipexol", "Donepezilo", "Memantina", "Digoxina", "Amiodarona", "Nifedipino",
  "Verapamilo", "Diltiazem", "Valsartán", "Candesartán", "Telmisartán", "Irbesartán", "Ramipril", "Lisinopril", "Captopril", "Clonidina", "Metildopa",
  "Hidralazina", "Nitroglicerina", "Orlistat", "Metilfenidato", "Atomoxetina", "Melatonina", "Bromocriptina", "Cabergolina", "Levonorgestrel",
  "Anticonceptivos", "Eritromicina", "Cloxacilina", "Cefuroxima", "Cefadroxilo", "Claritromicina", "Fluconazol", "Aciclovir", "Valaciclovir",
  "Ketorolaco", "Celecoxib", "Etoricoxib", "Pirfenidona", "Bisfosfonatos", "Teriparatida", "Raloxifeno", "Estradiol", "Progesterona", "Testosterona",
] as const;

// Errores frecuentes del reconocimiento de voz → nombre correcto.
const ALIASES: Record<string, string> = { metrotexato: "Metotrexato", metotrexate: "Metotrexato", metotrexato: "Metotrexato", sertralina: "Sertralina", fentermin: "Fentermina", losartan: "Losartán" };

const strip = (value: string) => value.normalize("NFC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const KEYS = new Map<string, string>();
for (const name of DRUG_NAMES) KEYS.set(strip(name), name);
for (const [alias, name] of Object.entries(ALIASES)) KEYS.set(alias, name);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$1");
const DRUG_RE = new RegExp(`\\b(${[...KEYS.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})\\b`, "g");

const NUMBER = "(?:\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio)";
const DOSE_RE = new RegExp(`\\b${NUMBER}\\s*(?:mg|mcg|µg|ug|g|ui|ml|dosis|comprimidos?|pastillas?|tabletas?|capsulas?|gotas|puffs?|inyecciones?|unidades)\\b`);
const FREQ_RE = new RegExp(`\\b(?:${NUMBER} veces? (?:por|a la|al|cada) (?:semana|dia|mes)|una vez (?:por|a la|al|cada) (?:semana|dia|mes)|cada \\d+ ?(?:horas?|h|dias?|semanas?)|c/\\d+ ?h|semanal(?:mente)?|diari[oa]|(?:en la |por la )?(?:manana|noche))\\b`);
const INDICATION_RE = /\b(?:para\s+(?:(?:la|el|los|las|mi|su)\s+)?|por\s+(?:la|el|los|las|mi|su)\s+)([^.,;?]+)/;
const NEGATED = /\b(?:no|nunca)\s+(?:tomo|toma|usa|uso|consumo|consume|he tomado|tengo)\b|\bdej[oóe]\s+de\b|\bya no\b|\bsuspend/;
const ALLERGY = /\balergi|\balergic/;

const QUESTION = /\?\s*$|^\s*¿/;
const sentences = (text: string) => text.normalize("NFC").replace(/([.!?;])\s+/g, "$1\n").split("\n").map(part => part.trim()).filter(Boolean);
const trimTail = (value: string) => value.replace(/\s+(?:y|e|ademas|tambien|y tambien)\s*$/i, "").replace(/[\s.,;]+$/, "").trim();

type Found = { name: string; dose: string; indication: string };

function describe(segment: string): { dose: string; indication: string } {
  const stripped = strip(segment);
  const dose = [stripped.match(DOSE_RE)?.[0], stripped.match(FREQ_RE)?.[0]].filter(Boolean) as string[];
  // La indicación se toma del texto original (con tildes): mismos índices porque strip() no cambia el largo de letras latinas precompuestas.
  const m = INDICATION_RE.exec(stripped);
  const indication = m ? trimTail(segment.slice(m.index + m[0].length - m[1].length, m.index + m[0].length)) : "";
  return { dose: dose.join(" "), indication: indication.length >= 3 ? indication : "" };
}

/** Fármacos que el paciente (o el clínico, al dictar) afirma tomar. Las preguntas, negaciones y alergias no cuentan. */
export function extractMedications(text: string): string[] {
  const found = new Map<string, Found>();
  let lastQuestionDrug = "", lastAnswerDrug = "";
  for (const sentence of sentences(text)) {
    const stripped = strip(sentence);
    const matches = [...stripped.matchAll(DRUG_RE)].map(m => ({ name: KEYS.get(m[1])!, index: m.index ?? 0 }));
    if (QUESTION.test(sentence)) { if (matches.length) lastQuestionDrug = matches[matches.length - 1].name; continue; }
    if (ALLERGY.test(stripped) || NEGATED.test(stripped)) continue;
    if (!matches.length) {
      // «Seis dosis una vez por semana» como respuesta a «¿La dosis de metotrexato?»: se atribuye al último fármaco nombrado.
      const target = lastQuestionDrug || lastAnswerDrug;
      if (target && DOSE_RE.test(stripped)) { const entry = found.get(target) ?? { name: target, dose: "", indication: "" }; const { dose } = describe(sentence); if (dose && !entry.dose) entry.dose = dose; found.set(target, entry); }
      continue;
    }
    matches.forEach((match, i) => {
      // Con varios fármacos en la frase, cada uno recibe solo su tramo; con uno, toda la frase (la dosis puede ir antes del nombre).
      const segment = matches.length === 1 ? sentence : sentence.slice(match.index, matches[i + 1]?.index ?? sentence.length);
      const { dose, indication } = describe(segment);
      const entry = found.get(match.name) ?? { name: match.name, dose: "", indication: "" };
      if (dose && !entry.dose) entry.dose = dose;
      if (indication && !entry.indication) entry.indication = indication;
      found.set(match.name, entry);
    });
    lastAnswerDrug = matches[matches.length - 1].name; lastQuestionDrug = "";
  }
  return [...found.values()].map(f => `${f.name}${f.dose ? ` ${f.dose}` : ""}${f.indication ? ` (${f.indication})` : ""}`);
}

/**
 * Agrega a «Medicamentos» los fármacos nombrados que la IA no incluyó. Devuelve el formulario y los que agregó;
 * si agregó alguno, la clave «medications» debe quedar en ámbar para que el clínico lo confirme.
 */
export function addMissingMedications(anamnesis: Anamnesis, text: string): { anamnesis: Anamnesis; added: string[] } {
  const present = strip(anamnesis.medications);
  const added = extractMedications(text).filter(entry => {
    const name = strip(entry.split(/[\s(]/)[0]);
    return !present.includes(name);
  });
  if (!added.length) return { anamnesis, added };
  const joined = [anamnesis.medications.trim().replace(/[.,;]+$/, ""), ...added].filter(Boolean).join(". ");
  return { anamnesis: { ...anamnesis, medications: joined.slice(0, 1_500) }, added };
}
