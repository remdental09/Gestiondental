import { defineSpecialty } from "../specialty.ts";

/** Odontogeriatría (incorporada al reglamento chileno en 2024). */
export const ODONTOGERIATRIA = defineSpecialty({
  id: "odontogeriatria",
  nombre: "Odontogeriatría",
  oficial: "Odontogeriatría",
  senales: ["adulto mayor", "persona mayor", "geriatrico", "anciano", "cuidador", "polifarmacia", "anticoagulante", "acenocumarol", "warfarina", "inr", "caries radicular", "protesis total", "estomatitis subprotesica", "demencia"],
  notas: [
    "Conserva la medicación dictada (anticoagulantes, antiagregantes, bifosfonatos) y el INR si se dijo; no infieras indicaciones.",
    "Caries radicular, abrasión, erosión y abfracción son hallazgos distintos.",
  ],
  procedimientos: ["evaluación funcional", "control de prótesis", "rebasado de prótesis", "higiene de prótesis", "instrucción al cuidador", "aplicación de barniz de flúor", "restauración de caries radicular", "restauración con ionómero de vidrio", "exodoncia en paciente anticoagulado", "medición de INR"],
  materiales: ["pasta dental de 5000 ppm de flúor", "barniz de flúor", "ionómero de vidrio", "saliva artificial", "adhesivo para prótesis", "tabletas limpiadoras de prótesis"],
  marcas: [["Duraphat 5000", "Colgate"], ["Corega", "Haleon"], ["Fixodent", "Procter & Gamble"]],
  hallazgos: [
    "caries radicular", "caries radicular activa", "caries radicular detenida", "xerostomía", "hiposalivación", "estomatitis subprotésica",
    "hiperplasia fibrosa inflamatoria", "épulis fisurado", "queilitis angular", "candidiasis asociada a prótesis", "prótesis desadaptada",
    "pérdida de dimensión vertical", "atrición", "abrasión", "erosión", "abfracción", "recesión generalizada", "edentulismo parcial", "edentulismo total",
    "reborde reabsorbido", "disfagia", "dificultad masticatoria",
  ],
  medicamentos: ["acenocumarol", "warfarina", "apixabán", "rivaroxabán", "dabigatrán", "ácido acetilsalicílico", "clopidogrel", "alendronato", "ácido zoledrónico", "denosumab", "metformina", "insulina", "losartán", "enalapril", "amlodipino"],
  conceptos: ["INR", "polifarmacia", "dependencia", "autovalente", "riesgo de sangrado", "riesgo de osteonecrosis"],
  sinonimos: [["edentulismo total", ["desdentado total"]], ["acenocumarol", ["Neo-Sintrom"]]],
  oidoMal: [["acenocumarol", ["aceno cumarol", "acenocumarón"]], ["losartán", ["lo zartán", "lozartán"]]],
});
