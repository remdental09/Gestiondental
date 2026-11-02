/**
 * Vocabulario odontológico de apoyo para dictado en español.
 *
 * Curado a partir de terminología de salud bucal y materiales educativos de:
 * - Universidad de Chile, Glosario odontológico básico:
 *   https://aprendizaje.uchile.cl/recursos-especificos-por-areas-disciplinares/salud/facultad-de-odontologia/odontologia/glosario-odontologico-basico/
 * - MINSAL Chile, Plan Nacional de Salud Bucal 2021-2030 y guías clínicas:
 *   https://diprece.minsal.cl/programas-de-salud/salud-bucal/
 * - SNOMED International, terminología clínica y traducción española:
 *   https://www.snomed.org/use-snomed-ct?lang=es
 * - Academia de Ciencias Odontológicas de España, Diccionario odontológico
 *   (referencia terminológica; no se copian sus definiciones):
 *   https://www.acodes.es/diccionario-odontologico.php
 *
 * Esta lista propia contiene términos y variantes, no definiciones copiadas.
 * Las variantes regionales son formas reconocidas: no se convierten entre sí
 * porque pueden tener matices clínicos o preferencia local.
 */
export const DENTAL_DICTIONARY = {
  anatomia: [
    "diente", "pieza dental", "dentición", "esmalte", "dentina", "cemento radicular",
    "pulpa", "pulpar", "cámara pulpar", "conducto radicular", "ápice", "raíz",
    "corona clínica", "unión amelocementaria", "ligamento periodontal", "periodonto",
    "encía", "gingiva", "surco gingival", "mucosa oral", "mucosa bucal", "paladar",
    "lengua", "vestíbulo", "alvéolo", "hueso alveolar", "maxilar", "mandíbula",
    "articulación temporomandibular", "ATM", "frenillo", "papila interdental",
    "furca", "furcación", "cemento", "odontoblasto", "nervio dentario",
  ],
  superficies_y_posicion: [
    "mesial", "distal", "oclusal", "incisal", "vestibular", "bucal", "labial",
    "lingual", "palatino", "cervical", "proximal", "interproximal", "apical",
    "periapical", "coronal", "radicular", "sector anterior", "sector posterior",
    "cuadrante", "sextante", "hemiarcada", "línea media", "oclusión", "mordida",
    "sobremordida", "overjet", "overbite",
  ],
  caries_y_endodoncia: [
    "caries", "lesión de caries", "mancha blanca", "desmineralización",
    "caries de esmalte", "caries dentinaria", "caries profunda",
    "compromiso pulpar", "pulpitis", "pulpitis reversible", "pulpitis irreversible",
    "necrosis pulpar", "periodontitis apical", "lesión periapical", "absceso apical",
    "fístula", "trayecto fistuloso", "endodoncia", "tratamiento de conducto",
    "tratamiento de canales", "pulpectomía", "pulpotomía", "apexificación",
    "apexogénesis", "reabsorción radicular", "obturación de conductos",
    "gutapercha", "localizador apical", "limas endodónticas",
  ],
  periodoncia: [
    "gingivitis", "periodontitis", "periodontal", "periodonto", "destartraje",
    "destartraje supragingival", "destartraje subgingival", "detartraje",
    "tartrectomía", "profilaxis", "limpieza dental", "raspado y alisado radicular",
    "raspaje y alisado radicular", "curetaje", "cálculo dental", "cálculo dentario",
    "sarro", "placa bacteriana", "biofilm dental", "bolsa periodontal",
    "sondaje periodontal", "profundidad de sondaje", "recesión gingival",
    "sangrado al sondaje", "supuración", "movilidad dentaria", "pérdida de inserción",
    "nivel de inserción clínica", "furcación", "periodontograma", "EPB",
  ],
  restauradora_y_protesis: [
    "obturación", "restauración", "empaste", "tapadura", "resina", "resina compuesta",
    "composite", "amalgama", "ionómero de vidrio", "sellante", "incrustación",
    "inlay", "onlay", "overlay", "carilla", "faceta dental", "corona dental",
    "puente dental", "prótesis fija", "prótesis removible", "prótesis móvil",
    "prótesis parcial", "prótesis total", "prótesis completa", "sobredentadura",
    "base protésica", "pilar protésico", "muñón", "poste intrarradicular",
    "impresión dental", "escaneo intraoral", "ajuste oclusal", "cementación",
    "zirconio", "zirconia", "acrílico",
  ],
  cirugia_e_implantes: [
    "exodoncia", "extracción dental", "extracción dentaria", "cordal",
    "muela del juicio", "tercer molar", "exodoncia simple", "exodoncia quirúrgica",
    "odontosección", "osteotomía", "colgajo", "sutura", "hemostasia",
    "alveolitis", "alveolitis seca", "injerto óseo", "regeneración ósea guiada",
    "membrana", "plasma rico en fibrina", "PRF", "implante dental",
    "osteointegración", "oseointegración", "periimplantitis", "mucositis periimplantaria",
    "pilar de cicatrización", "cicatrizador", "pilar transepitelial", "torque de inserción",
    "elevación de seno maxilar", "frenectomía",
  ],
  ortodoncia_y_imagenologia: [
    "ortodoncia", "ortopedia dentomaxilar", "bracket", "bráquet", "alineador",
    "apiñamiento", "diastema", "mordida abierta", "mordida cruzada", "maloclusión",
    "retención", "contenedor", "férula", "radiografía periapical", "radiografía bitewing",
    "radiografía panorámica", "ortopantomografía", "telerradiografía",
    "tomografía computarizada de haz cónico", "CBCT", "radiografía oclusal",
    "informe radiológico", "imagen periapical",
  ],
  variantes_chile: [
    "destartraje", "tapadura", "tratamiento de conducto", "pieza dental",
    "radiografía panorámica", "diente temporal", "molar",
  ],
  variantes_latinoamerica: [
    "detartraje", "raspaje", "tratamiento de conducto", "muela del juicio",
    "calza dental", "diente de leche", "tercer molar",
  ],
  variantes_espana: [
    "tartrectomía", "empaste", "cordal", "muela del juicio", "prótesis móvil",
    "ortopantomografía", "limpieza dental",
  ],
} as const;

const foldTerm = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const allTerms = Object.values(DENTAL_DICTIONARY).flat();

export const DENTAL_PROTECTED_WORDS = new Set(
  allTerms
    .flatMap((term) => foldTerm(term).split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 4),
);

export const DENTAL_DICTIONARY_HINTS = [
  "Vocabulario odontológico válido; conserva el término que dictó el profesional y corrige solo errores claros del reconocimiento.",
  ...Object.entries(DENTAL_DICTIONARY).map(([group, terms]) => `${group}: ${terms.join(", ")}.`),
  "Los sinónimos y regionalismos (por ejemplo, destartraje, detartraje y tartrectomía; tapadura, obturación y empaste) son formas válidas: no los sustituyas entre sí.",
  "No confundas términos distintos: pulpectomía no es pulpotomía; gingivitis no es periodontitis; supra gingival y sub gingival expresan localizaciones diferentes.",
].join("\n");
