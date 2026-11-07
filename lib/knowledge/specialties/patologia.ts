import { defineSpecialty } from "../specialty.ts";

export const PATOLOGIA = defineSpecialty({
  id: "patologia",
  nombre: "Patología oral y maxilofacial",
  oficial: "Patología oral y maxilofacial",
  senales: [
    "lesion", "leucoplasia", "eritroplasia", "liquen", "ulcera", "afta", "candidiasis", "biopsia", "mucocele", "fibroma", "papiloma",
    "quiste", "tumor", "carcinoma", "nodulo", "placa blanca", "mancha roja", "herpes", "queilitis", "osteonecrosis", "xerostomia",
  ],
  notas: [
    "Describe la lesión como se dictó (ubicación, tamaño, color, superficie, consistencia, base, evolución); no conviertas una descripción en diagnóstico.",
    "Un diagnóstico de patología oral dictado como «sospecha», «compatible con» o «a descartar» no es confirmado: queda como sospecha y se pregunta.",
  ],
  procedimientos: ["biopsia incisional", "biopsia excisional", "biopsia por punción", "citología exfoliativa", "tinción con azul de toluidina", "fotografía clínica", "derivación a patología oral", "estudio histopatológico", "control de lesión"],
  hallazgos: [
    "leucoplasia", "leucoplasia homogénea", "leucoplasia no homogénea", "eritroplasia", "eritroleucoplasia", "liquen plano oral", "liquen plano reticular",
    "liquen plano erosivo", "candidiasis pseudomembranosa", "candidiasis eritematosa", "queilitis angular", "queilitis actínica",
    "estomatitis aftosa recurrente", "afta menor", "afta mayor", "herpes labial", "gingivoestomatitis herpética", "úlcera traumática",
    "mucocele", "ránula", "fibroma traumático", "hiperplasia fibrosa", "épulis fisurado", "granuloma piógeno", "granuloma periférico de células gigantes",
    "papiloma", "verruga vulgar", "lengua geográfica", "lengua fisurada", "lengua saburral", "glositis", "torus", "exostosis", "nevo",
    "mácula melanótica", "tatuaje por amalgama", "quiste radicular", "quiste dentígero", "queratoquiste odontogénico", "ameloblastoma",
    "odontoma", "carcinoma espinocelular", "carcinoma de células escamosas", "osteonecrosis maxilar asociada a medicamentos",
    "osteorradionecrosis", "xerostomía", "hiposalivación", "síndrome de boca ardiente", "sialolito", "sialoadenitis", "pénfigo vulgar",
    "penfigoide de membranas mucosas", "eritema multiforme", "lesión blanca", "lesión roja", "lesión pigmentada", "lesión ulcerada",
    "lesión exofítica", "lesión sésil", "lesión pediculada", "adenopatía",
  ],
  medicamentos: ["nistatina", "miconazol gel", "fluconazol", "aciclovir", "valaciclovir", "clobetasol", "triamcinolona en orabase", "bencidamina", "lidocaína viscosa", "pilocarpina", "saliva artificial"],
  conceptos: ["bordes definidos", "bordes irregulares", "base indurada", "consistencia blanda", "consistencia firme", "superficie lisa", "superficie rugosa", "tiempo de evolución", "factor desencadenante"],
  sinonimos: [["carcinoma espinocelular", ["carcinoma de células escamosas", "carcinoma epidermoide"]], ["osteonecrosis maxilar asociada a medicamentos", ["MRONJ", "osteonecrosis por bifosfonatos"]]],
  oidoMal: [["leucoplasia", ["leuco plasia", "leucoplacia"]], ["mucocele", ["muco cele", "mucosele"]], ["ránula", ["ranula", "rana"]]],
});
