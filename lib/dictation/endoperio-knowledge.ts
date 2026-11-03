/**
 * Contexto terminológico curado para redacción clínica en Endodoncia y Periodoncia.
 * Incluye síntesis propias, palabras clave y metadatos bibliográficos; no contiene texto
 * copiado de libros ni convierte estas referencias en instrucciones terapéuticas.
 */
export type DentalSpecialtyReference = {
  specialty: "endodoncia" | "periodoncia";
  kind: "textbook" | "guideline" | "classification";
  title: string;
  year: number;
  url: string;
  scope?: string;
};

/** Bibliografía consultada para orientar alcance y vocabulario; el contenido licenciado no se almacena en la app. */
export const DENTAL_SPECIALTY_REFERENCES: readonly DentalSpecialtyReference[] = [
  { specialty: "endodoncia", kind: "textbook", title: "Cohen's Pathways of the Pulp, 12th edition (Berman & Hargreaves)", year: 2020, url: "https://shop.elsevier.com/books/cohens-pathways-of-the-pulp/berman/978-0-323-67303-7" },
  { specialty: "endodoncia", kind: "textbook", title: "Endodoncia: conceptos básicos, 2.ª edición (Rodrigo Fuentes Bustamante; Universidad Mayor)", year: 2016, url: "https://repositorio.umayor.cl/xmlui/handle/sibum/9120", scope: "Ficha bibliográfica; el libro se consulta según la licencia del repositorio y no se incorpora como texto." },
  { specialty: "endodoncia", kind: "guideline", title: "Guía MINSAL: Patología pulpar y periapical en dentición permanente", year: 2019, url: "https://diprece.minsal.cl/temas-de-salud/orden-alfabetico/guias-clinicas-no-ges/guias-clinicas-no-ges-salud-bucal/patologia-pulpar-y-periapical-en-denticion-permanente/" },
  { specialty: "endodoncia", kind: "guideline", title: "ESE S3 Clinical Practice Guideline: Treatment of pulpal and apical disease", year: 2023, url: "https://pubmed.ncbi.nlm.nih.gov/37772327/" },
  { specialty: "periodoncia", kind: "textbook", title: "Newman and Carranza's Clinical Periodontology and Implantology, 14th edition", year: 2023, url: "https://shop.elsevier.com/books/newman-and-carranzas-clinical-periodontology-and-implantology/newman/978-0-323-87887-6" },
  { specialty: "periodoncia", kind: "classification", title: "2017 World Workshop Classification of Periodontal and Peri-Implant Diseases and Conditions", year: 2018, url: "https://www.efp.org/news-events/news/proceedings-of-ground-breaking-world-workshop-on-new-classification-are-published-30194/" },
  { specialty: "periodoncia", kind: "guideline", title: "EFP S3 Clinical Practice Guideline: Treatment of stage I–III periodontitis", year: 2020, url: "https://www.efp.org/education/continuing-education/clinical-guidelines/guideline-on-treatment-of-stage-i-iii-periodontitis/" },
  { specialty: "periodoncia", kind: "guideline", title: "Guía MINSAL: Salud oral en adolescentes de 10–19 años, enfermedad periodontal", year: 2017, url: "https://diprece.minsal.cl/temas-de-salud/orden-alfabetico/guias-clinicas-no-ges/guias-clinicas-no-ges-salud-bucal/salud-oral-en-adolescentes-de-10-19-anos-prevencion-diagnostico-y-tratamiento-de-la-enfermedad-periodontal/", scope: "Solo población de 10–19 años; no generalizar sus recomendaciones a adultos." },
];

const ENDODONTIC_TERMS = [
  "endodoncia", "pulpa", "pulpar", "pulpitis", "pulpectomía", "pulpotomía", "necrosis pulpar",
  "periodontitis apical", "periapical", "absceso apical", "conducto radicular", "tratamiento de conducto",
  "conductometría", "gutapercha", "longitud de trabajo", "irrigación endodóntica", "retratamiento endodóntico",
] as const;

const PERIODONTAL_TERMS = [
  "periodoncia", "periodontitis", "gingivitis", "periodontograma", "destartraje", "detartraje",
  "sondaje", "sangrado al sondaje", "nivel de inserción clínica", "furcación", "recesión gingival",
  "periimplantitis", "mucositis periimplantaria", "grupo 1", "grupo 2", "grupo 3", "grupo 4", "grupo 5", "grupo 6",
] as const;

const ENDODONTIC_CONTEXT = "Endodoncia: redacta en secciones distintas los síntomas referidos, los resultados de pruebas, los hallazgos de imagen y los diagnósticos. Mantén separados diagnóstico pulpar y apical/periapical únicamente si fueron expresados por el odontólogo; dolor, caries profunda, respuesta térmica, percusión, palpación o radiolucidez no autorizan por sí solos a completar un diagnóstico. Respeta la distinción pulpotomía/pulpectomía y las fases de tratamiento (apertura, instrumentación, irrigación, medicación, obturación, retratamiento o cirugía); incorpora irrigante, longitud de trabajo, material y técnica únicamente cuando se hayan dictado.";

const PERIODONTAL_CONTEXT = "Periodoncia: separa los hallazgos del diagnóstico y del plan. Conserva como datos independientes profundidad de sondaje, nivel de inserción clínica, sangrado al sondaje, recesión, movilidad, furcación, supuración, placa/biofilm y pérdida ósea. No calcules diagnóstico, extensión, estadio ni grado a partir de medidas parciales: regístralos solo si se dictaron explícitamente. Distingue gingivitis, periodontitis, mucositis periimplantaria y periimplantitis. En esta consulta, «grupo 1» a «grupo 6» son los seis grupos periodontales del clínico: conserva número y expresión, sin convertirlos en piezas dentarias o sextantes.";

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL");
const hasAny = (value: string, terms: readonly string[]) => terms.some(term => value.includes(fold(term)));

export function buildEndoPerioContext(transcript: string): string {
  const normalized = fold(transcript);
  const matches: Array<"endodoncia" | "periodoncia"> = [];
  if (hasAny(normalized, ENDODONTIC_TERMS)) matches.push("endodoncia");
  if (hasAny(normalized, PERIODONTAL_TERMS)) matches.push("periodoncia");
  if (!matches.length) return "";

  const rules = [
    matches.includes("endodoncia") ? ENDODONTIC_CONTEXT : "",
    matches.includes("periodoncia") ? PERIODONTAL_CONTEXT : "",
  ].filter(Boolean);
  const references = DENTAL_SPECIALTY_REFERENCES
    .filter(reference => matches.includes(reference.specialty))
    .map(reference => reference.title + " (" + reference.year + ")");

  return [
    "Marco especializado para redactar lo dictado: orienta vocabulario y separación de categorías; no agrega diagnósticos, procedimientos ni recomendaciones.",
    ...rules,
    "Referencias bibliográficas y guías: " + references.join("; ") + ".",
  ].join("\n");
}
