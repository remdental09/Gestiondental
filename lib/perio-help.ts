// Instrucciones breves para el clínico: cómo se realiza y se registra cada índice periodontal.
export type PerioHelpTopic = "epb" | "gingival" | "mobility" | "furcation" | "classification";

export type PerioHelpEntry = { title: string; how: string[]; scale?: string[]; note?: string };

export const PERIO_HELP: Record<PerioHelpTopic, PerioHelpEntry> = {
  epb: {
    title: "Examen Periodontal Básico (EPB)",
    how: [
      "Tamizaje rápido: orienta si hace falta un examen periodontal completo; no es un diagnóstico.",
      "Divide la boca en 6 sextantes: 1.8–1.4, 1.3–2.3, 2.4–2.8, 4.8–4.4, 4.3–3.3 y 3.4–3.8.",
      "Usa sonda OMS (punta esférica de 0,5 mm y banda negra entre 3,5 y 5,5 mm). Sondea con fuerza suave alrededor de cada diente del sextante.",
      "Anota solo el peor hallazgo de cada sextante.",
    ],
    scale: [
      "0 · sano, sin sangrado",
      "1 · sangrado al sondaje",
      "2 · cálculo o margen defectuoso; banda negra completamente visible",
      "3 · bolsa de 3,5 a 5,5 mm; banda negra parcialmente visible",
      "4 · bolsa mayor de 5,5 mm; banda negra no visible",
      "* · lesión de furcación (se agrega al código)",
    ],
    note: "Con código 3, 4 o * corresponde un examen periodontal completo (periodontograma de seis sitios).",
  },
  gingival: {
    title: "Índice Gingival de Löe y Silness",
    how: [
      "Evalúa la inflamación de la encía en 4 sitios por pieza: vestibular, lingual/palatino, mesial y distal.",
      "Seca suavemente la encía y recorre con la sonda la pared blanda del surco, sin penetrar profundo. Observa color, edema y sangrado.",
      "Puntúa cada sitio de 0 a 3. El promedio de los sitios puntuados da la severidad.",
    ],
    scale: [
      "0 · encía normal",
      "1 · leve: cambio de color y edema leve, sin sangrado al sondaje",
      "2 · moderada: enrojecimiento, edema y brillo; sangra al sondaje",
      "3 · severa: enrojecimiento y edema marcados, ulceración, tendencia al sangrado espontáneo",
      "Promedio: 0,1–1 leve · 1,1–2 moderada · 2,1–3 severa",
    ],
  },
  mobility: {
    title: "Movilidad dentaria (Miller)",
    how: [
      "Sujeta la pieza entre los mangos de dos instrumentos (no con los dedos) y empuja en sentido vestibulolingual.",
      "Prueba también el movimiento vertical presionando sobre la cara oclusal.",
      "Registra el grado mayor observado.",
    ],
    scale: [
      "0 · movilidad fisiológica",
      "I · hasta 1 mm en sentido horizontal",
      "II · más de 1 mm en sentido horizontal",
      "III · horizontal y vertical (la pieza se hunde)",
    ],
  },
  furcation: {
    title: "Furcación (Nabers)",
    how: [
      "Solo en molares y premolares superiores con raíces múltiples.",
      "Explora la entrada de la furca con sonda curva de Nabers, siguiendo el contorno de la raíz.",
      "Registra el grado según cuánto penetra la sonda en sentido horizontal.",
    ],
    scale: [
      "I · inicial: penetra menos de 1/3 del ancho del diente",
      "II · parcial: más de 1/3, sin atravesar la furca",
      "III · pasante: atraviesa de lado a lado",
    ],
  },
  classification: {
    title: "Clasificación AAP/EFP 2017",
    how: [
      "La asigna el profesional tras integrar historia, pérdida de inserción, radiografías, complejidad y factores de riesgo. La aplicación no la calcula.",
      "Estadio (gravedad y complejidad): I a IV, según la pérdida de inserción interdental, la pérdida ósea, la pérdida de dientes y la complejidad.",
      "Grado (velocidad de progresión): A lenta, B moderada, C rápida; considera tabaquismo y diabetes.",
      "Extensión: localizada (menos del 30 % de los dientes), generalizada o patrón molar-incisivo.",
    ],
    scale: [
      "Estadio I · pérdida de inserción interdental de 1–2 mm",
      "Estadio II · 3–4 mm",
      "Estadio III · 5 mm o más",
      "Estadio IV · como III, con pérdida de dientes y complejidad mayor",
    ],
  },
};
