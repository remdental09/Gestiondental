/**
 * Cirugía de implante: el texto de «Procedimientos realizados» lo arma el código a partir de datos
 * extraídos del dictado (anestesia, incisión, descargas, colgajo, implante, torque, injerto, sutura).
 * Así el modelo no puede repetir frases, mezclar descargas ni agregar datos que no se dictaron.
 *
 * Solo se usa cuando el dictado es una instalación de implante clara (implante + medidas o torque).
 * Cada dato exige que esté escrito en el dictado; lo que no aparece, no se escribe.
 */
import { findImplantBrand } from "./implant-brands.ts";

export type SurgeryLine = { text: string; evidence: string };

const NUMBER_WORDS = "un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\\d{1,2}";
const decimal = (value: string) => value.replace(".", ",");
const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Piezas FDI con punto («4.4») dichas en el texto, sin repetir. */
const teethIn = (text: string) => [...new Set([...text.matchAll(/(?<![\d.,])([1-8])\.([1-8])(?![\d.,]?\d)/g)].map((match) => `${match[1]}.${match[2]}`))];

const INCISION_KINDS: Array<[RegExp, string]> = [
  [/incisi[oó]n\s+supra\s*crestal/i, "supracrestal"],
  [/incisi[oó]n\s+medio\s*crestal/i, "mediocrestal"],
  [/incisi[oó]n\s+para\s*crestal/i, "paracrestal"],
  [/incisi[oó]n\s+crestal/i, "crestal"],
  [/incisi[oó]n\s+intra\s*surcular/i, "intrasurcular"],
  [/incisi[oó]n\s+palatinizada/i, "palatinizada"],
  [/incisi[oó]n\s+(?:semilunar|de\s+partsch)/i, "semilunar"],
];

export function implantSurgeryLines(transcript: string): SurgeryLine[] | null {
  const text = transcript.replace(/\s+/g, " ");
  const size = /implantes?\s+(?:dental\s+)?(?:de\s+)?(\d{1,2}(?:[.,]\d)?)\s*(?:mm|mil[ií]metros?)?\s*(?:por|x|×)\s*(\d{1,2}(?:[.,]\d)?)\s*(?:mm|mil[ií]metros?)?/i.exec(text);
  const torque = /(?<![\d.,])(\d{2,3})\s*(?:N\s*[·.\-]?\s*cm|newtons?\s+cent[ií]metros?)/i.exec(text);
  // Solo una instalación clara de implante: se dijo que se colocó/instaló/puso y hay medidas o torque.
  if (!/\b(?:coloc|instal|puso|pusimos|inserci|insert)\w*/i.test(text) || !(size || torque)) return null;
  // Cirugías combinadas (extracción, seno, regeneración, biopsia): el texto lo sigue escribiendo el modelo.
  if (/\b(?:exodoncia|extracci[oó]n|extra[ií]|elevaci[oó]n\s+de\s+seno|regeneraci[oó]n|aumento\s+(?:de\s+)?(?:reborde|hueso)|biopsia|membrana)\b/i.test(text)) return null;

  const lines: SurgeryLine[] = [];
  const add = (line: string, evidence: string) => lines.push({ text: line, evidence: evidence.trim().slice(0, 300) });

  const anesthesia = new RegExp(`(${NUMBER_WORDS})\\s+(tubos?|tubetes?|cartuchos?)\\s+(?:de\\s+)?(?:anestesia(?:\\s+(?:de\\s+|con\\s+))?)?(lidoca[ií]na|artica[ií]na|mepivaca[ií]na)?`, "i").exec(text);
  if (anesthesia && /anestesia|lidoca|artica|mepivaca/i.test(anesthesia[0] + text.slice(anesthesia.index, anesthesia.index + 80))) {
    const agent = /lidoca[ií]na|artica[ií]na|mepivaca[ií]na/i.exec(text.slice(anesthesia.index, anesthesia.index + 80))?.[0];
    const amount = `${anesthesia[1].toLowerCase()} ${anesthesia[2].toLowerCase()}`;
    add(`Se administra anestesia con ${amount}${agent ? ` de ${plain(agent) === "lidocaina" ? "lidocaína" : plain(agent) === "articaina" ? "articaína" : "mepivacaína"}` : ""}.`, text.slice(anesthesia.index, anesthesia.index + 90));
  }

  const incision = INCISION_KINDS.find(([pattern]) => pattern.test(text));
  const neumann = /descargas?\s+de\s+Neumann(?:\s+(parcial|completa|modificada))?(?:\s+hacia\s+(?:la\s+|el\s+)?(?:pieza|diente)\s+([1-8]\.[1-8]))?/i.exec(text);
  const avoidsPapilla = /\b(?:evadiendo|evitando|respetando|sin\s+(?:lesionar|da[ñn]ar|tocar))\s+la\s+papila\s+(?:del\s+)?(?:diente\s+)?(?:vecino|adyacente)?/i.test(text);
  if (incision || neumann) {
    const evidence = [incision && text.match(incision[0])?.[0], neumann?.[0]].filter(Boolean).join("; ");
    const parts = [`Se realiza incisión${incision ? ` ${incision[1]}` : ""}`];
    if (neumann) parts.push(`con descarga de Neumann${neumann[1] ? ` ${neumann[1].toLowerCase()}` : ""}${neumann[2] ? ` hacia la pieza ${neumann[2]}` : ""}`);
    add(`${parts.join(" ")}${avoidsPapilla ? ", evitando la papila del diente vecino" : ""}.`, evidence);
  }

  const flap = /colgajo\s+de\s+espesor\s+(total|parcial|mixto)/i.exec(text) || /\bflapless\b|sin\s+colgajo/i.exec(text);
  if (flap) add(/flapless|sin\s+colgajo/i.test(flap[0]) ? "Se realiza la cirugía sin colgajo (flapless)." : `Se levanta colgajo de espesor ${flap[1].toLowerCase()}.`, flap[0]);

  const tooth = teethIn(text.slice(Math.max(0, (size?.index ?? 0) - 120), (size?.index ?? 0) + 200))[0] ?? teethIn(text)[0];
  const brand = findImplantBrand(text);
  if (size) {
    const dims = `${decimal(size[1])} × ${decimal(size[2])} mm`;
    const mark = brand ? `${brand.company.startsWith("FGM") ? "FGM " : ""}${brand.brand}` : "";
    add(`Se instala un implante${mark ? ` ${mark}` : ""} de ${dims}${tooth ? ` en la pieza ${tooth}` : ""}${torque ? `, con torque de inserción de ${torque[1]} N·cm` : ""}.`, `${size[0]}${torque ? `; ${torque[0]}` : ""}`);
  } else if (torque) {
    add(`Se instala un implante${tooth ? ` en la pieza ${tooth}` : ""}, con torque de inserción de ${torque[1]} N·cm.`, torque[0]);
  }

  if (/\b(?:no\s+(?:se\s+)?(?:us(?:a|ó|amos|o)|utiliz(?:a|ó|amos|o)|requiri(?:ó|mos))|sin|no\s+hubo)\s+(?:de\s+)?injerto/i.test(text)) add("No se utiliza injerto.", /\b(?:no\s+\w+\s+|sin\s+)injerto/i.exec(text)?.[0] ?? "sin injerto");

  const suture = new RegExp(`cierre\\s+con\\s+(${NUMBER_WORDS})\\s+puntos?(?:\\s+(?:con|de)\\s+(?:la\\s+)?sutura\\s+([\\p{L}0-9-]+))?`, "iu").exec(text);
  if (suture) add(`Se realiza cierre con ${suture[1].toLowerCase()} puntos${suture[2] ? ` de sutura ${suture[2]}` : ""}.`, suture[0]);

  return lines.length >= 2 ? lines : null;
}

/** Línea que el código reemplaza: el modelo no la repite si el código ya la escribió. */
export const SURGERY_TOPIC = /anestesi|tubos?\s+de|tubetes?|lidoca|incisi[oó]n|descarga|colgajo|flapless|implante|torque|injerto|sutura|cierre|puntos?\b|vicryl/i;

/** Preguntas amarillas cuando el dictado de una cirugía de implante es ambiguo (no se adivina). */
export function surgeryQuestions(transcript: string): string[] {
  const text = transcript.replace(/\s+/g, " ");
  if (!implantSurgeryLines(text)) return [];
  const questions: string[] = [];
  if (/descargas?\s+de\s+espesor\s+(total|parcial)/i.test(text) && !/colgajo\s+de\s+espesor/i.test(text)) {
    questions.push("IA: Dictaste «descarga de espesor total». ¿Quisiste decir «colgajo de espesor total»? Si es así, se agrega «Se levanta colgajo de espesor total».");
  }
  if ((text.match(/\bdescargas?\b/gi) ?? []).length >= 3 && /descargas?\s+hasta\s+(?:la\s+)?mucosa/i.test(text)) {
    questions.push("IA: Aparecen varias «descargas» en el dictado (Neumann, «hasta la mucosa»). ¿Es una sola descarga o hay más de una? Indica cuántas y en qué piezas.");
  }
  return questions;
}
