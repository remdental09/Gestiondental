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
import { perioCommand, perioSuspicious, spokenNumber, spokenToothCommand, voiceValues } from "./perio-voice.ts";

/** «await»: la aplicación propone una pieza y espera que el profesional la autorice con un clic antes de escuchar medidas. «site»: sondaje o margen de un sitio (ver `pos`). */
export type GuideStep = "await" | "site" | "flags";
/** `pos` recorre los seis sitios de la pieza: pos = 2·sitio + (0 sondaje | 1 margen); sitios 0–2 vestibular y 3–5 palatino/lingual. `misses`: respuestas seguidas no entendidas. */
export type GuideState = { order: number[]; index: number; step: GuideStep; pos: number; misses: number; noisy: boolean; absent: number[]; paused: boolean; done: boolean; /** Dictado de una sola pieza: al terminarla se cierra, sin pasar a las siguientes. */ single?: boolean;
  /** Sondajes ya dictados en la pieza actual (para detectar saltos sospechosos entre sitios vecinos). */ depths?: Partial<Record<PerioDictationSite, number>>;
  /** Valor sospechoso oído y no anotado: si el clínico lo repite igual, se acepta. */ retry?: number };
/** Lo recién anotado, para mostrarlo en grande: qué parámetro, en qué sitio y con qué valor. */
export type GuideRecord = { tooth: number; site: PerioDictationSite; field: "depth" | "margin" | "bleeding" | "suppuration"; value: number | boolean };
/**
 * `say`: texto completo (se muestra). `spoken`: versión breve que se dice en voz alta («Sondaje 3.» y la pregunta corta).
 * `alert`: aviso grande en ámbar («¿Repite? Oí 15»). `miss`: no se reconoció una medida (la interfaz puede reintentar con otro transcriptor).
 */
export type GuideOutcome = { state: GuideState; say: string; spoken?: string; apply?: PerioDictationTooth; markedAbsent?: number; records?: GuideRecord[]; alert?: string; miss?: boolean };

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
  // Cada frase va en su propia línea: la aplicación las dice por separado, con una pausa, para no mezclar sondaje y margen.
  const margin = state.pos % 2 === 1, site = siteName(tooth, state.pos);
  if (margin) return `Ahora, dime el margen gingival de ${site}.`;
  if (state.pos === 0) return `Pieza ${spokenTooth(tooth)}${name ? `, ${name}` : ""}.\nDime el sondaje de ${site}.`;
  return `Dime el sondaje de ${site}.`;
}

/** Pregunta breve para la voz, una vez que la pieza ya fue anunciada: «Margen.» / «Sondaje central vestibular.». */
export function guideShortPrompt(state: GuideState, name = ""): string {
  if (state.done || state.step !== "site") return guidePrompt(state, name);
  const tooth = state.order[state.index];
  if (state.pos === 0) return guidePrompt(state, name);
  if (state.pos % 2 === 1) return "Margen.";
  return state.pos === 6 ? `${innerFace(tooth)[0].toUpperCase()}${innerFace(tooth).slice(1)}. Sondaje mesial.` : `Sondaje ${siteName(tooth, state.pos)}.`;
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
    return { state, say: `Pieza ${spokenTooth(from)} solamente.\n${guidePrompt(state, name)}` };
  }
  const order = all;
  const index = Math.max(0, from ? order.indexOf(from) : 0);
  const state: GuideState = { order, index, step: "await", pos: 0, misses: 0, noisy: false, absent: [], paused: false, done: order.length === 0 };
  if (state.done) return { state, say: "No hay piezas para sondear según el odontograma." };
  return { state, say: `Comenzamos. Son ${order.length} piezas.\n${guidePrompt(state, name)}` };
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
  state.index = index; state.step = "site"; state.pos = 0; state.paused = false; state.noisy = false; state.misses = 0; state.depths = {}; state.retry = undefined;
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
    state.index = Math.max(0, index); state.step = "await"; state.pos = 0; state.depths = {}; state.retry = undefined;
    return { state, say: `${lead}${lead ? "\n" : ""}${guidePrompt(state, name)}` };
  };
  /** No entendió: repite la pregunta; tras varios intentos seguidos avisa de ruido o varias voces y deja de escuchar. */
  const miss = (reason: string): GuideOutcome => {
    state.misses += 1;
    if (state.misses >= MAX_MISSES) {
      state.noisy = true; state.paused = true;
      return { state, say: `Hay mucho ruido o varias voces y no puedo escucharte bien. Dejé de escuchar para no anotar datos equivocados. Pulsa «Reintentar escucha» o escribe el valor para completar la pieza ${spokenTooth(tooth)}.` };
    }
    return { state, say: `${reason}\n${guidePrompt(state, name)}` };
  };

  const command = perioCommand(text);
  if (command === "terminar") { state.done = true; return { state, say: "Examen terminado. Revisa la arcada y guarda el examen." }; }
  if (state.paused) {
    if (command === "sigue") { state.paused = false; state.noisy = false; state.misses = 0; return { state, say: guidePrompt(state, name) }; }
    // Con la escucha detenida por ruido, lo escrito a mano sigue valiendo.
    if (!(typed && state.noisy)) return { state, say: "" };
    state.paused = false; state.noisy = false; state.misses = 0;
  }
  if (command === "pausa") { state.paused = true; return { state, say: "En pausa. Di «sigue» cuando quieras continuar." }; }
  if (command === "repite") return { state, say: guidePrompt(state, name) };
  // «Corrige»: vuelve al último valor anotado para dictarlo de nuevo (lo nuevo reemplaza lo anterior).
  if (command === "corrige") {
    state.retry = undefined;
    if (state.step === "flags") { state.step = "site"; state.pos = LAST_POS; return { state, say: `Corrige. ${guidePrompt(state, name)}` }; }
    if (state.step === "site" && state.pos > 0) { state.pos -= 1; return { state, say: `Corrige. ${guidePrompt(state, name)}` }; }
    return { state, say: guidePrompt(state, name) };
  }
  if (command === "atras") {
    state.retry = undefined;
    if (state.step === "flags") { state.step = "site"; state.pos = LAST_POS; return { state, say: guidePrompt(state, name) }; }
    if (state.step === "site" && state.pos > 0) { state.pos -= 1; return { state, say: guidePrompt(state, name) }; }
    if (state.single) return { state, say: guidePrompt(state, name) };
    return goTooth(state.index - 1);
  }
  if (command === "ausente") {
    state.absent.push(tooth); state.order = state.order.filter(item => item !== tooth);
    const out = goTooth(state.index, `Pieza ${spokenTooth(tooth)} ausente. `);
    return { ...out, markedAbsent: tooth };
  }
  if (command === "salta") return goTooth(state.index + 1);

  // «Pieza N»: autoriza por voz la pieza nombrada (solo mientras se espera autorización).
  const named = spokenToothCommand(text);
  if (state.step === "await") {
    if (command === "sigue") return guideAuthorize(state, tooth, name);
    if (named) return guideAuthorize(state, named, name);
    return { state, say: `Primero autoriza la pieza ${spokenTooth(tooth)}: di «sigue» o pulsa Autorizar.` };
  }
  if (named && named !== tooth) return { state, say: `Estás en la pieza ${spokenTooth(tooth)}. Termínala o di «salta» antes de cambiar.\n${guidePrompt(state, name)}` };

  if (state.step === "flags") {
    // «sangrado vestibular, sin supuración»: lo negado se descarta y lo demás se marca.
    const affirmed = text.replace(/\b(sin|no|ni|tampoco)\s+(hay\s+)?(sangrado|sangra|sangramiento|supuracion|supura|pus)\b/g, " ");
    const mentions = has(affirmed, /\b(sangrado|sangra|sangran|sangramiento|sangrante|hemorragia|supuracion|supura|supuran|pus)\b/);
    if (!mentions) {
      if (has(text, /\b(nada|no|ninguno|ninguna|sin|sano|sana|negativo)\b/) && !has(text, /\bnada mas\b/)) return goTooth(state.index + 1, "Sin sangrado ni supuración. ");
      if (command === "sigue" || has(text, /\b(siguiente|listo|lista|continuar|continua|eso es todo|nada mas|ok)\b/)) return goTooth(state.index + 1);
    }
    const parsed = parseGuideFlags(affirmed);
    if ("error" in parsed) return { state, say: parsed.error };
    state.misses = 0;
    const apply: PerioDictationTooth = { tooth, sites: parsed.sites };
    return { state, apply, say: `${describePerioDictation(apply).join(". ")}. ¿Algo más, o siguiente?` };
  }

  // «Sangra» / «supura» solos: marcan el sitio recién medido (o el actual si aún no hay ninguno).
  if (command === "sangra" || command === "supura") {
    const key = SITE_KEYS[guideSite(state.pos > 0 ? state.pos - 1 : 0)];
    const field = command === "sangra" ? "bleeding" : "suppuration";
    const where = siteName(tooth, state.pos > 0 ? state.pos - 1 : 0);
    const label = command === "sangra" ? "Sangra" : "Supura";
    return { state, apply: { tooth, sites: { [key]: { [field]: true } } }, records: [{ tooth, site: key, field, value: true }], say: `${label} ${where}.\n${guidePrompt(state, name)}`, spoken: `${label}.` };
  }
  if (command === "sigue") return { state, say: guidePrompt(state, name) };

  // Un sitio por vez. En el sondaje se acepta «3» o «3 1» (sondaje y margen juntos); en el margen, un valor.
  const margin = state.pos % 2 === 1;
  const flags = inlineFlags(text);
  let values = spokenPerioValues(text);
  if (!values.length) values = voiceValues(text)?.values ?? [];
  if (margin && !values.length && has(text, /\b(normal|normales|sin recesion|en la union|nada)\b/)) values = [0];
  if (!values.length) return { ...miss("No te entendí."), miss: true };
  const limit = margin ? 1 : 2;
  if (values.length > limit) return { ...miss(`Escuché ${values.length} valores y esperaba ${limit === 1 ? "uno" : "uno o dos"}.`), miss: true };
  const [first, second] = values;
  const key = SITE_KEYS[guideSite(state.pos)];
  // Fuera de rango (sondaje > 12, |margen| > 12) o salto ≥ 5 mm respecto de un sitio vecino: no se anota y se pregunta de nuevo.
  const depths = { ...(state.depths ?? {}) };
  const problem = perioSuspicious(margin ? "margin" : "depth", first, key, depths) ?? (second !== undefined ? perioSuspicious("margin", second, key, depths) : null);
  const heardValue = second !== undefined && perioSuspicious("margin", second, key, depths) ? second : first;
  if (problem === "range" || (problem === "jump" && state.retry !== first)) {
    state.retry = problem === "jump" ? first : undefined;
    const alert = `¿Repite? Oí ${spokenNumber(heardValue)}`;
    const why = problem === "range" ? "Está fuera de rango." : "Es muy distinto del sitio vecino; si es correcto, repítelo.";
    return { state, alert, say: `${alert}. ${why}\n${guidePrompt(state, name)}`, spoken: `¿Repite? Oí ${spokenNumber(heardValue)}.` };
  }
  state.retry = undefined;
  if (!margin) depths[key] = first;
  state.depths = depths;
  const reading: Record<string, number | boolean> = margin ? { margin: first } : { depth: first };
  if (!margin && second !== undefined) reading.margin = second;
  if (flags.bleeding) reading.bleeding = true;
  if (flags.suppuration) reading.suppuration = true;
  const apply: PerioDictationTooth = { tooth, sites: { [key]: reading } };
  const records: GuideRecord[] = [{ tooth, site: key, field: margin ? "margin" : "depth", value: first }];
  if (!margin && second !== undefined) records.push({ tooth, site: key, field: "margin", value: second });
  if (flags.bleeding) records.push({ tooth, site: key, field: "bleeding", value: true });
  if (flags.suppuration) records.push({ tooth, site: key, field: "suppuration", value: true });
  state.misses = 0;
  // Confirmación: nombra qué se anotó y dónde; la siguiente pregunta va aparte, en otra línea.
  const where = siteName(tooth, state.pos);
  const extras = [...(flags.bleeding ? ["sangra"] : []), ...(flags.suppuration ? ["supura"] : [])].join(", ");
  const said = `${margin ? "Margen gingival" : "Sondaje"} ${where}, ${spokenValues([first])}.${!margin && second !== undefined ? ` Margen gingival, ${spokenValues([second])}.` : ""}${extras ? ` ${extras[0].toUpperCase()}${extras.slice(1)}.` : ""}`;
  // En voz alta, breve: «Sondaje 3.» / «Margen menos 1.».
  const brief = `${margin ? "Margen" : "Sondaje"} ${spokenNumber(first)}.${!margin && second !== undefined ? ` Margen ${spokenNumber(second)}.` : ""}${extras ? ` ${extras[0].toUpperCase()}${extras.slice(1)}.` : ""}`;
  // Sondaje y margen juntos saltan el paso del margen.
  state.pos += !margin && second !== undefined ? 2 : 1;
  if (state.pos > LAST_POS) { state.step = "flags"; state.pos = 0; }
  return { state, apply, records, say: `${said}\n${guidePrompt(state, name)}`, spoken: `${brief}\n${guideShortPrompt(state, name)}` };
}
