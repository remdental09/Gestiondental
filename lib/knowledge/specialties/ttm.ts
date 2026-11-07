import { defineSpecialty } from "../specialty.ts";

export const TTM = defineSpecialty({
  id: "ttm",
  nombre: "Trastornos temporomandibulares y dolor orofacial",
  oficial: "Trastornos temporomandibulares y dolor orofacial",
  senales: [
    "atm", "articulacion temporomandibular", "temporomandibular", "bruxismo", "apretamiento", "ferula", "chasquido", "crepitacion",
    "apertura", "dolor miofascial", "masetero", "maseteros", "musculo temporal", "trismus", "disco", "desplazamiento discal", "cefalea", "dolor orofacial",
  ],
  notas: [
    "Conserva la apertura máxima en milímetros, con o sin dolor, y la presencia de desviación o deflexión, tal como se dictó.",
    "Un diagnóstico de TTM (criterios DC/TMD) solo se registra si el profesional lo dictó; los síntomas (chasquido, dolor) no son diagnóstico.",
  ],
  procedimientos: ["examen de ATM", "palpación muscular", "medición de apertura", "instalación de férula oclusal", "ajuste de férula", "control de férula", "terapia física", "termoterapia", "ejercicios mandibulares", "artrocentesis", "infiltración con toxina botulínica", "infiltración de puntos gatillo", "educación en autocuidado", "ajuste oclusal"],
  materiales: ["férula oclusal", "férula de relajación", "férula de Michigan", "férula rígida", "férula blanda", "férula de reposicionamiento anterior"],
  hallazgos: [
    "mialgia", "dolor miofascial", "dolor miofascial con referencia", "artralgia", "desplazamiento discal con reducción", "desplazamiento discal sin reducción",
    "desplazamiento discal sin reducción con limitación de apertura", "enfermedad degenerativa articular", "subluxación", "luxación", "chasquido",
    "crepitación", "desviación en apertura", "deflexión", "apertura limitada", "bloqueo cerrado", "bloqueo abierto", "bruxismo del sueño",
    "bruxismo de vigilia", "apretamiento", "facetas de desgaste", "hipertrofia maseterina", "cefalea atribuida a TTM", "neuralgia del trigémino",
    "dolor neuropático", "odontalgia atípica", "puntos gatillo",
  ],
  medicamentos: ["ciclobenzaprina", "clonazepam", "amitriptilina", "ibuprofeno", "naproxeno", "paracetamol", "toxina botulínica", "carbamazepina", "pregabalina", "gabapentina"],
  conceptos: ["DC/TMD", "apertura máxima", "apertura máxima sin dolor", "lateralidad", "protrusión", "masetero", "temporal", "pterigoideo lateral", "pterigoideo medial", "esternocleidomastoideo"],
  sinonimos: [["articulación temporomandibular", ["ATM"]], ["férula oclusal", ["placa de relajación", "plano de mordida", "placa miorrelajante"]]],
  oidoMal: [["masetero", ["macetero", "maseteros"]], ["crepitación", ["crepita ción"]]],
});
