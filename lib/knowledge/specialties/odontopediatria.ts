import { defineSpecialty } from "../specialty.ts";

export const ODONTOPEDIATRIA = defineSpecialty({
  id: "odontopediatria",
  nombre: "Odontopediatría",
  oficial: "Odontopediatría",
  senales: [
    "temporal", "temporales", "decidua", "deciduo", "de leche", "dentición mixta", "nino", "nina", "paciente pediatrico",
    "odontopediatria", "pulpotomia", "corona de acero", "corona preformada", "mantenedor de espacio", "tecnica de hall", "avulsion",
    "luxacion", "intrusion", "trauma dentoalveolar", "hipomineralizacion", "mih", "caries de la infancia temprana",
  ],
  notas: [
    "La dentición temporal usa FDI 51–85 o letras chilenas A–T; no la confundas con piezas permanentes.",
    "Los traumatismos dentoalveolares se registran por tipo (concusión, subluxación, luxación extrusiva/lateral/intrusiva, avulsión, fracturas) sin inferir el tratamiento.",
    "Conserva las técnicas de manejo de conducta tal como se dictaron (decir-mostrar-hacer, refuerzo positivo).",
  ],
  procedimientos: [
    "pulpotomía", "pulpotomía con MTA", "pulpotomía con Biodentine", "pulpotomía con formocresol", "pulpectomía en diente temporal",
    "corona de acero preformada", "técnica de Hall", "corona de circonio pediátrica", "restauración atraumática", "sellante de fosas y fisuras",
    "barniz de flúor", "aplicación de diamino fluoruro de plata", "exodoncia de diente temporal", "mantenedor de espacio banda-ansa",
    "mantenedor de espacio fijo", "arco lingual", "ferulización flexible", "reposición de diente luxado", "reimplante de diente avulsionado",
    "apexificación", "revascularización pulpar", "control de erupción", "manejo de conducta", "técnica decir-mostrar-hacer",
    "refuerzo positivo", "sedación con óxido nitroso", "anestesia tópica", "educación a los padres", "asesoría dietética",
  ],
  materiales: [
    "corona de acero inoxidable", "corona preformada", "ionómero de vidrio de alta viscosidad", "MTA", "formocresol", "sulfato férrico",
    "pasta de óxido de zinc eugenol", "pasta yodoformada", "hidróxido de calcio con yodoformo", "barniz de flúor", "diamino fluoruro de plata",
    "sellante", "férula de alambre y composite",
  ],
  marcas: [["Vitapex", "Neo Dental"], ["Metapex", "Meta Biomed"], ["NuSmile", "NuSmile"], ["Riva Star", "SDI"], ["Duraphat", "Colgate"], ["Clinpro White Varnish", "Solventum (3M)"], ["Fuji IX", "GC"]],
  hallazgos: [
    "caries de la infancia temprana", "caries rampante", "dentición temporal", "dentición mixta", "exfoliación", "persistencia de diente temporal",
    "erupción ectópica", "anquilosis de molar temporal", "infraoclusión", "agenesia", "diente supernumerario", "mesiodens",
    "hipomineralización incisivo-molar", "hipoplasia del esmalte", "fluorosis", "concusión", "subluxación", "luxación extrusiva",
    "luxación lateral", "luxación intrusiva", "avulsión", "fractura de esmalte", "fractura coronaria no complicada", "fractura coronaria complicada",
    "fractura radicular", "fractura alveolar", "decoloración post trauma", "absceso en diente temporal", "fístula", "hábito de succión digital",
    "uso de chupete", "bruxismo infantil",
  ],
  conceptos: ["Frankl", "riesgo cariogénico", "índice ceo-d", "índice COPD", "letra A", "letra T", "FDI 5.5", "FDI 8.5"],
  sinonimos: [
    ["diente temporal", ["diente de leche", "diente deciduo", "diente primario"]],
    ["hipomineralización incisivo-molar", ["MIH", "HIM"]],
  ],
  oidoMal: [["técnica de Hall", ["técnica de jol", "técnica de hol"]], ["Vitapex", ["vita pex", "bitapex"]], ["formocresol", ["formo cresol"]]],
});
