/**
 * Dictado guiado del periodontograma: la aplicación lleva el orden, anuncia la pieza y el paso, y el clínico
 * solo responde. Lógica pura (sin micrófono ni voz) para poder probarla: cada frase oída produce el estado
 * siguiente, lo que la aplicación dice y, si corresponde, las medidas a aplicar.
 *
 * Por pieza: sondaje vestibular → sondaje palatino/lingual → margen vestibular → margen palatino/lingual →
 * sangrado y supuración. Siempre tres valores de mesial a distal.
 */
import { describePerioDictation, spokenPerioValues, type PerioDictationSite, type PerioDictationTooth } from "./perio-dictation.ts";

export type GuideStep = "depthV" | "depthL" | "marginV" | "marginL" | "flags";
export type GuideState = { order: number[]; index: number; step: GuideStep; buffer: number[]; absent: number[]; paused: boolean; done: boolean };
export type GuideOutcome = { state: GuideState; say: string; apply?: PerioDictationTooth; markedAbsent?: number };

const STEPS: GuideStep[] = ["depthV", "depthL", "marginV", "marginL", "flags"];
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48];
const DIGIT = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const FACE_KEYS: Record<"V" | "L", [PerioDictationSite, PerioDictationSite, PerioDictationSite]> = { V: ["MV", "V", "DV"], L: ["ML", "L", "DL"] };

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (text: string, pattern: RegExp) => pattern.test(text);
export const spokenTooth = (tooth: number) => `${DIGIT[Math.floor(tooth / 10)]} ${DIGIT[tooth % 10]}`;
export const innerFace = (tooth: number) => (tooth < 30 ? "palatino" : "lingual");
export const guideFace = (step: GuideStep): "vestibular" | "lingual" => (step === "depthL" || step === "marginL" ? "lingual" : "vestibular");
const spokenValues = (values: number[]) => values.map(value => (value < 0 ? `menos ${-value}` : String(value))).join(", ");

/** Recorrido: 1.8 → 2.8 y luego 3.8 → 4.8, sin las piezas ausentes ni los implantes del odontograma. */
export function guideOrder(statuses: Record<number, string | undefined>): number[] {
  return [...UPPER, ...LOWER].filter(tooth => { const status = statuses[tooth] ?? ""; return status !== "Ausente" && !status.startsWith("Implante"); });
}

export function guidePrompt(state: GuideState, name = ""): string {
  if (state.done) return "Examen terminado. Revisa la arcada y guarda el examen.";
  const tooth = state.order[state.index], inner = innerFace(tooth), who = name ? `, ${name},` : "";
  switch (state.step) {
    case "depthV": return `Pieza ${spokenTooth(tooth)}. Sondaje vestibular, de mesial a distal.`;
    case "depthL": return `Sondaje ${inner}.`;
    case "marginV": return `Ahora${who} dime el margen gingival vestibular.`;
    case "marginL": return `Margen gingival ${inner}.`;
    default: return `Pieza ${spokenTooth(tooth)}: ¿sangrado o supuración?`;
  }
}

export function guideStart(statuses: Record<number, string | undefined>, name = "", from?: number): GuideOutcome {
  const order = guideOrder(statuses);
  const index = Math.max(0, from ? order.indexOf(from) : 0);
  const state: GuideState = { order, index, step: "depthV", buffer: [], absent: [], paused: false, done: order.length === 0 };
  if (state.done) return { state, say: "No hay piezas para sondear según el odontograma." };
  return { state, say: `Comenzamos. Son ${order.length} piezas. ${guidePrompt(state, name)}` };
}

type FlagSites = Partial<Record<PerioDictationSite, { bleeding?: boolean; suppuration?: boolean }>>;
/** «sangrado mesial vestibular y supuración distal palatino» → sitios marcados. Un sitio sin cara es ambiguo y se pregunta. */
export function parseGuideFlags(text: string): { sites: FlagSites } | { error: string } {
  const words = fold(text).match(/[a-zñ]+/g) ?? [];
  const sites: FlagSites = {};
  let field: "bleeding" | "suppuration" | null = null, faces = new Set<"V" | "L">(), spots = new Set<number>(), exact: PerioDictationSite[] = [], any = false, problem = "";
  const close = () => {
    if (!field) return;
    if (!faces.size && spots.size) { problem = "Di también la cara: vestibular, palatino o lingual."; return; }
    const useFaces = faces.size ? [...faces] : exact.length ? [] : (["V", "L"] as const);
    const useSpots = spots.size ? [...spots] : [0, 1, 2];
    for (const face of useFaces) for (const k of useSpots) (sites[FACE_KEYS[face][k]] ??= {})[field] = true;
    for (const key of exact) (sites[key] ??= {})[field] = true;
    any = true; faces = new Set(); spots = new Set(); exact = [];
  };
  for (const word of words) {
    if (/^(sangrado|sangra|sangran|sangramiento|sangrante|hemorragia)$/.test(word)) { close(); field = "bleeding"; continue; }
    if (/^(supuracion|supura|supuran|pus)$/.test(word)) { close(); field = "suppuration"; continue; }
    if (!field) continue;
    if (/^(vestibular|vestibulares|bucal)$/.test(word)) faces.add("V");
    else if (/^(palatino|palatina|palatal|lingual|linguales|palatinos)$/.test(word)) faces.add("L");
    else if (/^(mesial|mesiales)$/.test(word)) spots.add(0);
    else if (/^(central|centro|medio|media)$/.test(word)) spots.add(1);
    else if (/^(distal|distales)$/.test(word)) spots.add(2);
    else if (/^(todos|todas|generalizado|generalizada|completo)$/.test(word)) { faces.add("V"); faces.add("L"); }
    else {
      const compound = word.match(/^(mesio|disto|medio|centro)(vestibular|bucal|palatino|palatina|palatal|lingual)$/);
      if (compound) exact.push(FACE_KEYS[/^(vestibular|bucal)$/.test(compound[2]) ? "V" : "L"][compound[1] === "mesio" ? 0 : compound[1] === "disto" ? 2 : 1]);
    }
  }
  close();
  if (problem) return { error: problem };
  if (!any) return { error: "No entendí. Di «sangrado», «supuración», la cara y el sitio, o «nada»." };
  return { sites };
}

export function guideHear(current: GuideState, utterance: string, name = ""): GuideOutcome {
  const text = fold(utterance).trim();
  const state: GuideState = { ...current, buffer: [...current.buffer], absent: [...current.absent] };
  if (state.done || !text) return { state, say: "" };
  const tooth = state.order[state.index];
  const goTooth = (index: number, lead = ""): GuideOutcome => {
    state.buffer = [];
    if (index >= state.order.length) { state.done = true; return { state, say: `${lead}Examen completo. Revisa la arcada y guarda el examen.` }; }
    state.index = Math.max(0, index); state.step = "depthV";
    return { state, say: `${lead}${guidePrompt(state, name)}` };
  };

  if (has(text, /\b(terminar|termina|termino|finalizar|finaliza)\b/)) { state.done = true; state.buffer = []; return { state, say: "Examen terminado. Revisa la arcada y guarda el examen." }; }
  if (state.paused) {
    if (has(text, /\b(continuar|continua|reanudar|seguir|sigamos)\b/)) { state.paused = false; return { state, say: guidePrompt(state, name) }; }
    return { state, say: "" };
  }
  if (has(text, /\b(pausa|pausar|espera)\b/)) { state.paused = true; return { state, say: "En pausa. Di «continuar» cuando quieras seguir." }; }
  if (has(text, /\b(repetir|repite|repito|corregir|corrige|borrar|borra|de nuevo)\b/)) { state.buffer = []; return { state, say: guidePrompt(state, name) }; }
  if (has(text, /\b(atras|anterior|volver|vuelve)\b/)) {
    state.buffer = [];
    const at = STEPS.indexOf(state.step);
    if (at > 0) { state.step = STEPS[at - 1]; return { state, say: guidePrompt(state, name) }; }
    return goTooth(state.index - 1);
  }
  if (has(text, /\b(ausente|ausencia|falta|no esta|extraida|perdida)\b/)) {
    state.absent.push(tooth); state.order = state.order.filter(item => item !== tooth);
    const out = goTooth(state.index, `Pieza ${spokenTooth(tooth)} ausente. `);
    return { ...out, markedAbsent: tooth };
  }
  if (has(text, /\b(saltar|salta|salto|omitir|omite|siguiente pieza)\b/)) return goTooth(state.index + 1);

  if (state.step === "flags") {
    // «sangrado vestibular, sin supuración»: lo negado se descarta y lo demás se marca.
    const affirmed = text.replace(/\b(sin|no|ni|tampoco)\s+(hay\s+)?(sangrado|sangra|sangramiento|supuracion|supura|pus)\b/g, " ");
    const mentions = has(affirmed, /\b(sangrado|sangra|sangran|sangramiento|sangrante|hemorragia|supuracion|supura|supuran|pus)\b/);
    if (!mentions) {
      if (has(text, /\b(nada|no|ninguno|ninguna|sin|sano|sana|negativo)\b/) && !has(text, /\bnada mas\b/)) return goTooth(state.index + 1, "Sin sangrado ni supuración. ");
      if (has(text, /\b(siguiente|listo|lista|continuar|continua|eso es todo|nada mas|ok)\b/)) return goTooth(state.index + 1);
    }
    const parsed = parseGuideFlags(affirmed);
    if ("error" in parsed) return { state, say: parsed.error };
    const apply: PerioDictationTooth = { tooth, sites: parsed.sites };
    return { state, apply, say: `${describePerioDictation(apply).join(". ")}. ¿Algo más, o siguiente?` };
  }

  const margin = state.step === "marginV" || state.step === "marginL";
  let values = spokenPerioValues(text);
  if (margin && !values.length && has(text, /\b(normal|normales|sin recesion|en la union|nada)\b/)) values = [0, 0, 0];
  if (!values.length) return { state, say: `No entendí. ${margin ? "Dime los tres márgenes" : "Dime los tres sondajes"}, de mesial a distal.` };
  if (values.some(value => (margin ? value < -10 || value > 20 : value < 0 || value > 20))) { state.buffer = []; return { state, say: "Ese valor está fuera de rango. Repite los tres, de mesial a distal." }; }
  state.buffer.push(...values);
  if (state.buffer.length < 3) return { state, say: state.buffer.length === 2 ? "Falta uno." : "Faltan dos." };
  if (state.buffer.length > 3) { state.buffer = []; return { state, say: "Escuché más de tres valores. Repite los tres, de mesial a distal." }; }
  const keys = FACE_KEYS[guideFace(state.step) === "vestibular" ? "V" : "L"], field = margin ? "margin" : "depth";
  const apply: PerioDictationTooth = { tooth, sites: {} };
  state.buffer.forEach((value, k) => { apply.sites[keys[k]] = { [field]: value === 0 ? 0 : value }; });
  const said = spokenValues(state.buffer);
  state.buffer = []; state.step = STEPS[STEPS.indexOf(state.step) + 1];
  return { state, apply, say: `${said}. ${guidePrompt(state, name)}` };
}
