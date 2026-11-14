/**
 * Dictado guiado del periodontograma: la aplicación lleva el orden, anuncia la pieza y el sitio, y el clínico
 * solo responde. Lógica pura (sin micrófono ni voz) para poder probarla: cada frase oída produce el estado
 * siguiente, lo que la aplicación dice y, si corresponde, las medidas a aplicar.
 *
 * Cada pieza se dicta solo después de que el profesional la autoriza a mano (clic en la arcada o en el botón):
 * así ambos están de acuerdo en qué pieza se registra. Dentro de la pieza se va sitio por sitio, como una
 * asistente que anota: mesial, central y distal vestibular, y luego los tres del lado palatino o lingual. En cada
 * sitio se pide el sondaje y luego el margen gingival (se pueden decir juntos: «3 1»); al terminar los seis
 * sitios se pregunta por sangrado y supuración. Si no entiende, repite la pregunta; tras varios intentos fallidos
 * avisa que hay ruido o varias voces y detiene la escucha hasta que el clínico la reanude o escriba el valor.
 */
import { describePerioDictation, spokenPerioValues, type PerioDictationSite, type PerioDictationTooth } from "./perio-dictation.ts";

/** «await»: la aplicación propone una pieza y espera que el profesional la autorice con un clic antes de escuchar medidas. «site»: sondaje o margen de un sitio (ver `pos`). */
export type GuideStep = "await" | "site" | "flags";
/** `pos` recorre los seis sitios de la pieza: pos = 2·sitio + (0 sondaje | 1 margen); sitios 0–2 vestibular y 3–5 palatino/lingual. `misses`: respuestas seguidas no entendidas. */
export type GuideState = { order: number[]; index: number; step: GuideStep; pos: number; misses: number; noisy: boolean; absent: number[]; paused: boolean; done: boolean; /** Dictado de una sola pieza: al terminarla se cierra, sin pasar a las siguientes. */ single?: boolean };
export type GuideOutcome = { state: GuideState; say: string; apply?: PerioDictationTooth; markedAbsent?: number };

/** Intentos fallidos seguidos antes de avisar de ruido o varias voces. */
export const MAX_MISSES = 3;
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48];
const DIGIT = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const SPOT = ["mesial", "central", "distal"];
const SITE_KEYS: PerioDictationSite[] = ["MV", "V", "DV", "ML", "L", "DL"];
const FACE_KEYS: Record<"V" | "L", [PerioDictationSite, PerioDictationSite, PerioDictationSite]> = { V: ["MV", "V", "DV"], L: ["ML", "L", "DL"] };
const LAST_POS = 11;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (text: string, pattern: RegExp) => pattern.test(text);
export const spokenTooth = (tooth: number) => `${DIGIT[Math.floor(tooth / 10)]} ${DIGIT[tooth % 10]}`;
export const innerFace = (tooth: number) => (tooth < 30 ? "palatino" : "lingual");
export const guideSite = (pos: number) => Math.min(5, pos >> 1);
export const guideFace = (state: Pick<GuideState, "step" | "pos">): "vestibular" | "lingual" => (state.step === "site" && guideSite(state.pos) >= 3 ? "lingual" : "vestibular");
/** «mesial vestibular», «distal palatino»… */
export const siteName = (tooth: number, pos: number) => `${SPOT[guideSite(pos) % 3]} ${guideSite(pos) < 3 ? "vestibular" : innerFace(tooth)}`;
const spokenValues = (values: number[]) => values.map(value => (value < 0 ? `menos ${-value}` : String(value))).join(", ");

/** Recorrido: 1.8 → 2.8 y luego 3.8 → 4.8, sin las piezas ausentes ni los implantes del odontograma. */
export function guideOrder(statuses: Record<number, string | undefined>): number[] {
  return [...UPPER, ...LOWER].filter(tooth => { const status = statuses[tooth] ?? ""; return status !== "Ausente" && !status.startsWith("Implante"); });
}

export function guidePrompt(state: GuideState, name = ""): string {
  if (state.done) return "Examen terminado. Revisa la arcada y guarda el examen.";
  const tooth = state.order[state.index];
  if (state.step === "await") return `Autoriza la pieza ${spokenTooth(tooth)}.`;
  if (state.step === "flags") return `Pieza ${spokenTooth(tooth)}: ¿sangrado o supuración?`;
  const margin = state.pos % 2 === 1, site = siteName(tooth, state.pos);
  if (margin) return `Margen gingival, ${site}.`;
  if (state.pos === 0) return `${name ? `${name}, pieza` : "Pieza"} ${spokenTooth(tooth)}. ${site}, sondaje.`;
  return `${site}, sondaje.`;
}

/**
 * Inicio del dictado. Sin `only`, recorre las piezas del odontograma desde `from` (por defecto la 1.8) y cada una se
 * autoriza a mano. Con `only`, dicta SOLO esa pieza: elegirla y pulsar «Dictar solo la pieza» ya es la autorización,
 * así que empieza de inmediato en el primer sitio y al terminar se cierra.
 */
export function guideStart(statuses: Record<number, string | undefined>, name = "", from?: number, only = false): GuideOutcome {
  const all = guideOrder(statuses);
  if (only && from) {
    if (!all.includes(from)) {
      const state: GuideState = { order: [], index: 0, step: "await", pos: 0, misses: 0, noisy: false, absent: [], paused: false, done: true, single: true };
      return { state, say: `La pieza ${spokenTooth(from)} figura ausente o con implante en el odontograma, por eso no se sondea.` };
    }
    const state: GuideState = { order: [from], index: 0, step: "site", pos: 0, misses: 0, noisy: false, absent: [], paused: false, done: false, single: true };
    return { state, say: `Pieza ${spokenTooth(from)} solamente. ${guidePrompt(state, name)}` };
  }
  const order = all;
  const index = Math.max(0, from ? order.indexOf(from) : 0);
  const state: GuideState = { order, index, step: "await", pos: 0, misses: 0, noisy: false, absent: [], paused: false, done: order.length === 0 };
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

/** El profesional autoriza a mano la pieza que va a dictar: la propuesta u otra que elija en la arcada. */
export function guideAuthorize(current: GuideState, tooth: number, name = ""): GuideOutcome {
  const state: GuideState = { ...current, absent: [...current.absent] };
  if (state.done) return { state, say: "" };
  const now = state.order[state.index];
  if (state.step !== "await") return { state: current, say: tooth === now ? "" : `Estás en la pieza ${spokenTooth(now)}. Termínala o di «saltar» antes de cambiar.` };
  const index = state.order.indexOf(tooth);
  if (index < 0) return { state, say: `La pieza ${spokenTooth(tooth)} no está en el recorrido.` };
  state.index = index; state.step = "site"; state.pos = 0; state.paused = false; state.noisy = false; state.misses = 0;
  return { state, say: guidePrompt(state, name) };
}

/** Sangrado o supuración dichos de pasada en el sitio («3 1 sangra»); lo negado («sin sangrado») no cuenta. */
function inlineFlags(text: string): { bleeding: boolean; suppuration: boolean } {
  const affirmed = text.replace(/\b(sin|no|ni|tampoco)\s+(hay\s+)?(sangrado|sangra|sangrando|supuracion|supura|pus)\b/g, " ");
  return { bleeding: has(affirmed, /\b(sangrado|sangra|sangran|sangrando|sangramiento)\b/), suppuration: has(affirmed, /\b(supuracion|supura|supuran|supurando|pus)\b/) };
}

export function guideHear(current: GuideState, utterance: string, name = "", typed = false): GuideOutcome {
  const text = fold(utterance).trim();
  const state: GuideState = { ...current, absent: [...current.absent] };
  if (state.done || !text) return { state, say: "" };
  const tooth = state.order[state.index];
  const goTooth = (index: number, lead = ""): GuideOutcome => {
    state.misses = 0; state.noisy = false;
    if (index >= state.order.length) { state.done = true; return { state, say: state.single ? `${lead}Pieza ${spokenTooth(tooth)} lista. Revisa la arcada y guarda el examen.` : `${lead}Examen completo. Revisa la arcada y guarda el examen.` }; }
    state.index = Math.max(0, index); state.step = "await"; state.pos = 0;
    return { state, say: `${lead}${guidePrompt(state, name)}` };
  };
  /** No entendió: repite la pregunta; tras varios intentos seguidos avisa de ruido o varias voces y deja de escuchar. */
  const miss = (reason: string): GuideOutcome => {
    state.misses += 1;
    if (state.misses >= MAX_MISSES) {
      state.noisy = true; state.paused = true;
      return { state, say: `Hay mucho ruido o varias voces y no puedo escucharte bien. Dejé de escuchar para no anotar datos equivocados. Pulsa «Reintentar escucha» o escribe el valor para completar la pieza ${spokenTooth(tooth)}.` };
    }
    return { state, say: `${reason} ${guidePrompt(state, name)}` };
  };

  if (has(text, /\b(terminar|termina|termino|finalizar|finaliza)\b/)) { state.done = true; return { state, say: "Examen terminado. Revisa la arcada y guarda el examen." }; }
  if (state.paused) {
    if (has(text, /\b(continuar|continua|reanudar|seguir|sigamos|reintentar)\b/)) { state.paused = false; state.noisy = false; state.misses = 0; return { state, say: guidePrompt(state, name) }; }
    // Con la escucha detenida por ruido, lo escrito a mano sigue valiendo.
    if (!(typed && state.noisy)) return { state, say: "" };
    state.paused = false; state.noisy = false; state.misses = 0;
  }
  if (has(text, /\b(pausa|pausar|espera)\b/)) { state.paused = true; return { state, say: "En pausa. Di «continuar» cuando quieras seguir." }; }
  if (has(text, /\b(repetir|repite|repito|corregir|corrige|borrar|borra|de nuevo)\b/)) return { state, say: guidePrompt(state, name) };
  if (has(text, /\b(atras|anterior|volver|vuelve)\b/)) {
    if (state.step === "flags") { state.step = "site"; state.pos = LAST_POS; return { state, say: guidePrompt(state, name) }; }
    if (state.step === "site" && state.pos > 0) { state.pos -= 1; return { state, say: guidePrompt(state, name) }; }
    if (state.single) return { state, say: guidePrompt(state, name) };
    return goTooth(state.index - 1);
  }
  if (has(text, /\b(ausente|ausencia|falta|no esta|extraida|perdida)\b/)) {
    state.absent.push(tooth); state.order = state.order.filter(item => item !== tooth);
    const out = goTooth(state.index, `Pieza ${spokenTooth(tooth)} ausente. `);
    return { ...out, markedAbsent: tooth };
  }
  if (has(text, /\b(saltar|salta|salto|omitir|omite|siguiente pieza)\b/)) return goTooth(state.index + 1);

  if (state.step === "await") return { state, say: `Primero autoriza la pieza ${spokenTooth(tooth)} con un clic.` };

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
    state.misses = 0;
    const apply: PerioDictationTooth = { tooth, sites: parsed.sites };
    return { state, apply, say: `${describePerioDictation(apply).join(". ")}. ¿Algo más, o siguiente?` };
  }

  // Un sitio por vez. En el sondaje se acepta «3» o «3 1» (sondaje y margen juntos); en el margen, un valor.
  const margin = state.pos % 2 === 1;
  const flags = inlineFlags(text);
  let values = spokenPerioValues(text);
  if (margin && !values.length && has(text, /\b(normal|normales|sin recesion|en la union|nada)\b/)) values = [0];
  if (!values.length) return miss("No te entendí.");
  const limit = margin ? 1 : 2;
  if (values.length > limit) return miss(`Escuché ${values.length} valores y esperaba ${limit === 1 ? "uno" : "uno o dos"}.`);
  const [first, second] = values;
  if (margin ? first < -10 || first > 20 : first < 0 || first > 20 || (second !== undefined && (second < -10 || second > 20))) return miss("Ese valor está fuera de rango.");
  const key = SITE_KEYS[guideSite(state.pos)];
  const reading: Record<string, number | boolean> = margin ? { margin: first } : { depth: first };
  if (!margin && second !== undefined) reading.margin = second;
  if (flags.bleeding) reading.bleeding = true;
  if (flags.suppuration) reading.suppuration = true;
  const apply: PerioDictationTooth = { tooth, sites: { [key]: reading } };
  state.misses = 0;
  const said = [spokenValues([first]), ...(!margin && second !== undefined ? [`margen ${spokenValues([second])}`] : []), ...(flags.bleeding ? ["sangra"] : []), ...(flags.suppuration ? ["supura"] : [])].join(", ");
  // Sondaje y margen juntos saltan el paso del margen.
  state.pos += !margin && second !== undefined ? 2 : 1;
  if (state.pos > LAST_POS) { state.step = "flags"; state.pos = 0; }
  return { state, apply, say: `${said}. ${guidePrompt(state, name)}` };
}
