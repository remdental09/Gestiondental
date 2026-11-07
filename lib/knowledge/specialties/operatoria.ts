import { defineSpecialty } from "../specialty.ts";

/** Operatoria / odontología restauradora general (no es especialidad certificada, pero es lo más dictado). */
export const OPERATORIA = defineSpecialty({
  id: "operatoria",
  nombre: "Operatoria y odontología restauradora",
  oficial: null,
  senales: [
    "caries", "obturacion", "restauracion", "resina", "composite", "amalgama", "ionomero", "sellante", "tapadura", "empaste",
    "mesial", "distal", "oclusal", "vestibular", "palatino", "lingual", "incisal", "cavidad", "aislamiento", "dique", "adhesivo", "grabado",
    "fotocurado", "bulk fill", "flow", "barniz", "fluor",
  ],
  notas: [
    "Conserva las caras (M, O, D, V, P/L, I) y la profundidad de la caries (esmalte, dentina superficial, dentina profunda, compromiso pulpar) tal como se dictaron.",
    "«Compósito» es un error de la voz por «composite»; «tapadura», «obturación» y «empaste» son sinónimos regionales válidos.",
    "Conserva la marca y el color de la resina (p. ej. A2) y la técnica adhesiva (grabado total, autograbado, selectivo).",
  ],
  procedimientos: [
    "restauración de composite", "restauración de resina compuesta", "restauración de amalgama", "restauración de ionómero de vidrio",
    "restauración clase I", "restauración clase II", "restauración clase III", "restauración clase IV", "restauración clase V",
    "eliminación de caries", "remoción selectiva de caries", "preparación cavitaria", "aislamiento absoluto", "aislamiento relativo",
    "grabado ácido", "grabado total", "autograbado", "grabado selectivo del esmalte", "aplicación de adhesivo", "técnica incremental",
    "técnica bulk fill", "fotopolimerización", "base cavitaria", "liner", "terminación y pulido", "ajuste oclusal", "sellante de fosas y fisuras",
    "sellante preventivo", "restauración preventiva de resina", "barniz de flúor", "aplicación de flúor", "aplicación de diamino fluoruro de plata",
    "restauración atraumática", "ART", "reconstrucción de ángulo", "cierre de diastema", "carilla directa de resina", "blanqueamiento",
    "blanqueamiento en consulta", "blanqueamiento ambulatorio", "microabrasión", "infiltración de resina", "pulido de restauraciones",
    "recambio de restauración", "reparación de restauración",
  ],
  materiales: [
    "resina compuesta", "composite", "resina nanohíbrida", "resina microhíbrida", "resina bulk fill", "resina fluida", "flow",
    "ionómero de vidrio", "ionómero de vidrio de alta viscosidad", "ionómero modificado con resina", "amalgama", "adhesivo universal",
    "ácido fosfórico al 37 %", "primer", "sellante de resina", "barniz de flúor al 5 %", "diamino fluoruro de plata", "hidróxido de calcio",
    "dique de goma", "clamp", "matriz metálica", "matriz seccional", "anillo separador", "cuña de madera", "cuña plástica", "hilo dental",
    "tiras de pulir", "discos de pulido", "gomas de pulir", "peróxido de hidrógeno", "peróxido de carbamida",
  ],
  marcas: [
    ["Filtek Z350 XT", "Solventum (3M)"], ["Filtek Z250", "Solventum (3M)"], ["Filtek Bulk Fill", "Solventum (3M)"], ["Single Bond Universal", "Solventum (3M)"],
    ["Scotchbond Universal", "Solventum (3M)"], ["Ketac Molar", "Solventum (3M)"], ["Vitrebond", "Solventum (3M)"], ["Clinpro", "Solventum (3M)"],
    ["Sof-Lex", "Solventum (3M)"], ["Tetric N-Ceram", "Ivoclar"], ["Tetric N-Ceram Bulk Fill", "Ivoclar"], ["Tetric EvoCeram", "Ivoclar"],
    ["Helioseal", "Ivoclar"], ["Adhese Universal", "Ivoclar"], ["Estelite", "Tokuyama"], ["Palfique", "Tokuyama"], ["Charisma", "Kulzer"],
    ["Brilliant EverGlow", "Coltene"], ["Clearfil SE Bond", "Kuraray Noritake"], ["Clearfil Majesty", "Kuraray Noritake"], ["SDR", "Dentsply Sirona"],
    ["Palodent", "Dentsply Sirona"], ["Fuji IX", "GC"], ["Fuji II LC", "GC"], ["Equia Forte", "GC"], ["Riva Star", "SDI"], ["Duraphat", "Colgate"],
    ["Opalescence", "Ultradent"], ["Whiteness", "FGM"], ["Icon", "DMG"], ["Tofflemire", "Tofflemire"],
  ],
  instrumentos: [
    "turbina", "micromotor", "contraángulo", "fresa redonda", "fresa de carburo", "fresa diamantada", "fresa de pera", "explorador",
    "cucharita", "excavador", "espátula de resina", "gutaperchero", "bruñidor", "portamatriz", "porta amalgama", "lámpara LED", "radiómetro",
  ],
  hallazgos: [
    "caries de esmalte", "caries dentinaria", "caries dentinaria superficial", "caries dentinaria profunda", "caries con compromiso pulpar",
    "caries activa", "caries detenida", "caries secundaria", "caries radicular", "mancha blanca", "lesión no cavitada", "lesión cavitada",
    "fractura de esmalte", "fractura coronaria", "cúspide fracturada", "restauración desadaptada", "filtración", "sensibilidad dentinaria",
    "hipersensibilidad dentinaria", "abfracción", "abrasión", "erosión", "atrición", "fluorosis", "pigmentación", "diente decolorado",
  ],
  conceptos: ["clase I de Black", "clase II de Black", "clase III de Black", "clase IV de Black", "clase V de Black", "cavidad MO", "cavidad OD", "cavidad MOD", "ICDAS", "color A2", "color A3", "punto de contacto", "reborde marginal"],
  sinonimos: [
    ["obturación", ["tapadura", "empaste", "restauración", "calza"]],
    ["composite", ["resina compuesta"]],
    ["ionómero de vidrio", ["vidrio ionómero", "ionómero vítreo"]],
    ["dique de goma", ["goma dique", "aislamiento absoluto"]],
  ],
  oidoMal: [
    ["composite", ["compósito", "composito", "compo site"]],
    ["mesial", ["mecial", "mesia", "me sial"]],
    ["oclusal", ["oclusar", "oclu sal", "o clusal"]],
    ["vestibular", ["bestibular"]],
    ["obturación", ["obturasion", "ovturación"]],
    ["Filtek", ["filtec", "fil tek"]],
    ["Tetric", ["tetrik"]],
  ],
});
