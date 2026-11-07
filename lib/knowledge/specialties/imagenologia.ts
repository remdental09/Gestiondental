import { defineSpecialty } from "../specialty.ts";

export const IMAGENOLOGIA = defineSpecialty({
  id: "imagenologia",
  nombre: "Imagenología oral y maxilofacial",
  oficial: "Imagenología oral y maxilofacial",
  senales: ["radiografia", "rx", "panoramica", "periapical", "bitewing", "aleta de mordida", "cbct", "tomografia", "cone beam", "telerradiografia", "radiolucido", "radiopaco", "radiolucidez", "radiopacidad"],
  notas: [
    "Un hallazgo radiográfico se describe (radiolúcido, radiopaco, mixto, bien o mal definido, ubicación) y no equivale por sí solo a un diagnóstico.",
    "Conserva el tipo de examen dictado (periapical, bitewing, panorámica, CBCT) y su fecha si se dijo.",
  ],
  procedimientos: ["radiografía periapical", "radiografía bitewing", "radiografía de aleta de mordida", "radiografía oclusal", "radiografía panorámica", "ortopantomografía", "telerradiografía lateral", "telerradiografía frontal", "tomografía computarizada de haz cónico", "CBCT", "técnica paralela", "técnica de bisectriz", "técnica de Clark", "informe radiológico", "planificación digital"],
  materiales: ["sensor digital", "placa de fósforo", "posicionador", "posicionador Rinn", "delantal plomado", "protector tiroideo"],
  marcas: [["Planmeca", "Planmeca"], ["Carestream", "Carestream Dental"], ["Vatech", "Vatech"], ["Orthophos", "Dentsply Sirona"], ["Sidexis", "Dentsply Sirona"], ["Romexis", "Planmeca"], ["Kodak", "Carestream Dental"]],
  hallazgos: [
    "radiolucidez", "radiopacidad", "lesión radiolúcida", "lesión radiopaca", "lesión mixta", "bien definida", "mal definida", "corticalizada",
    "lámina dura", "pérdida de lámina dura", "ensanchamiento del espacio del ligamento periodontal", "pérdida ósea horizontal", "pérdida ósea vertical",
    "defecto óseo", "reabsorción radicular", "calcificación pulpar", "conducto mandibular", "canal mandibular", "agujero mentoniano", "seno maxilar",
    "piso del seno maxilar", "conducto nasopalatino", "artefacto", "imagen compatible con", "sobreobturación", "obturación de conductos adecuada",
  ],
  conceptos: ["densidad ósea", "altura ósea disponible", "ancho óseo disponible", "corte axial", "corte coronal", "corte sagital", "reconstrucción panorámica", "DICOM", "campo de visión"],
  sinonimos: [["radiografía bitewing", ["radiografía de aleta de mordida", "bite wing"]], ["tomografía computarizada de haz cónico", ["CBCT", "cone beam", "scanner dental"]]],
  oidoMal: [["bitewing", ["bait wing", "baiguin"]], ["CBCT", ["ce be ce te", "cbc t"]]],
});
