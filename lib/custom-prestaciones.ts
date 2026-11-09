import { normalizePrice } from "./aranceles.ts";

/** Prestaciones propias de cada profesional (las que no están en el catálogo de 789). */
export type VariantDimension = { id: string; label: string; options: string[] };
export type PrestacionSpecialty = { key: string; label: string; dimensions: VariantDimension[] };

const dim = (id: string, label: string, options: string[]): VariantDimension => ({ id, label, options });

/**
 * Especialidades y, para cada una, las formas habituales en que una misma prestación cambia de precio
 * (caras, conductos, material, arcada, pieza…). Son sugerencias: el profesional elige las que usa.
 */
export const PRESTACION_SPECIALTIES: PrestacionSpecialty[] = [
  { key: "operatoria", label: "Operatoria / restauradora", dimensions: [
    dim("caras", "Caras comprometidas", ["1 cara", "2 caras", "3 caras", "4 caras", "5 caras / reconstrucción"]),
    dim("material", "Material", ["Resina compuesta", "Amalgama", "Ionómero de vidrio", "Compómero"]),
    dim("pieza", "Tipo de pieza", ["Anterior", "Premolar", "Molar"]),
    dim("indirecta", "Restauración indirecta", ["Incrustación (inlay)", "Onlay", "Overlay", "Carilla"]),
    dim("poste", "Poste o núcleo", ["Poste de fibra", "Muñón metálico colado", "Reconstrucción con pin"]),
  ] },
  { key: "endodoncia", label: "Endodoncia", dimensions: [
    dim("conductos", "Número de conductos", ["1 conducto", "2 conductos", "3 conductos", "4 conductos", "5 o más conductos"]),
    dim("pieza", "Tipo de pieza", ["Incisivo / canino", "Premolar", "Molar superior", "Molar inferior", "Tercer molar"]),
    dim("condicion", "Condición pulpar", ["Vital", "Necrótico", "Retratamiento"]),
    dim("complejidad", "Complejidad", ["Simple", "Moderada", "Compleja (calcificado, curvo, instrumento fracturado)"]),
    dim("raices", "Raíces (apicectomía)", ["1 raíz", "2 raíces", "3 raíces"]),
    dim("sesiones", "Sesiones", ["Sesión única", "2 sesiones", "Sesión adicional"]),
  ] },
  { key: "protesis-fija", label: "Prótesis fija / rehabilitación", dimensions: [
    dim("material", "Material", ["Metal-cerámica", "Zirconio", "Disilicato de litio", "Porcelana sin metal", "Metal colado", "Resina / provisoria"]),
    dim("elemento", "Elemento", ["Corona unitaria", "Pilar de puente", "Póntico (diente intermedio)", "Núcleo / muñón", "Provisorio"]),
    dim("unidades", "Unidades del puente", ["3 unidades", "4 unidades", "5 unidades", "6 o más unidades"]),
  ] },
  { key: "protesis-removible", label: "Prótesis removible", dimensions: [
    dim("tipo", "Tipo", ["Acrílica parcial", "Acrílica total", "Esquelética (cromo-cobalto)", "Flexible", "Sobredentadura"]),
    dim("arcada", "Arcada", ["Superior", "Inferior", "Ambas arcadas"]),
    dim("dientes", "Dientes reemplazados", ["1 diente", "2 dientes", "3 dientes", "4 o más dientes"]),
    dim("reparacion", "Reparación", ["Rebasado", "Reparación de fractura", "Agregar diente", "Agregar retenedor"]),
  ] },
  { key: "cirugia", label: "Cirugía bucal y maxilofacial", dimensions: [
    dim("exodoncia", "Tipo de exodoncia", ["Simple", "Compleja / con colgajo", "Resto radicular", "Pieza supernumeraria"]),
    dim("tercer-molar", "Tercer molar", ["Erupcionado", "Semi-incluido", "Incluido en mucosa", "Incluido óseo", "Incluido profundo"]),
    dim("alcance", "Alcance", ["Por pieza", "Por cuadrante", "Boca completa"]),
    dim("menor", "Cirugía menor", ["Frenectomía", "Biopsia", "Quiste / granuloma", "Alveoloplastía", "Regularización de reborde", "Exposición de pieza retenida"]),
  ] },
  { key: "periodoncia", label: "Periodoncia", dimensions: [
    dim("alcance", "Alcance", ["Por pieza", "Por sextante", "Por cuadrante", "Boca completa"]),
    dim("terapia", "Terapia", ["Destartraje y pulido", "Raspado y alisado radicular", "Cirugía a colgajo", "Gingivectomía", "Alargamiento de corona", "Injerto gingival libre", "Injerto de tejido conectivo", "Mantención periodontal"]),
    dim("zona", "Zona", ["Anterior", "Posterior"]),
  ] },
  { key: "implantologia", label: "Implantología", dimensions: [
    dim("procedimiento", "Procedimiento", ["Instalación de implante", "Pilar / aditamento", "Corona sobre implante", "Provisorio sobre implante", "Sobredentadura sobre implantes", "Carga inmediata"]),
    dim("asociada", "Cirugía asociada", ["Injerto óseo por sitio", "Regeneración ósea guiada", "Elevación de seno (abordaje lateral)", "Elevación de seno (crestal)", "Expansión de reborde", "Implante post-extracción"]),
    dim("lateralidad", "Lateralidad", ["Unilateral", "Bilateral"]),
    dim("cantidad", "Cantidad de implantes", ["1 implante", "2 implantes", "4 implantes", "6 implantes"]),
  ] },
  { key: "ortodoncia", label: "Ortodoncia y ortopedia", dimensions: [
    dim("aparato", "Aparatología", ["Brackets metálicos", "Brackets estéticos", "Autoligado metálico", "Autoligado estético", "Alineadores transparentes", "Ortodoncia lingual"]),
    dim("arcada", "Arcada", ["Superior", "Inferior", "Ambas arcadas"]),
    dim("fase", "Fase", ["Diagnóstico y estudio", "Instalación", "Control mensual", "Retiro y contención", "Retenedor removible", "Retenedor fijo"]),
    dim("ortopedia", "Aparato ortopédico", ["Disyuntor palatino", "Placa removible", "Mantenedor de espacio", "Máscara facial"]),
  ] },
  { key: "odontopediatria", label: "Odontopediatría", dimensions: [
    dim("pieza", "Tipo de pieza", ["Temporal", "Definitiva joven"]),
    dim("caras", "Caras", ["1 cara", "2 caras", "3 o más caras"]),
    dim("pulpar", "Tratamiento pulpar", ["Pulpotomía", "Pulpectomía", "Recubrimiento pulpar directo", "Recubrimiento pulpar indirecto"]),
    dim("restauracion", "Restauración o prevención", ["Corona de acero inoxidable", "Corona de policarbonato", "Sellante por pieza", "Aplicación de flúor", "Mantenedor de espacio"]),
  ] },
  { key: "preventiva", label: "Preventiva e higiene", dimensions: [
    dim("alcance", "Alcance", ["Por arcada", "Boca completa", "Por sesión"]),
    dim("paciente", "Paciente", ["Adulto", "Niño"]),
    dim("servicio", "Servicio", ["Profilaxis", "Destartraje", "Barniz de flúor", "Sellante por pieza", "Instrucción de higiene", "Control de placa"]),
  ] },
  { key: "radiologia", label: "Radiología", dimensions: [
    dim("toma", "Tipo de toma", ["Retroalveolar / periapical", "Bite-wing (aleta de mordida)", "Oclusal", "Panorámica", "Cefalometría lateral", "CBCT por arcada", "CBCT maxilofacial completo"]),
    dim("cantidad", "Cantidad", ["1 toma", "Serie de 4", "Serie completa"]),
  ] },
  { key: "ttm", label: "TTM y dolor orofacial", dimensions: [
    dim("ferula", "Férula", ["Férula de descarga superior", "Férula de descarga inferior", "Férula de reposicionamiento", "Ajuste de férula", "Reparación de férula"]),
    dim("terapia", "Terapia", ["Evaluación de TTM", "Infiltración / punción seca", "Toxina botulínica por zona", "Sesión de fisioterapia o ejercicios", "Artrocentesis"]),
  ] },
  { key: "estetica", label: "Estética y blanqueamiento", dimensions: [
    dim("blanqueamiento", "Blanqueamiento", ["En consulta (una arcada)", "En consulta (ambas arcadas)", "Domiciliario con cubetas", "Diente no vital"]),
    dim("carillas", "Carillas", ["Carilla de resina (por pieza)", "Carilla de porcelana (por pieza)", "Carilla de disilicato (por pieza)", "Lentes de contacto (por pieza)"]),
    dim("diseno", "Diseño de sonrisa", ["Diseño digital de sonrisa", "Encerado diagnóstico", "Mock-up"]),
  ] },
  { key: "general", label: "Consulta y otros", dimensions: [
    dim("consulta", "Tipo de consulta", ["Evaluación inicial", "Control", "Urgencia", "Teleconsulta", "Segunda opinión"]),
  ] },
];

/** Grupo del catálogo donde también se muestra la prestación propia de cada especialidad (null: sin grupo equivalente, se muestra en uno aparte). */
export const SPECIALTY_CATALOG_GROUP: Record<string, string | null> = {
  operatoria: "OPERATORIA",
  endodoncia: "ENDODONCIA",
  "protesis-fija": "PROTESIS FIJA",
  "protesis-removible": "PROTESIS REMOVIBLE",
  cirugia: "CIRUGIA BUCAL",
  periodoncia: "PERIODONCIA",
  implantologia: "IMPLANTES UNITARIOS",
  ortodoncia: "ORTODONCIA",
  odontopediatria: "ODONTOPEDIATRIA",
  preventiva: "PREVENTIVA",
  radiologia: "RADIOLOGIA",
  ttm: "DISFUNCION (TTM)",
  estetica: null,
  general: "PRESTACIONES DENTALES GENERALES",
};

export const SPECIALTY_KEYS = PRESTACION_SPECIALTIES.map(item => item.key);
export const specialtyLabel = (key: string) => PRESTACION_SPECIALTIES.find(item => item.key === key)?.label ?? key;

export const MAX_CUSTOM_PER_OWNER = 500;
export const MAX_CREATE_AT_ONCE = 30;
export const MAX_NAME = 120;

export type CustomPrestacion = { id: number; specialty: string; name: string; price: number | null };

/** Texto del nombre: espacios colapsados, 3–120 caracteres. null si no sirve. */
export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 3 && name.length <= MAX_NAME ? name : null;
}

/** Nombre de una variante: «Obturación de resina — 2 caras». */
export function variantName(base: string, option: string): string {
  return option.trim() ? `${base.trim()} — ${option.trim()}` : base.trim();
}

export type NewItem = { name: string; price: number | null };

/** Valida el cuerpo del POST: especialidad conocida, 1–30 ítems con nombre válido y precio vacío o válido; sin nombres repetidos. */
export function checkNewItems(input: unknown): { ok: true; specialty: string; items: NewItem[] } | { ok: false; error: string } {
  const body = input as { specialty?: unknown; items?: unknown } | null;
  const specialty = typeof body?.specialty === "string" ? body.specialty : "";
  if (!SPECIALTY_KEYS.includes(specialty)) return { ok: false, error: "Elige una especialidad." };
  if (!Array.isArray(body?.items) || body.items.length === 0) return { ok: false, error: "Agrega al menos una prestación." };
  if (body.items.length > MAX_CREATE_AT_ONCE) return { ok: false, error: `Puedes crear hasta ${MAX_CREATE_AT_ONCE} prestaciones a la vez.` };
  const seen = new Set<string>();
  const items: NewItem[] = [];
  for (const raw of body.items as Array<{ name?: unknown; price?: unknown }>) {
    const name = normalizeName(raw?.name);
    if (!name) return { ok: false, error: `El nombre debe tener entre 3 y ${MAX_NAME} letras.` };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const empty = raw.price === null || raw.price === undefined || (typeof raw.price === "string" && raw.price.trim() === "");
    const price = empty ? null : normalizePrice(raw.price);
    if (!empty && price === null) return { ok: false, error: `El precio de «${name}» debe ser un número entero en pesos, mayor que 0.` };
    items.push({ name, price });
  }
  return { ok: true, specialty, items };
}
