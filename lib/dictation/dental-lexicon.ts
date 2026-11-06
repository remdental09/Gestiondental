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
import { MINSAL_VOCABULARY } from "./minsal-vocabulary.ts";

const BASE_DICTIONARY = {
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
    "caries de esmalte", "caries dentinaria", "caries dentinaria superficial", "dentinaria superficial",
    "caries dentinaria profunda", "dentinaria profunda", "dentina superficial", "caries de dentina superficial",
    "caries profunda",
    "compromiso pulpar", "pulpitis", "pulpitis reversible", "pulpitis irreversible",
    "necrosis pulpar", "periodontitis apical", "lesión periapical", "absceso apical",
    "fístula", "trayecto fistuloso", "endodoncia", "tratamiento de conducto",
    "tratamiento de canales", "pulpectomía", "pulpotomía", "apexificación",
    "apexogénesis", "reabsorción radicular", "obturación de conductos",
    "gutapercha", "localizador apical", "limas endodónticas", "diagnóstico pulpar", "diagnóstico apical", "diagnóstico periapical",
    "pulpa vital", "pulpa necrótica", "pulpitis irreversible sintomática",
    "pulpitis irreversible asintomática", "pulpitis reversible sintomática", "pulpitis reversible asintomática",
    "periodontitis apical sintomática", "periodontitis apical asintomática",
    "tejidos apicales normales", "absceso apical agudo", "absceso apical crónico",
    "sensibilidad a la percusión", "palpación apical", "prueba de frío", "prueba térmica",
    "prueba eléctrica pulpar", "dolor espontáneo", "dolor referido", "dolor a la masticación",
    "radiolucidez periapical", "ensanchamiento del ligamento periodontal", "longitud de trabajo",
    "conductometría", "permeabilidad apical", "instrumentación endodóntica", "irrigación endodóntica",
    "hipoclorito de sodio", "EDTA", "medicación intraconducto", "hidróxido de calcio",
    "sellado endodóntico", "obturación termoplástica", "retratamiento endodóntico",
    "tratamiento pulpar vital", "recubrimiento pulpar directo", "recubrimiento pulpar indirecto",
    "apicectomía", "cirugía periapical",
    "trepanación", "trepanar", "apertura cameral", "acceso endodóntico", "preparación biomecánica",
    "preparación de conductos", "sesión endodóntica", "paramonoclorofenol alcanforado", "paramonoclorofenol",
    "torunda de algodón", "algodón estéril", "obturación provisoria", "sellado provisorio", "vidrio ionómero",
    "ionómero de vidrio", "hidróxido de calcio", "formocresol", "clorhexidina", "cemento sellador", "puntas de gutapercha",
    "conos de gutapercha", "granuloma periapical", "quiste periapical",
  ],
  periodoncia: [
    "gingivitis", "periodontitis", "periodontal", "periodonto", "destartraje",
    "destartraje supragingival", "destartraje subgingival", "detartraje",
    "tartrectomía", "profilaxis", "limpieza dental", "raspado y alisado radicular",
    "raspaje y alisado radicular", "curetaje", "cálculo dental", "cálculo dentario",
    "sarro", "placa bacteriana", "biofilm dental", "bolsa periodontal",
    "sondaje periodontal", "profundidad de sondaje", "recesión gingival",
    "sangrado al sondaje", "supuración", "movilidad dentaria", "pérdida de inserción",
    "nivel de inserción clínica", "pérdida de inserción clínica", "pérdida ósea alveolar",
    "salud periodontal", "salud gingival", "inflamación gingival", "placa supragingival",
    "biofilm subgingival", "cálculo supragingival", "cálculo subgingival", "profundidad de bolsa",
    "furcación", "furcación grado I", "furcación grado II", "furcación grado III",
    "movilidad grado I", "movilidad grado II", "movilidad grado III", "periodontitis localizada",
    "periodontitis generalizada", "periodontitis molar incisivo", "estadio I", "estadio II",
    "estadio III", "estadio IV", "grado A", "grado B", "grado C", "mucositis periimplantaria",
    "enfermedad periimplantaria", "mantenimiento periodontal", "terapia periodontal de soporte",
    "instrumentación subgingival", "periodontograma", "EPB",
    "grupo periodontal", "grupo 1", "grupo 2", "grupo 3", "grupo 4", "grupo 5", "grupo 6",
    "seis grupos periodontales", "destartraje supra y subgingival", "detartraje supra y subgingival",
    "destartraje supragingival y subgingival", "detartraje supragingival y subgingival",
  ],
  restauradora_y_protesis: [
    "obturación", "restauración", "empaste", "tapadura", "resina", "resina compuesta",
    "composite", "restauración de composite", "restauración de resina compuesta", "amalgama", "ionómero de vidrio", "sellante", "incrustación",
    "inlay", "onlay", "overlay", "carilla", "faceta dental", "corona dental",
    "puente dental", "prótesis fija", "prótesis removible", "prótesis móvil",
    "prótesis parcial", "prótesis total", "prótesis completa", "sobredentadura",
    "base protésica", "pilar protésico", "muñón", "poste intrarradicular",
    "impresión dental", "escaneo intraoral", "ajuste oclusal", "cementación",
    "zirconio", "zirconia", "acrílico",
  ],
  cirugia_e_implantes: [
    "cirugía bucal", "cirugía oral", "cirugía implantológica", "flapless", "cirugía sin colgajo",
    "exodoncia", "extracción dental", "extracción dentaria", "cordal",
    "muela del juicio", "tercer molar", "exodoncia simple", "exodoncia quirúrgica",
    "odontosección", "osteotomía", "colgajo", "colgajo mucoperióstico", "incisión",
    "despegamiento mucoperióstico", "alveoloplastia", "regularización ósea", "aseo quirúrgico", "irrigación con suero fisiológico",
    "sutura", "sutura reabsorbible", "sutura no reabsorbible", "sutura intraoral reabsorbible", "sutura de Vicryl",
    "punto simple", "punto colchonero", "punto en X", "nudo quirúrgico",
    "Vicryl", "Vicryl Rapide", "poliglactina 910", "Monocryl", "poliglecaprone 25",
    "PDS", "polidioxanona", "Prolene", "polipropileno", "nylon", "poliamida",
    "seda quirúrgica", "catgut", "calibre 3-0", "calibre 4-0", "calibre 5-0",
    "aguja atraumática", "hemostasia", "esponja de gelatina", "gelatina hemostática", "Gelita hemostática",
    "colágeno hemostático", "membrana reabsorbible", "membrana de colágeno",
    "xenoinjerto", "aloinjerto", "autoinjerto", "injerto óseo", "regeneración ósea guiada",
    "alveolitis", "alveolitis seca", "membrana", "plasma rico en fibrina", "PRF",
    "implante dental", "osteointegración", "oseointegración", "periimplantitis", "mucositis periimplantaria",
    "pilar de cicatrización", "cicatrizador", "pilar transepitelial", "torque de inserción",
    "tubete anestésico", "cartucho anestésico", "lidocaína", "articaína", "mepivacaína",
    "epinefrina", "adrenalina", "elevación de seno maxilar", "frenectomía",
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
    "destartraje", "destartraje supra y subgingival", "destartraje supragingival y subgingival",
    "tapadura", "tratamiento de conducto", "pieza dental", "grupo periodontal",
    "grupo 1", "grupo 2", "grupo 3", "grupo 4", "grupo 5", "grupo 6",
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

const foldDictionaryTerm = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const baseTerms = new Set(Object.values(BASE_DICTIONARY).flat().map(foldDictionaryTerm));

/** Términos de las guías del MINSAL que el diccionario base aún no tenía (sin repetidos). */
const minsalNewTerms = Object.fromEntries(
  Object.entries(MINSAL_VOCABULARY).map(([group, terms]) => [
    `minsal_${group}`,
    terms.filter((term) => !baseTerms.has(foldDictionaryTerm(term))),
  ]),
) as Record<string, string[]>;

export const DENTAL_DICTIONARY: Record<string, readonly string[]> = { ...BASE_DICTIONARY, ...minsalNewTerms };

export const DENTAL_SPEECH_HINTS = [
  { phrase: "RUN", boost: 8 },
  { phrase: "RUT", boost: 8 },
  { phrase: "dígito verificador", boost: 8 },
  { phrase: "fecha de nacimiento", boost: 8 },
  { phrase: "correo electrónico", boost: 7 },
  { phrase: "número de teléfono", boost: 7 },
  { phrase: "destartraje", boost: 9 },
  { phrase: "destartraje supragingival", boost: 10 },
  { phrase: "destartraje subgingival", boost: 10 },
  { phrase: "destartraje supra y subgingival", boost: 10 },
  { phrase: "destartraje supragingival y subgingival", boost: 10 },
  { phrase: "detartraje", boost: 8 },
  { phrase: "tartrectomía", boost: 8 },
  { phrase: "pulpa dental", boost: 7 },
  { phrase: "caries dentinaria", boost: 9 },
  { phrase: "caries dentinaria superficial", boost: 10 },
  { phrase: "dentinaria superficial", boost: 9 },
  { phrase: "caries dentinaria profunda", boost: 9 },
  { phrase: "composite", boost: 9 },
  { phrase: "resina compuesta", boost: 9 },
  { phrase: "restauración de composite", boost: 8 },
  { phrase: "restauración de resina compuesta", boost: 8 },
  { phrase: "caries de dentina superficial", boost: 9 },
  { phrase: "diagnóstico pulpar", boost: 8 },
  { phrase: "diagnóstico apical", boost: 8 },
  { phrase: "pulpitis reversible", boost: 8 },
  { phrase: "pulpitis irreversible sintomática", boost: 8 },
  { phrase: "necrosis pulpar", boost: 8 },
  { phrase: "periodontitis apical", boost: 8 },
  { phrase: "periodontitis apical crónica", boost: 9 },
  { phrase: "paramonoclorofenol alcanforado", boost: 10 },
  { phrase: "trepanación", boost: 8 },
  { phrase: "apertura cameral", boost: 8 },
  { phrase: "preparación biomecánica", boost: 8 },
  { phrase: "sesión endodóntica", boost: 8 },
  { phrase: "vidrio ionómero", boost: 8 },
  { phrase: "absceso apical", boost: 8 },
  { phrase: "prueba de frío", boost: 7 },
  { phrase: "sensibilidad a la percusión", boost: 7 },
  { phrase: "longitud de trabajo", boost: 8 },
  { phrase: "conductometría", boost: 8 },
  { phrase: "instrumentación endodóntica", boost: 8 },
  { phrase: "irrigación endodóntica", boost: 8 },
  { phrase: "hipoclorito de sodio", boost: 7 },
  { phrase: "medicación intraconducto", boost: 8 },
  { phrase: "obturación termoplástica", boost: 8 },
  { phrase: "retratamiento endodóntico", boost: 8 },
  { phrase: "profundidad de sondaje", boost: 8 },
  { phrase: "nivel de inserción clínica", boost: 8 },
  { phrase: "sangrado al sondaje", boost: 8 },
  { phrase: "recesión gingival", boost: 7 },
  { phrase: "furcación grado II", boost: 8 },
  { phrase: "periodontitis generalizada", boost: 8 },
  { phrase: "periodontitis localizada", boost: 8 },
  { phrase: "terapia periodontal de soporte", boost: 8 },
  { phrase: "mucositis periimplantaria", boost: 8 },
  { phrase: "pulpectomía", boost: 8 },
  { phrase: "pulpotomía", boost: 8 },
  { phrase: "ligamento periodontal", boost: 8 },
  { phrase: "encía", boost: 7 },
  { phrase: "periodontitis", boost: 7 },
  { phrase: "gingivitis", boost: 7 },
  { phrase: "sondaje periodontal", boost: 8 },
  { phrase: "periodontograma", boost: 8 },
  { phrase: "cirugía bucal", boost: 8 },
  { phrase: "flapless", boost: 9 },
  { phrase: "colgajo mucoperióstico", boost: 8 },
  { phrase: "odontosección", boost: 8 },
  { phrase: "alveoloplastia", boost: 7 },
  { phrase: "sutura reabsorbible", boost: 8 },
  { phrase: "VICRYL", boost: 10 },
  { phrase: "poliglactina 910", boost: 9 },
  { phrase: "Vicryl Rapide", boost: 9 },
  { phrase: "Monocryl", boost: 8 },
  { phrase: "PDS", boost: 7 },
  { phrase: "Prolene", boost: 8 },
  { phrase: "polipropileno", boost: 8 },
  { phrase: "seda quirúrgica", boost: 7 },
  { phrase: "sutura intraoral reabsorbible", boost: 8 },
  { phrase: "Gelita hemostática", boost: 8 },
  { phrase: "aseo quirúrgico", boost: 7 },
  { phrase: "irrigación con suero fisiológico", boost: 7 },
  { phrase: "calibre 3-0", boost: 7 },
  { phrase: "calibre 4-0", boost: 7 },
  { phrase: "la mitad del presupuesto", boost: 9 },
  { phrase: "50 por ciento del presupuesto", boost: 8 },
  { phrase: "monto abonado", boost: 8 },
  { phrase: "pago parcial", boost: 7 },
  { phrase: "tubete anestésico", boost: 7 },
  { phrase: "lidocaína", boost: 7 },
  { phrase: "articaína", boost: 7 },
  { phrase: "exodoncia", boost: 7 },
  { phrase: "endodoncia", boost: 7 },
  { phrase: "odontograma", boost: 8 },
  { phrase: "urgencia odontológica ambulatoria", boost: 8 },
  { phrase: "pericoronaritis aguda", boost: 9 },
  { phrase: "absceso dentoalveolar agudo", boost: 9 },
  { phrase: "gingivitis úlcero necrótica", boost: 9 },
  { phrase: "traumatismo dentoalveolar", boost: 9 },
  { phrase: "luxación intrusiva", boost: 8 },
  { phrase: "fractura coronaria complicada", boost: 8 },
  { phrase: "alveolitis seca", boost: 9 },
  { phrase: "pulpotomía parcial", boost: 8 },
  { phrase: "recubrimiento pulpar directo", boost: 8 },
  { phrase: "remoción selectiva de caries", boost: 8 },
  { phrase: "aislamiento absoluto", boost: 8 },
  { phrase: "material biocerámico", boost: 8 },
  { phrase: "hidróxido de calcio", boost: 8 },
  { phrase: "caries radicular", boost: 8 },
  { phrase: "barniz de flúor", boost: 8 },
  { phrase: "aplicación de sellantes", boost: 8 },
  { phrase: "raspado y alisado radicular", boost: 9 },
  { phrase: "examen periodontal básico", boost: 8 },
  { phrase: "terapia de desinfección bucal total", boost: 8 },
  { phrase: "prótesis parcial removible", boost: 9 },
  { phrase: "prótesis total", boost: 8 },
  { phrase: "prótesis fija", boost: 8 },
  { phrase: "sobredentadura implantosoportada", boost: 8 },
  { phrase: "estomatitis subprotésica", boost: 8 },
  { phrase: "clasificación de Kennedy", boost: 8 },
  { phrase: "xerostomía", boost: 8 },
  { phrase: "hipersensibilidad dentinaria", boost: 8 },
  { phrase: "clorhexidina", boost: 7 },
  { phrase: "bloqueo del nervio dentario inferior", boost: 8 },
  { phrase: "incisión y drenaje", boost: 8 },
  { phrase: "alta odontológica integral", boost: 7 },
] as const;

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
  "En restauración, «composite» y «resina compuesta» nombran el material; «compósito/composito» es un error de reconocimiento y se corrige a «composite». Redacta «restauración de composite» o «restauración de resina compuesta» y no repitas ambos sinónimos.",
  "No confundas términos distintos: pulpectomía no es pulpotomía; gingivitis no es periodontitis; supra gingival y sub gingival expresan localizaciones diferentes.",
  "«Caries dentinaria superficial» es una expresión odontológica válida. Conserva «dentinaria» como dentina; nunca la cambies por «terminal» ni elimines la profundidad. Si esa profundidad fue dictada, no agregues ni quites esmalte, dentina profunda, compromiso pulpar o una cara dental.",
  "En endodoncia, «paramonoclorofenol alcanforado» (PMCC) es una medicación intraconducto, y «torunda» o «torunda de algodón» es el algodón que la lleva a la cámara. «Trepanar/trepanación» y «apertura cameral» nombran el acceso a la cámara pulpar. «Sesión endodóntica» puede ser mal oída como «sesión mental». «Periodontitis crónica apical», «periodontitis apical crónica» y «periodontitis periapical crónica» son la misma entidad: conserva el orden dictado. Si una palabra suena a medicamento pero no puedes identificarla con certeza, conserva lo dictado y pregunta en «dudas».",
  "En endodoncia, conserva por separado los síntomas, los resultados de pruebas, los hallazgos radiográficos y los diagnósticos pulpar y apical/periapical; no reemplaces una categoría por otra ni la infieras por el dolor o por una prueba aislada.",
  "En periodoncia, conserva como hallazgos independientes la profundidad de sondaje, el nivel de inserción clínica, el sangrado al sondaje, la recesión, la furcación, la movilidad y la supuración; no calcules ni atribuyas estadio, grado o extensión cuando no estén dictados.",
  "En contexto periodontal, «tatuaje subgingival» o «tatuaje supragingival» puede ser un error del reconocimiento de voz por «destartraje»; corrígelo solo cuando acompañe a supra/ subgingival o a términos de periodoncia.",
  "En cirugía bucal, conserva la marca, el material y el calibre de suturas, la técnica y las dimensiones del implante. Corrige solo errores claros de reconocimiento; no sustituyas materiales ni completes datos que no fueron dictados.",
  "Si se dicta «la mitad» o «50 por ciento» de un total único, calcula el abono y mantén separado el precio total del presupuesto; pregunta si hay más de un total posible.",
].join("\n");
