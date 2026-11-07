/**
 * Base de conocimiento odontológico por especialidad.
 *
 * Cada especialidad vive en su propio archivo (lib/knowledge/specialties/*.ts) y contiene términos, no definiciones:
 * procedimientos, materiales, marcas con su empresa, instrumentos, hallazgos, medicamentos y variantes que el
 * reconocimiento de voz suele oír mal. El dictado solo carga las especialidades que detecta (ver index.ts); el resto
 * queda disponible por búsqueda. Nada de esto decide un diagnóstico ni un tratamiento: ayuda a reconocer y conservar
 * la palabra que dictó el profesional.
 *
 * Especialidades según el Reglamento de certificación de especialidades (Superintendencia de Salud de Chile),
 * más «operatoria», que es odontología general restauradora y no una especialidad certificada.
 */

export type SpecialtyId =
  | "implantologia"
  | "cirugia"
  | "endodoncia"
  | "periodoncia"
  | "rehabilitacion"
  | "operatoria"
  | "ortodoncia"
  | "odontopediatria"
  | "patologia"
  | "ttm"
  | "imagenologia"
  | "odontogeriatria";

export type KnowledgeKind = "procedimiento" | "material" | "marca" | "instrumento" | "hallazgo" | "medicamento" | "concepto";

export type KnowledgeEntry = {
  termino: string;
  tipo: KnowledgeKind;
  /** Otras formas válidas del mismo término (no se sustituyen entre sí). */
  sinonimos?: string[];
  /** Cómo lo transcribe mal la voz; el modelo corrige solo con contexto clínico. */
  oidoMal?: string[];
  /** Fabricante o empresa, para marcas. */
  empresa?: string;
  /** Solo se busca con la herramienta: no se repite en el prompt (p. ej. sistemas de implantes, que ya van en el prompt base). */
  soloBusqueda?: boolean;
};

export type Specialty = {
  id: SpecialtyId;
  nombre: string;
  /** Nombre en el reglamento chileno; null si no es especialidad certificada. */
  oficial: string | null;
  /** Palabras que delatan la especialidad en un dictado (se comparan sin tildes, por palabra o frase). */
  senales: string[];
  /** Reglas cortas de lenguaje clínico de la especialidad (no conducta clínica). */
  notas: string[];
  entradas: KnowledgeEntry[];
};

type SpecialtySource = {
  id: SpecialtyId;
  nombre: string;
  oficial: string | null;
  senales: string[];
  notas?: string[];
  procedimientos?: string[];
  materiales?: string[];
  /** [marca, empresa] */
  marcas?: Array<[string, string]>;
  /** [marca, empresa] que solo se consultan por búsqueda (ya están en otra parte del prompt). */
  marcasSoloBusqueda?: Array<[string, string, string[]?]>;
  instrumentos?: string[];
  hallazgos?: string[];
  medicamentos?: string[];
  conceptos?: string[];
  /** [término correcto, sinónimos válidos] */
  sinonimos?: Array<[string, string[]]>;
  /** [término correcto, formas mal oídas] */
  oidoMal?: Array<[string, string[]]>;
};

export const foldText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Arma una especialidad desde listas simples; une sinónimos y variantes oídas al término que corresponda. */
export function defineSpecialty(source: SpecialtySource): Specialty {
  const entries = new Map<string, KnowledgeEntry>();
  const add = (termino: string, tipo: KnowledgeKind, extra: Partial<KnowledgeEntry> = {}) => {
    const key = foldText(termino);
    const existing = entries.get(key);
    if (existing) { Object.assign(existing, { ...extra, ...existing }); return; }
    entries.set(key, { termino, tipo, ...extra });
  };
  for (const term of source.procedimientos ?? []) add(term, "procedimiento");
  for (const term of source.materiales ?? []) add(term, "material");
  for (const [marca, empresa] of source.marcas ?? []) add(marca, "marca", { empresa });
  for (const [marca, empresa, variantes] of source.marcasSoloBusqueda ?? []) {
    const heard = (variantes ?? []).filter((form) => foldText(form) !== foldText(marca));
    add(marca, "marca", { empresa, soloBusqueda: true, ...(heard.length ? { oidoMal: heard } : {}) });
  }
  for (const term of source.instrumentos ?? []) add(term, "instrumento");
  for (const term of source.hallazgos ?? []) add(term, "hallazgo");
  for (const term of source.medicamentos ?? []) add(term, "medicamento");
  for (const term of source.conceptos ?? []) add(term, "concepto");
  const attach = (term: string, field: "sinonimos" | "oidoMal", values: string[]) => {
    const key = foldText(term);
    if (!entries.has(key)) add(term, "concepto");
    const entry = entries.get(key)!;
    entry[field] = [...new Set([...(entry[field] ?? []), ...values])].filter((form) => foldText(form) !== key);
  };
  for (const [term, values] of source.sinonimos ?? []) attach(term, "sinonimos", values);
  for (const [term, values] of source.oidoMal ?? []) attach(term, "oidoMal", values);
  return { id: source.id, nombre: source.nombre, oficial: source.oficial, senales: source.senales, notas: source.notas ?? [], entradas: [...entries.values()] };
}
