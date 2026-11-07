import { defineSpecialty } from "../specialty.ts";

export const PERIODONCIA = defineSpecialty({
  id: "periodoncia",
  nombre: "Periodoncia",
  oficial: "Periodoncia",
  senales: [
    "periodontal", "periodontitis", "gingivitis", "destartraje", "detartraje", "tartrectomia", "sondaje", "bolsa", "recesion",
    "furca", "furcacion", "movilidad", "pulido radicular", "raspado", "alisado radicular", "periodontograma", "sangrado al sondaje",
    "injerto de tejido conectivo", "injerto gingival", "alargamiento coronario", "gingivectomia", "epb", "insercion clinica",
  ],
  notas: [
    "Profundidad de sondaje, nivel de inserción clínica, sangrado, supuración, recesión, furcación y movilidad son hallazgos distintos: no los mezcles.",
    "El estadio (I–IV) y grado (A–C) de periodontitis (clasificación 2017 AAP-EFP) solo se registran si el profesional los dictó; no los calcules.",
    "«Tatuaje sub/supragingival» o «de estar traje» son errores de la voz por «destartraje».",
    "Los grupos periodontales (1 a 6) y el EPB del MINSAL son tamizaje por sextante, no un diagnóstico.",
  ],
  procedimientos: [
    "destartraje supragingival", "destartraje subgingival", "pulido coronario", "profilaxis", "instrumentación subgingival",
    "raspado y alisado radicular", "terapia periodontal no quirúrgica", "terapia periodontal de soporte", "mantención periodontal",
    "control de placa", "instrucción de higiene oral", "técnica de cepillado de Bass modificada", "enseñanza de uso de hilo dental",
    "periodontograma", "sondaje periodontal", "examen periodontal básico", "cirugía periodontal", "colgajo de acceso", "colgajo de Widman modificado",
    "cirugía resectiva", "osteoplastia", "osteotomía periodontal", "alargamiento coronario", "gingivectomía", "gingivoplastia",
    "regeneración tisular guiada", "regeneración periodontal", "injerto de tejido conectivo", "injerto gingival libre",
    "colgajo de reposición coronal", "colgajo de reposición lateral", "técnica de túnel", "cobertura radicular", "frenectomía",
    "hemisección", "amputación radicular", "tunelización", "ferulización", "ferulización con fibra", "ajuste oclusal",
    "drenaje de absceso periodontal", "desbridamiento", "aplicación de clorhexidina", "irrigación subgingival",
  ],
  materiales: [
    "ultrasonido", "pasta profiláctica", "piedra pómez", "clorhexidina 0,12 %", "clorhexidina en gel", "polvo de glicina",
    "polvo de eritritol", "membrana de colágeno", "matriz de colágeno", "derivado de la matriz del esmalte", "injerto óseo",
    "fibra de polietileno", "resina para ferulizar", "sutura 5-0", "sutura 6-0", "cemento quirúrgico periodontal",
  ],
  marcas: [
    ["Cavitron", "Dentsply Sirona"], ["Airflow", "EMS"], ["Piezon", "EMS"], ["Guided Biofilm Therapy", "EMS"], ["Emdogain", "Straumann"],
    ["Mucograft", "Geistlich"], ["Fibro-Gide", "Geistlich"], ["Bio-Gide", "Geistlich"], ["Coe-Pak", "GC"], ["Ribbond", "Ribbond"],
    ["everStick", "GC"], ["PerioChip", "Dexcel Pharma"], ["Perio-Aid", "Dentaid"],
  ],
  instrumentos: [
    "sonda periodontal", "sonda Carolina del Norte", "sonda UNC-15", "sonda de Williams", "sonda OMS", "sonda de Nabers",
    "cureta Gracey", "cureta Gracey 5-6", "cureta Gracey 7-8", "cureta Gracey 11-12", "cureta Gracey 13-14", "cureta universal",
    "cureta Columbia", "cureta McCall", "hoz", "azada", "lima periodontal", "punta de ultrasonido", "microbisturí", "tunelizador",
  ],
  hallazgos: [
    "salud periodontal", "salud gingival", "gingivitis inducida por placa", "gingivitis no inducida por placa", "periodontitis",
    "periodontitis estadio I", "periodontitis estadio II", "periodontitis estadio III", "periodontitis estadio IV", "grado A", "grado B",
    "grado C", "periodontitis localizada", "periodontitis generalizada", "patrón molar-incisivo", "enfermedad periodontal necrosante",
    "absceso periodontal", "lesión endoperiodontal", "bolsa periodontal", "pseudobolsa", "profundidad de sondaje", "nivel de inserción clínica",
    "pérdida de inserción", "sangrado al sondaje", "supuración", "recesión gingival", "recesión tipo 1", "recesión tipo 2", "recesión tipo 3",
    "furcación grado I", "furcación grado II", "furcación grado III", "movilidad grado 1", "movilidad grado 2", "movilidad grado 3",
    "pérdida ósea horizontal", "pérdida ósea vertical", "defecto infraóseo", "cálculo supragingival", "cálculo subgingival",
    "placa bacteriana", "biofilm", "agrandamiento gingival", "hiperplasia gingival", "fenotipo gingival delgado", "fenotipo gingival grueso",
    "encía queratinizada insuficiente", "trauma oclusal", "frenillo de inserción alta",
  ],
  medicamentos: ["clorhexidina 0,12 %", "amoxicilina", "metronidazol", "doxiciclina", "azitromicina", "ibuprofeno"],
  conceptos: ["índice de placa de O'Leary", "índice gingival de Löe y Silness", "índice de sangrado", "seis sitios por diente", "sextante", "grupo periodontal", "EPB", "margen gingival", "unión amelocementaria", "encía insertada", "ancho biológico", "tejido supracrestal"],
  sinonimos: [
    ["destartraje", ["detartraje", "tartrectomía"]],
    ["raspado y alisado radicular", ["raspaje y alisado radicular", "pulido radicular"]],
    ["derivado de la matriz del esmalte", ["Emdogain"]],
  ],
  oidoMal: [
    ["destartraje", ["de estar traje", "destar traje", "tatuaje subgingival", "tatuaje supragingival"]],
    ["Gracey", ["gracie", "greisi", "gracy"]],
    ["furcación", ["furca ción", "fur cación"]],
    ["supragingival", ["supra gingival"]],
    ["subgingival", ["sub gingival"]],
  ],
});
