import { defineSpecialty } from "../specialty.ts";

export const ORTODONCIA = defineSpecialty({
  id: "ortodoncia",
  nombre: "Ortodoncia y ortopedia dento maxilofacial",
  oficial: "Ortodoncia y ortopedia dento maxilofacial",
  senales: [
    "ortodoncia", "bracket", "brackets", "braquet", "alineador", "alineadores", "arco", "ligadura", "elasticos", "disyuntor",
    "retenedor", "contencion", "maloclusion", "clase ii", "clase iii", "apiñamiento", "mordida cruzada", "mordida abierta", "resalte",
    "overjet", "overbite", "cefalometria", "microimplante", "minitornillo", "expansion", "invisalign",
  ],
  notas: [
    "Clase I, II y III de Angle se refieren a la relación molar; no son las clases de cavidades de Black.",
    "Conserva el calibre y material del arco (p. ej. NiTi 0,014; acero 0,019 × 0,025) tal como se dictó: no son piezas ni montos.",
    "Los elásticos se describen por clase (II, III), fuerza o tamaño y uso; no los cambies.",
  ],
  procedimientos: [
    "instalación de brackets", "cementado de brackets", "recementado de bracket", "cambio de arco", "activación", "control de ortodoncia",
    "colocación de ligaduras", "colocación de cadeneta", "colocación de elásticos intermaxilares", "instalación de bandas", "cementado de tubos",
    "instalación de disyuntor", "activación del disyuntor", "expansión rápida del maxilar", "expansión lenta", "instalación de quad helix",
    "instalación de máscara facial", "instalación de microimplantes", "desgaste interproximal", "stripping", "colocación de attachments",
    "entrega de alineadores", "cambio de alineador", "retiro de aparatología", "descementado", "instalación de retención fija",
    "entrega de placa de Hawley", "entrega de retenedor Essix", "toma de registros", "análisis cefalométrico", "set-up",
    "mantenedor de espacio", "arco lingual", "botón de Nance", "tracción de canino incluido",
  ],
  materiales: [
    "bracket metálico", "bracket cerámico", "bracket de zafiro", "bracket de autoligado", "bracket lingual", "tubo molar", "banda",
    "arco de níquel titanio", "arco NiTi", "arco termoactivado", "arco de acero", "arco TMA", "arco redondo", "arco rectangular",
    "ligadura metálica", "ligadura elástica", "cadeneta elástica", "resorte abierto", "resorte cerrado", "elásticos intermaxilares",
    "alineador", "attachment", "botón", "microimplante", "minitornillo", "placa de Hawley", "retenedor Essix", "retenedor fijo",
    "alambre trenzado", "cemento para bandas", "adhesivo de ortodoncia", "disyuntor tipo Hyrax", "disyuntor de Haas", "quad helix",
    "máscara facial", "mentonera", "activador", "bionator", "Twin Block", "lip bumper", "barra transpalatina",
  ],
  marcas: [
    ["Invisalign", "Align Technology"], ["Damon", "Ormco"], ["In-Ovation", "Dentsply Sirona"], ["Clarity", "Solventum (3M)"],
    ["Transbond XT", "Solventum (3M)"], ["Victory", "Solventum (3M)"], ["Morelli", "Morelli"], ["American Orthodontics", "American Orthodontics"],
    ["Forestadent", "Forestadent"], ["Spark", "Ormco"], ["ClearCorrect", "Straumann"],
  ],
  instrumentos: ["alicate de How", "alicate de Weingart", "alicate de corte distal", "alicate de Mathieu", "posicionador de brackets", "removedor de brackets", "empujador de bandas", "llave del disyuntor"],
  hallazgos: [
    "clase I de Angle", "clase II de Angle", "clase II división 1", "clase II división 2", "clase III de Angle", "apiñamiento leve",
    "apiñamiento moderado", "apiñamiento severo", "diastema", "mordida abierta anterior", "mordida cruzada anterior", "mordida cruzada posterior",
    "mordida profunda", "mordida borde a borde", "resalte aumentado", "sobremordida aumentada", "línea media desviada", "canino incluido",
    "agenesia", "supernumerario", "erupción ectópica", "rotación", "colapso maxilar", "compresión maxilar", "hábito de succión", "deglución atípica",
    "respiración bucal", "bracket despegado", "arco salido", "ligadura suelta", "úlcera por bracket", "recidiva",
  ],
  conceptos: ["overjet", "overbite", "relación molar", "relación canina", "Ricketts", "Steiner", "Jarabak", "ANB", "SNA", "SNB", "patrón braquifacial", "patrón dolicofacial", "patrón mesofacial"],
  sinonimos: [
    ["bracket", ["bráquet", "brackets"]],
    ["overjet", ["resalte"]],
    ["overbite", ["sobremordida"]],
    ["microimplante", ["minitornillo", "TAD"]],
    ["retenedor", ["contención"]],
  ],
  oidoMal: [
    ["bracket", ["braquet", "braket"]],
    ["NiTi", ["niti", "ni ti", "nití"]],
    ["Invisalign", ["invisalain", "invisa line"]],
    ["Hyrax", ["hirax", "iras"]],
  ],
});
