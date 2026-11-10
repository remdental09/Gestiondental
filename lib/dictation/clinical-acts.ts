/**
 * Actos clínicos: la IA COMPRENDE cada procedimiento (qué se hizo, en qué pieza y caras, qué material se colocó y cuál se
 * retiró, con qué intención y cómo queda la cara). Con eso se deciden el odontograma y el arancel; las reglas de
 * palabras quedan como respaldo y como guardianes (cada acto exige una cita literal que lo respalde).
 */
import type { OdontogramChange, OdontogramSurface } from "./proposal.ts";

export const ACT_ACTIONS = ["obturar", "retirar_restauracion", "inactivar_caries", "sellar", "exodoncia", "endodoncia", "destartraje", "pulido", "otro"] as const;
export const ACT_MATERIALS = ["", "resina", "amalgama", "ionomero", "provisorio", "otro"] as const;
export const ACT_INTENTS = ["", "definitiva", "provisoria", "inactivacion"] as const;
export const ACT_FINAL_STATES = ["", "caries", "obturada", "sellada", "sana"] as const;

export type ActAction = typeof ACT_ACTIONS[number];
export type ActMaterial = typeof ACT_MATERIALS[number];
export type ClinicalAct = {
  tooth: number | null;
  faces: OdontogramSurface[];
  action: ActAction;
  placed: ActMaterial;
  removed: ActMaterial;
  intent: typeof ACT_INTENTS[number];
  finalState: typeof ACT_FINAL_STATES[number];
  evidence: string;
};

const STRING = { type: "string" } as const;
export const ACTS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["pieza", "sistema", "caras", "accion", "material_colocado", "material_retirado", "intencion", "estado_final_cara", "evidencia"],
    properties: {
      pieza: STRING,
      sistema: { type: "string", enum: ["chilena", "FDI", "universal", "sin_etiqueta"] },
      caras: { type: "array", items: { type: "string", enum: ["M", "O", "D", "V", "P"] } },
      accion: { type: "string", enum: [...ACT_ACTIONS] },
      material_colocado: { type: "string", enum: [...ACT_MATERIALS] },
      material_retirado: { type: "string", enum: [...ACT_MATERIALS] },
      intencion: { type: "string", enum: [...ACT_INTENTS] },
      estado_final_cara: { type: "string", enum: [...ACT_FINAL_STATES] },
      evidencia: STRING,
    },
  },
} as const;

export const ACTS_PROMPT = `12) "actos": COMPRENDE cada procedimiento realizado HOY como un acto clínico, leyendo los verbos y la intención, no palabras sueltas. Un elemento por acto y pieza, con:
- "accion": obturar | retirar_restauracion | inactivar_caries | sellar | exodoncia | endodoncia | destartraje | pulido | otro.
- "material_colocado": el material que QUEDA puesto en el diente (resina, amalgama, ionomero, provisorio, otro o ""). "material_retirado": el que se SACÓ ("" si ninguno). Nunca confundas uno con otro: «se retira la amalgama» significa material_retirado = amalgama, NO que se obturó con amalgama.
- "intencion": definitiva | provisoria | inactivacion | "". Un vidrio ionómero (u otro material) colocado «para inactivar la caries» es intención inactivacion, aunque el material quede en la cavidad.
- "estado_final_cara": cómo queda la cara al terminar: obturada (restauración definitiva o provisoria), caries (lesión que sigue presente o solo inactivada), sellada, sana o "".
- "pieza", "sistema", "caras" como en "hallazgos" (si el acto es en caras distintas de la misma pieza, un acto por cada grupo de caras); "evidencia": cita EXACTA y continua del dictado, de UNA sola frase, que respalde el acto (verbo + material) e incluya el número de la pieza.
Ejemplo: «En la 1.6 se retira la amalgama fracturada, se elimina la caries y se coloca vidrio ionómero para inactivar la caries» → un acto: pieza 1.6, accion inactivar_caries, material_colocado ionomero, material_retirado amalgama, intencion inactivacion, estado_final_cara caries.
Ejemplo: «se retira la amalgama filtrada de la 4.6 y se obtura con resina en oclusal y distal» → accion obturar, material_colocado resina, material_retirado amalgama, intencion definitiva, estado_final_cara obturada, caras O y D.
Si no se hizo ningún procedimiento hoy, "actos" va vacío.`;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MATERIAL_WORDS: Record<Exclude<ActMaterial, "" | "otro">, RegExp> = {
  resina: /resina|composite|composit|fotocur/,
  amalgama: /amalgama/,
  ionomero: /ionomero|\bciv\b|vitremer|fuji|ketac|chemfil/,
  provisorio: /provisori|cavit|\birm\b|fermit/,
};
const PLACE_VERB = /\b(?:se\s+)?(?:coloc|obtur|restaur|aplic|rellen|sell|cement|instal|reemplaz|reconstru|condens|recambi)\w*/;
const REMOVE_VERB = /\b(?:retir|remov|remueve|elimin|sac|desobtur)\w*/;

/** ¿La cita respalda que se COLOCÓ ese material (y no solo que se retiró)? */
export function evidencePlaces(evidence: string, material: ActMaterial): boolean {
  if (material === "" || material === "otro") return true;
  const text = fold(evidence);
  const word = MATERIAL_WORDS[material];
  if (!word.test(text)) return false;
  const placed = new RegExp(`${PLACE_VERB.source}\\s+(?:\\S+\\s+){0,6}?(?:${word.source})|(?:${word.source})\\S*\\s+(?:\\S+\\s+){0,2}?(?:colocad|aplicad|obturad|cementad)`);
  const removed = new RegExp(`${REMOVE_VERB.source}\\s+(?:\\S+\\s+){0,4}?(?:${word.source})`);
  return placed.test(text) || !removed.test(text);
}

export type ToothResolver = (pieza: string, sistema: string, evidence: string) => { ok: true; tooth: number } | { ok: false; reason: string };

/** Valida los actos de la IA: cita literal, pieza resolvible y material colocado respaldado por la cita. */
export function parseActs(raw: unknown, evidenceOk: (evidence: string) => boolean, resolveTooth: ToothResolver, reject: (message: string) => void): ClinicalAct[] {
  if (!Array.isArray(raw)) return [];
  const out: ClinicalAct[] = [];
  const str = (value: unknown, max = 400) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const pick = <T extends readonly string[]>(value: unknown, allowed: T): T[number] => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : "") as T[number];
  for (const entry of raw.slice(0, 24)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const evidence = str(item.evidencia);
    const action = pick(item.accion, ACT_ACTIONS) as ActAction;
    if (!action) continue;
    if (!evidence || !evidenceOk(evidence)) { reject(`La IA describió un acto «${action.replace(/_/g, " ")}» sin una cita literal del dictado. No se usó.`); continue; }
    const pieza = str(item.pieza, 40);
    let tooth: number | null = null;
    if (pieza) {
      const mention = resolveTooth(pieza, str(item.sistema), evidence);
      if (mention.ok) tooth = mention.tooth;
    }
    let placed = pick(item.material_colocado, ACT_MATERIALS) as ActMaterial;
    const removed = pick(item.material_retirado, ACT_MATERIALS) as ActMaterial;
    if (placed && !evidencePlaces(evidence, placed)) {
      reject(`La IA dijo que se colocó ${placed} en ${tooth ? `FDI ${Math.floor(tooth / 10)}.${tooth % 10}` : "una pieza"}, pero la cita no lo respalda: «${evidence.slice(0, 160)}». Se ignoró ese material.`);
      placed = "";
    }
    const faces = (Array.isArray(item.caras) ? item.caras : []).filter((face): face is OdontogramSurface => typeof face === "string" && ["M", "O", "D", "V", "P"].includes(face));
    out.push({ tooth, faces: [...new Set(faces)], action, placed, removed, intent: pick(item.intencion, ACT_INTENTS), finalState: pick(item.estado_final_cara, ACT_FINAL_STATES), evidence });
  }
  return out;
}

const isInactivation = (act: ClinicalAct) => act.action === "inactivar_caries" || act.intent === "inactivacion";
const MATERIAL_LABEL: Partial<Record<ActMaterial, "Resina compuesta" | "Vidrio ionómero" | "Amalgama">> = { resina: "Resina compuesta", ionomero: "Vidrio ionómero", amalgama: "Amalgama" };

/**
 * Ajusta el odontograma según lo comprendido: una cara «obturada» que en realidad quedó con caries inactivada vuelve a
 * caries; una obturación toma el material que se colocó (no el retirado). Solo corrige cambios ya propuestos; no inventa.
 */
export function applyActsToOdontogram(odontogram: OdontogramChange[], acts: ClinicalAct[], depthOf: (text: string) => string | null): { odontogram: OdontogramChange[]; notes: string[] } {
  if (!acts.length) return { odontogram, notes: [] };
  const notes: string[] = [];
  const out = odontogram.map((item): OdontogramChange => {
    if (item.kind !== "surface" || !item.surface || !item.finding) return item;
    const act = actForFace(acts, item.tooth, item.surface);
    if (!act) return item;
    const label = `FDI ${Math.floor(item.tooth / 10)}.${item.tooth % 10} ${item.surface}`;
    if (item.finding.condition === "restored" && (isInactivation(act) || act.finalState === "caries")) {
      notes.push(`${label}: queda con caries ${isInactivation(act) ? "inactivada" : ""} (no obturada), según lo realizado: «${act.evidence.slice(0, 140)}».`.replace(/\s+\(/, " ("));
      return { ...item, finding: { condition: "caries", depth: (depthOf(`${act.evidence} ${item.sourceText ?? ""}`) as NonNullable<typeof item.finding>["depth"]) ?? null, icdas: null, activity: isInactivation(act) ? "inactive" : null } };
    }
    if (item.finding.condition === "restored" && act.placed && MATERIAL_LABEL[act.placed] && item.finding.restorationMaterial !== MATERIAL_LABEL[act.placed]) {
      return { ...item, finding: { ...item.finding, restorationMaterial: MATERIAL_LABEL[act.placed]! } };
    }
    return item;
  });
  return { odontogram: out, notes };
}

const RESTORATIVE: ActAction[] = ["obturar", "inactivar_caries", "retirar_restauracion"];

/** Acto de una cara: primero el que nombra esa cara; uno sin caras solo vale si es el único acto restaurador de la pieza. */
export function actForFace(acts: ClinicalAct[], tooth: number, face: OdontogramSurface | undefined): ClinicalAct | undefined {
  const ofTooth = acts.filter((act) => act.tooth === tooth && RESTORATIVE.includes(act.action));
  const named = face ? ofTooth.find((act) => act.faces.includes(face)) : undefined;
  if (named) return named;
  const generic = ofTooth.filter((act) => !act.faces.length);
  return ofTooth.length === 1 && generic.length === 1 ? generic[0] : undefined;
}

/** Para el arancel: el acto que explica las caras obturadas de una pieza (si hay varios y no se distinguen, ninguno). */
export function actForTooth(acts: ClinicalAct[], tooth: number, faces: OdontogramSurface[] = []): ClinicalAct | undefined {
  const ofTooth = acts.filter((act) => act.tooth === tooth && RESTORATIVE.includes(act.action));
  if (faces.length) {
    const matching = ofTooth.filter((act) => act.faces.some((face) => faces.includes(face)));
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) return undefined;
  }
  return ofTooth.length === 1 ? ofTooth[0] : undefined;
}

/** Familia de material de un acto, en los términos del arancel. */
export function actFamily(act: ClinicalAct | undefined): "composite" | "amalgama" | "ionomero" | null {
  if (!act) return null;
  return act.placed === "resina" ? "composite" : act.placed === "amalgama" || act.placed === "ionomero" ? act.placed : null;
}
export const actIsInactivation = isInactivation;


const FACE_WORDS: Record<OdontogramSurface, RegExp> = {
  M: /\bmesial(?:es)?\b|\bmesio/, D: /\bdistal(?:es)?\b|\bdisto/, O: /\boclusal(?:es)?\b|\bincisal\b/,
  V: /\bvestibular(?:es)?\b|\bbucal\b|\blabial\b/, P: /\bpalatin[oa]s?\b|\bpalatal\b|\blingual(?:es)?\b/,
};
const TOOTH_MENTION = /\b(?:pieza|diente|molar|premolar|canino|incisivo)\b|\b[1-8]\.[1-8]\b|\b(?:la|el|del|en)\s+\d{1,2}\b/g;

/**
 * Caras que el dictado nombra para el acto: lo dicho desde la última mención de pieza antes de la cita hasta el final de la
 * cita. Así una cara de la pieza vecina no se cuela, y la IA no puede agregar una cara que no se dijo.
 */
export function facesSaidForAct(transcript: string, act: ClinicalAct): OdontogramSurface[] {
  const plain = fold(transcript);
  const quote = fold(act.evidence).slice(0, 40);
  const at = plain.indexOf(quote);
  if (at < 0) return [];
  // Si la cita se repite en el dictado y no nombra la pieza, no se sabe a qué pieza corresponde: no se agregan caras.
  const inQuoteMention = [...fold(act.evidence).matchAll(TOOTH_MENTION)].length > 0;
  if (!inQuoteMention && plain.indexOf(quote, at + 1) >= 0) return [];
  const end = at + fold(act.evidence).length;
  const head = plain.slice(Math.max(0, at - 300), at);
  const inQuote = [...fold(act.evidence).matchAll(TOOTH_MENTION)].length > 0;
  let start = at;
  if (!inQuote) {
    const mentions = [...head.matchAll(TOOTH_MENTION)];
    const last = mentions[mentions.length - 1];
    start = last?.index !== undefined ? Math.max(0, at - 300) + last.index : at;
  }
  const window = plain.slice(start, end);
  // Una cara negada («sin caries en oclusal», «oclusal sana») no cuenta.
  return (Object.keys(FACE_WORDS) as OdontogramSurface[]).filter((face) => {
    const word = new RegExp(FACE_WORDS[face].source, "g");
    return [...window.matchAll(word)].some((match) => {
      const before = window.slice(Math.max(0, (match.index ?? 0) - 30), match.index);
      const after = window.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 12);
      return !/\b(?:sin|no)\b[^,.;:]*$/.test(before) && !/^\s*(?:sana|sano|sin\b)/.test(after);
    });
  });
}

/**
 * Completa las caras que el acto comprendido nombra y que faltan en el odontograma propuesto (p. ej. la oclusal de «caras mesial
 * y oclusal: se retira la amalgama fracturada…»). Solo caras dichas en el dictado, para la pieza del acto y con su estado final.
 */
export function addFacesFromActs(odontogram: OdontogramChange[], acts: ClinicalAct[], transcript: string, depthOf: (text: string) => string | null, makeId: () => string, chart: Array<{ tooth: number; status: string }> = []): { odontogram: OdontogramChange[]; notes: string[] } {
  const out = [...odontogram];
  const notes: string[] = [];
  for (const act of acts) {
    if (!act.tooth || !act.faces.length || !["caries", "obturada"].includes(act.finalState)) continue;
    // Una pieza ausente o con implante no tiene caras de diente: no se agregan (la coherencia clínica avisa en las demás).
    if (/^(?:Ausente|Implante)/.test(chart.find((row) => row.tooth === act.tooth)?.status ?? "")) continue;
    const said = facesSaidForAct(transcript, act);
    const template = out.find((item) => item.tooth === act.tooth && item.kind === "surface");
    for (const face of act.faces) {
      if (!said.includes(face)) continue;
      if (out.some((item) => item.tooth === act.tooth && item.kind === "surface" && item.surface === face)) continue;
      const finding: NonNullable<OdontogramChange["finding"]> = act.finalState === "caries"
        ? { condition: "caries", depth: (depthOf(act.evidence) as NonNullable<OdontogramChange["finding"]>["depth"]) ?? template?.finding?.depth ?? null, icdas: null, activity: isInactivation(act) ? "inactive" : null }
        : { condition: "restored", depth: null, icdas: null, activity: null, ...(MATERIAL_LABEL[act.placed] ? { restorationMaterial: MATERIAL_LABEL[act.placed]! } : {}) };
      out.push({
        id: makeId(), tooth: act.tooth, kind: "surface", surface: face, finding,
        numbering: template?.numbering ?? "FDI", numberingLabel: template?.numberingLabel ?? `FDI ${Math.floor(act.tooth / 10)}.${act.tooth % 10}`,
        sourceText: act.evidence, evidence: act.evidence, origin: "ia",
        // Mismo aviso que el resto de la pieza: si la pieza quedó con aviso o conflicto, la cara nueva también.
        ...(template?.advisory ? { advisory: template.advisory } : {}), ...(template?.coherence ? { coherence: template.coherence } : {}), ...(template?.conflict ? { conflict: true } : {}),
      });
      notes.push(`FDI ${Math.floor(act.tooth / 10)}.${act.tooth % 10} ${face}: se agregó la cara dictada que faltaba (${act.finalState === "caries" ? "caries" : "obturada"}).`);
    }
  }
  return { odontogram: out, notes };
}
